"""
JobProcessor: Orquestra o processamento de jobs de anúncios em background.

Responsável por:
- Coletar insights paginados
- Enriquecer dados
- Formatar para o frontend
- Persistir no Supabase (pack, ads, metrics, stats)

Executa fora do request de polling para não bloquear.
"""
import logging
import threading
import uuid
from typing import Any, Dict, Optional
import time
from app.services.job_tracker import (
    JobTracker,
    get_job_tracker,
    STATUS_PROCESSING,
    STATUS_PERSISTING,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_CANCELLED,
    STAGE_PAGINATION,
    STAGE_ENRICHMENT,
    STAGE_FORMATTING,
    STAGE_PERSISTENCE,
    STAGE_COMPLETE,
)
from app.core.config import ENABLE_AUTO_TRANSCRIPTION_AFTER_REFRESH
from app.services.insights_collector import get_insights_collector
from app.services.ads_enricher import get_ads_enricher, AdsEnricher
from app.services.dataformatter import format_ads_for_api
from app.services import supabase_repo
from app.services.supabase_repo import PackNameConflictError

logger = logging.getLogger(__name__)


class JobCancelledError(RuntimeError):
    """Raised when cooperative cancellation stops the job."""


class JobLeaseLostError(RuntimeError):
    """Raised when the worker loses the processing lease."""


class PersistStageError(RuntimeError):
    """Raised when a specific persistence stage fails."""

    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.message = message


class JobProcessor:
    """Processa jobs de anúncios em background."""
    
    def __init__(
        self,
        user_jwt: str,
        user_id: str,
        access_token: str,
        processing_owner: Optional[str] = None,
    ):
        self.user_jwt = user_jwt
        self.user_id = user_id
        self.access_token = access_token
        self.tracker = get_job_tracker(user_jwt, user_id, processing_owner=processing_owner)

    def _raise_if_job_stopped(self, job_id: str, lease_message: str) -> None:
        current_job = self.tracker.get_job(job_id) or {}
        if current_job.get("status") == STATUS_CANCELLED:
            raise JobCancelledError("Job cancelado pelo usuário")
        raise JobLeaseLostError(lease_message)

    def _heartbeat_or_raise(
        self,
        job_id: str,
        status: str,
        progress: int,
        message: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        if not self.tracker.heartbeat(
            job_id,
            status=status,
            progress=progress,
            message=message,
            details=details,
        ):
            self._raise_if_job_stopped(
                job_id,
                "Lease de processamento perdido durante atualização de progresso",
            )

    def _check_if_cancelled(self, job_id: str) -> bool:
        """
        Verifica se o job foi cancelado pelo usuário.

        Returns:
            True se o job foi cancelado, False caso contrário
        """
        try:
            job = self.tracker.get_job(job_id)
            if job and job.get("status") == STATUS_CANCELLED:
                logger.info(f"[JobProcessor] ⛔ Job {job_id} foi cancelado pelo usuário, interrompendo processamento")
                return True
            if job and self.tracker.processing_owner:
                current_owner = job.get("processing_owner")
                if current_owner and current_owner != self.tracker.processing_owner:
                    logger.warning(
                        f"[JobProcessor] Lease do job {job_id} foi transferido "
                        f"(esperado={self.tracker.processing_owner}, atual={current_owner})"
                    )
                    raise JobLeaseLostError("Lease de processamento perdido para outro worker")
            return False
        except Exception as e:
            if isinstance(e, JobLeaseLostError):
                raise
            logger.warning(f"[JobProcessor] Erro ao verificar cancelamento do job {job_id}: {e}")
            return False

    def _cleanup_new_pack(self, pack_id: Optional[str], job_id: str, reason: str) -> None:
        """Remove pack criado nesta execução quando o fluxo falha/cancela antes de concluir."""
        if not pack_id:
            return
        try:
            logger.warning(f"[JobProcessor] Cleanup compensatório do pack {pack_id} para job {job_id}: {reason}")
            supabase_repo.delete_pack(
                self.user_jwt,
                pack_id,
                user_id=self.user_id,
            )
            self.tracker.merge_payload(job_id, {"created_pack_id": None})
        except Exception as cleanup_error:
            logger.exception(
                f"[JobProcessor] Falha no cleanup compensatório do pack {pack_id} para job {job_id}: {cleanup_error}"
            )

    def process(self, job_id: str) -> Dict[str, Any]:
        """
        Processa um job completo.
        
        Args:
            job_id: ID do job (report_run_id da Meta)
        
        Returns:
            Dict com resultado do processamento
        """
        try:
            logger.info(f"[JobProcessor] Iniciando processamento do job {job_id}")
            
            # Buscar payload do job
            payload = self.tracker.get_payload(job_id)
            if not payload:
                self.tracker.mark_failed(job_id, "Payload do job não encontrado")
                return {"success": False, "error": "Payload do job não encontrado"}
            
            # Extrair informações do payload
            act_id = payload.get("adaccount_id", "")
            is_refresh = payload.get("is_refresh", False)
            pack_id_from_payload = payload.get("pack_id")
            
            # ===== FASE 1: PAGINAÇÃO =====
            if not self.tracker.mark_processing(job_id, STAGE_PAGINATION, {
                "page_count": 0,
                "total_collected": 0
            }):
                self._raise_if_job_stopped(job_id, "Lease de processamento perdido ao iniciar paginação")
            
            def on_pagination_progress(page_count: int, total_collected: int):
                self._heartbeat_or_raise(
                    job_id,
                    status=STATUS_PROCESSING,
                    progress=100,
                    message=f"Coletando dados: bloco {page_count}...",
                    details={
                        "stage": STAGE_PAGINATION,
                        "page_count": page_count,
                        "total_collected": total_collected
                    }
                )
            
            collector = get_insights_collector(
                self.access_token,
                on_progress=on_pagination_progress,
                job_tracker=self.tracker,
                job_id=job_id
            )
            collect_result = collector.collect(job_id)
            
            if not collect_result.get("success"):
                self.tracker.mark_failed(job_id, collect_result.get("error", "Erro ao coletar insights"))
                return {"success": False, "error": collect_result.get("error")}
            
            raw_data = collect_result.get("data", [])
            page_count = collect_result.get("page_count", 0)
            total_collected = collect_result.get("total_collected", 0)
            
            logger.info(f"[JobProcessor] Coleta concluída: {total_collected} registros em {page_count} páginas")

            # Verificar cancelamento após paginação
            if self._check_if_cancelled(job_id):
                raise JobCancelledError("Job cancelado pelo usuário")

            if not raw_data:
                # Job completou mas sem dados
                self.tracker.mark_completed(job_id, pack_id="", result_count=0, details={
                    "page_count": page_count,
                    "total_collected": 0,
                    "message": "Nenhum anúncio encontrado para os filtros selecionados"
                })
                return {"success": True, "data": [], "pack_id": None, "result_count": 0}

            # ===== FASE 2: ENRIQUECIMENTO =====
            # Calcular unique_count antes do enriquecimento para incluir no progresso
            temp_enricher = AdsEnricher(self.access_token)
            unique_ads_map = temp_enricher.deduplicate_by_name(raw_data)
            unique_count = len(unique_ads_map)
            
            if not self.tracker.mark_processing(job_id, STAGE_ENRICHMENT, {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_before_dedup": len(raw_data),
                "ads_after_dedup": unique_count,
                "enrichment_batches": 0,
                "enrichment_total": 0,
                "ads_enriched": 0
            }):
                self._raise_if_job_stopped(job_id, "Lease de processamento perdido ao iniciar enriquecimento")
            
            def on_enrichment_progress(batch_num: int, total_batches: int, ads_enriched: int):
                self._heartbeat_or_raise(
                    job_id,
                    status=STATUS_PROCESSING,
                    progress=100,
                    message=f"Enriquecendo dados: bloco {batch_num}/{total_batches}...",
                    details={
                        "stage": STAGE_ENRICHMENT,
                        "page_count": page_count,
                        "total_collected": total_collected,
                        "ads_before_dedup": len(raw_data),
                        "ads_after_dedup": unique_count,  # Incluir unique_count no progresso
                        "enrichment_batches": batch_num,
                        "enrichment_total": total_batches,
                        "ads_enriched": ads_enriched
                    }
                )
            
            existing_ads_map = {}
            if is_refresh:
                refresh_ad_ids = [
                    str(ad.get("ad_id")).strip()
                    for ad in raw_data
                    if str(ad.get("ad_id") or "").strip()
                ]
                existing_ads_map = supabase_repo.get_existing_ads_map(
                    self.user_jwt,
                    refresh_ad_ids,
                    self.user_id,
                )
                logger.info(
                    "[JobProcessor] Refresh otimizado: %s ads existentes reaproveitados, %s ads novos",
                    len(existing_ads_map),
                    max(0, len(set(refresh_ad_ids)) - len(existing_ads_map)),
                )

            enricher = get_ads_enricher(
                self.access_token,
                on_progress=on_enrichment_progress,
                job_tracker=self.tracker,
                job_id=job_id
            )
            enrich_result = enricher.enrich(
                act_id,
                raw_data,
                is_refresh=is_refresh,
                existing_ads_map=existing_ads_map,
            )
            if not enrich_result.get("success"):
                error_message = enrich_result.get("error", "Erro ao enriquecer dados")
                self.tracker.mark_failed(
                    job_id,
                    error_message,
                    error_code=enrich_result.get("error_code"),
                    details={"stage": "erro", "failure_stage": "enrichment"},
                )
                return {"success": False, "error": error_message}
            
            enriched_data = enrich_result.get("data", raw_data)
            # unique_count já foi calculado acima, mas validar se bate com o resultado
            enrich_result_unique_count = enrich_result.get("unique_count", 0)
            if enrich_result_unique_count != unique_count:
                logger.warning(f"[JobProcessor] Discrepância em unique_count: calculado={unique_count}, resultado={enrich_result_unique_count}")
            unique_count = enrich_result_unique_count if enrich_result_unique_count > 0 else unique_count
            enriched_count = enrich_result.get("enriched_count", 0)
            
            logger.info(f"[JobProcessor] Enriquecimento concluído: {enriched_count} de {unique_count} anúncios únicos")

            # Verificar cancelamento após enriquecimento
            if self._check_if_cancelled(job_id):
                raise JobCancelledError("Job cancelado pelo usuário")

            # ===== FASE 3: FORMATAÇÃO =====
            if not self.tracker.mark_processing(job_id, STAGE_FORMATTING, {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_after_dedup": unique_count,
                "ads_enriched": enriched_count,
                "ads_formatted": 0
            }):
                self._raise_if_job_stopped(job_id, "Lease de processamento perdido ao iniciar formatação")
            
            formatted_data = format_ads_for_api(enriched_data, act_id)
            
            logger.info(f"[JobProcessor] Formatação concluída: {len(formatted_data)} anúncios formatados")

            # Verificar cancelamento após formatação
            if self._check_if_cancelled(job_id):
                raise JobCancelledError("Job cancelado pelo usuário")

            # ===== FASE 4: PERSISTÊNCIA =====
            # Não chamar mark_persisting aqui - os heartbeats específicos dentro de _persist_data
            # vão atualizar o status com mensagens detalhadas por etapa
            pack_id = self._persist_data(job_id, payload, formatted_data, is_refresh, pack_id_from_payload)

            transcription_job_id = None
            if ENABLE_AUTO_TRANSCRIPTION_AFTER_REFRESH:
                transcription_job_id = self._create_transcription_job_if_needed(
                    pack_id=pack_id,
                    formatted_data=formatted_data,
                    meta_job_id=job_id,
                )

            # ===== CONCLUSÃO =====
            completion_details = {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_after_dedup": unique_count,
                "ads_enriched": enriched_count,
                "ads_formatted": len(formatted_data)
            }
            if transcription_job_id:
                completion_details["transcription_job_id"] = transcription_job_id

            self.tracker.mark_completed(
                job_id,
                pack_id,
                result_count=len(formatted_data),
                details=completion_details,
            )
            
            logger.info(f"[JobProcessor] Job {job_id} concluído com sucesso. Pack: {pack_id}, Ads: {len(formatted_data)}")
            
            # ===== TRANSCRIÇÃO (fire-and-forget, best-effort) — só se habilitada =====
            if ENABLE_AUTO_TRANSCRIPTION_AFTER_REFRESH:
                self._fire_transcription_batch(formatted_data, transcription_job_id)
            
            return {
                "success": True,
                "data": formatted_data,
                "pack_id": pack_id,
                "result_count": len(formatted_data)
            }
        except JobCancelledError as e:
            logger.info(f"[JobProcessor] {e}")
            return {"success": False, "error": str(e), "cancelled": True}
        except JobLeaseLostError as e:
            logger.warning(f"[JobProcessor] {e}")
            return {"success": False, "error": str(e)}
        except PackNameConflictError as e:
            logger.warning(f"[JobProcessor] Conflito de nome ao processar job {job_id}: {e}")
            self.tracker.mark_failed(
                job_id,
                str(e),
                error_code="duplicate_pack_name",
                details={"stage": "erro", "failure_stage": "pack_create"},
            )
            return {"success": False, "error": str(e)}
        except PersistStageError as e:
            logger.exception(f"[JobProcessor] Erro de persistência no estágio {e.stage}: {e.message}")
            self.tracker.mark_failed(
                job_id,
                e.message,
                error_code="persist_failed",
                details={"stage": "erro", "failure_stage": e.stage},
            )
            return {"success": False, "error": e.message}
        except Exception as e:
            logger.exception(f"[JobProcessor] Erro ao processar job {job_id}: {e}")
            self.tracker.mark_failed(job_id, str(e))
            return {"success": False, "error": str(e)}
        finally:
            self.tracker.release_processing_claim(job_id)
    
    def _persist_data(
        self,
        job_id: str,
        payload: Dict[str, Any],
        formatted_data: list,
        is_refresh: bool,
        pack_id_from_payload: Optional[str]
    ) -> Optional[str]:
        """Persiste dados no Supabase."""
        # Heartbeat limiter: evita spam de updates no jobs durante loops longos
        last_hb_ts = 0.0
        hb_min_interval_s = 1.0
        created_pack_id: Optional[str] = None
        pack_created_in_this_run = False

        def hb(message: str, force: bool = False) -> None:
            nonlocal last_hb_ts
            now = time.monotonic()
            if not force and (now - last_hb_ts) < hb_min_interval_s:
                return
            last_hb_ts = now
            if not self.tracker.heartbeat(
                job_id,
                status=STATUS_PERSISTING,
                progress=100,
                message=message,
                details={"stage": STAGE_PERSISTENCE},
            ):
                current_job = self.tracker.get_job(job_id) or {}
                if current_job.get("status") == STATUS_CANCELLED:
                    raise JobCancelledError("Job cancelado pelo usuário")
                raise JobLeaseLostError("Lease de processamento perdido durante persistência")

        def ensure_not_cancelled(stage: str) -> None:
            if self._check_if_cancelled(job_id):
                if pack_created_in_this_run and created_pack_id:
                    self._cleanup_new_pack(created_pack_id, job_id, f"cancelado em {stage}")
                raise JobCancelledError("Job cancelado pelo usuário")

        try:
            hb("Salvando tudo...", force=True)
            ensure_not_cancelled("persist_start")

            pack_id = None
            if is_refresh and pack_id_from_payload:
                pack_id = pack_id_from_payload
                logger.info(f"[JobProcessor] Atualizando pack após refresh: {pack_id}")
            else:
                pack_name = payload.get("name")
                if not pack_name:
                    raise PersistStageError("pack_create", "Payload não contém 'name', não é possível criar pack")

                existing_created_pack_id = payload.get("created_pack_id")
                hb("Salvando pack...", force=True)
                if existing_created_pack_id:
                    existing_pack = supabase_repo.get_pack(self.user_jwt, existing_created_pack_id, self.user_id)
                    if existing_pack:
                        pack_id = existing_created_pack_id
                        created_pack_id = pack_id
                        pack_created_in_this_run = True
                        supabase_repo.upsert_pack(
                            self.user_jwt,
                            user_id=self.user_id,
                            adaccount_id=payload.get("adaccount_id", ""),
                            name=pack_name,
                            date_start=payload.get("date_start", ""),
                            date_stop=payload.get("date_stop", ""),
                            level=payload.get("level", "ad"),
                            filters=payload.get("filters", []),
                            auto_refresh=payload.get("auto_refresh", False),
                            pack_id=pack_id,
                            today_local=payload.get("today_local"),
                        )
                        logger.info(f"[JobProcessor] Reutilizando pack parcial existente: {pack_id}")
                    else:
                        self.tracker.merge_payload(job_id, {"created_pack_id": None})

                if not pack_id:
                    try:
                        pack_id = supabase_repo.upsert_pack(
                            self.user_jwt,
                            user_id=self.user_id,
                            adaccount_id=payload.get("adaccount_id", ""),
                            name=pack_name,
                            date_start=payload.get("date_start", ""),
                            date_stop=payload.get("date_stop", ""),
                            level=payload.get("level", "ad"),
                            filters=payload.get("filters", []),
                            auto_refresh=payload.get("auto_refresh", False),
                            today_local=payload.get("today_local"),
                        )
                    except PackNameConflictError:
                        raise
                    except Exception as e:
                        raise PersistStageError("pack_create", f"Erro ao criar pack: {e}") from e

                    if not pack_id:
                        raise PersistStageError("pack_create", "Erro ao criar pack")

                    created_pack_id = pack_id
                    pack_created_in_this_run = True
                    self.tracker.merge_payload(job_id, {"created_pack_id": pack_id})
                    logger.info(f"[JobProcessor] Pack criado: {pack_id}")

                today_local = payload.get("today_local") or payload.get("date_stop")
                if today_local:
                    try:
                        supabase_repo.update_pack_refresh_status(
                            self.user_jwt,
                            pack_id,
                            user_id=self.user_id,
                            last_refreshed_at=str(today_local),
                            refresh_status="success",
                        )
                    except Exception as e:
                        raise PersistStageError("pack_refresh_status", f"Erro ao atualizar status do pack: {e}") from e

            if formatted_data:
                ensure_not_cancelled("before_ads")
                hb("Salvando anúncios...", force=True)
                try:
                    supabase_repo.upsert_ads(
                        self.user_jwt,
                        formatted_data,
                        user_id=self.user_id,
                        pack_id=pack_id,
                        on_batch_progress=lambda b, t: hb(f"Salvando anúncios: bloco {b}/{t}..."),
                    )
                except Exception as e:
                    if pack_created_in_this_run and created_pack_id:
                        self._cleanup_new_pack(created_pack_id, job_id, "falha em ads_upsert")
                    raise PersistStageError("ads_upsert", f"Erro ao salvar anúncios: {e}") from e

                ensure_not_cancelled("before_metrics")
                hb("Salvando métricas...", force=True)
                try:
                    supabase_repo.upsert_ad_metrics(
                        self.user_jwt,
                        formatted_data,
                        user_id=self.user_id,
                        pack_id=pack_id,
                        on_batch_progress=lambda b, t: hb(f"Salvando métricas: bloco {b}/{t}..."),
                    )
                except Exception as e:
                    if pack_created_in_this_run and created_pack_id:
                        self._cleanup_new_pack(created_pack_id, job_id, "falha em metrics_upsert")
                    raise PersistStageError("metrics_upsert", f"Erro ao salvar métricas: {e}") from e

                ad_ids = sorted(list({str(a.get("ad_id")) for a in formatted_data if a.get("ad_id")}))
                hb("Otimizando tudo...", force=True)
                try:
                    supabase_repo.update_pack_ad_ids(self.user_jwt, pack_id, ad_ids, user_id=self.user_id)
                except Exception as e:
                    if pack_created_in_this_run and created_pack_id:
                        self._cleanup_new_pack(created_pack_id, job_id, "falha em pack_index_update")
                    raise PersistStageError("pack_index_update", f"Erro ao atualizar índices do pack: {e}") from e

            if is_refresh and pack_id:
                last_refreshed_at = str(payload.get("date_stop")) if payload else None
                date_stop = str(payload.get("date_stop")) if payload else None
                try:
                    supabase_repo.update_pack_refresh_status(
                        self.user_jwt,
                        pack_id,
                        user_id=self.user_id,
                        last_refreshed_at=last_refreshed_at,
                        refresh_status="success",
                        date_stop=date_stop,
                    )
                except Exception as e:
                    raise PersistStageError("pack_refresh_status", f"Erro ao atualizar refresh do pack: {e}") from e

            if formatted_data and pack_id:
                ensure_not_cancelled("before_stats")
                time.sleep(0.5)
                hb("Calculando resumo...", force=True)
                try:
                    stats = supabase_repo.calculate_pack_stats(
                        self.user_jwt,
                        pack_id,
                        user_id=self.user_id
                    )
                except Exception as e:
                    raise PersistStageError("stats_calculation", f"Erro ao calcular resumo do pack: {e}") from e

                if stats and stats.get("totalSpend") is not None:
                    hb("Finalizando...", force=True)
                    try:
                        supabase_repo.update_pack_stats(
                            self.user_jwt,
                            pack_id,
                            stats,
                            user_id=self.user_id
                        )
                    except Exception as e:
                        raise PersistStageError("stats_update", f"Erro ao salvar resumo do pack: {e}") from e
                    logger.info(f"[JobProcessor] Stats salvos para pack {pack_id}: totalSpend={stats.get('totalSpend')}")
                else:
                    logger.warning(f"[JobProcessor] Stats não calculados/salvos para pack {pack_id} (best-effort)")

            if pack_id:
                self.tracker.merge_payload(job_id, {"created_pack_id": None, "pack_id": pack_id})
            return pack_id
        except PackNameConflictError:
            if pack_created_in_this_run and created_pack_id:
                self._cleanup_new_pack(created_pack_id, job_id, "conflito de nome")
            raise
        except JobCancelledError:
            raise
        except JobLeaseLostError:
            if pack_created_in_this_run and created_pack_id:
                self._cleanup_new_pack(created_pack_id, job_id, "lease perdido")
            raise
        except PersistStageError:
            raise
        except Exception as e:
            if pack_created_in_this_run and created_pack_id:
                self._cleanup_new_pack(created_pack_id, job_id, "erro inesperado na persistência")
            raise PersistStageError("persist_unknown", f"Erro ao persistir dados: {e}") from e

    def _create_transcription_job_if_needed(
        self,
        pack_id: str,
        formatted_data: list,
        meta_job_id: str,
    ) -> Optional[str]:
        """
        Cria job de transcrição quando há ad_names pendentes para transcrever.

        Retorna o transcription_job_id (UUID) ou None quando não houver trabalho.
        """
        try:
            from app.services.transcription_worker import count_pending_transcriptions

            pending_count = count_pending_transcriptions(
                user_jwt=self.user_jwt,
                user_id=self.user_id,
                formatted_ads=formatted_data,
            )
            if pending_count <= 0:
                logger.info("[JobProcessor] Sem transcrições pendentes; não criando transcription job")
                return None

            transcription_job_id = str(uuid.uuid4())
            tracker = get_job_tracker(self.user_jwt, self.user_id)
            tracker.create_job(
                job_id=transcription_job_id,
                payload={
                    "type": "transcription",
                    "pack_id": pack_id,
                    "meta_job_id": meta_job_id,
                    "total": pending_count,
                },
                status=STATUS_PROCESSING,
                message="Transcrevendo vídeos...",
            )
            tracker.heartbeat(
                transcription_job_id,
                status=STATUS_PROCESSING,
                progress=0,
                message=f"Transcrevendo 0 de {pending_count}",
                details={
                    "stage": "transcription",
                    "type": "transcription",
                    "done": 0,
                    "total": pending_count,
                    "pack_id": pack_id,
                    "meta_job_id": meta_job_id,
                },
            )
            logger.info(
                f"[JobProcessor] Transcription job criado: {transcription_job_id} (pending={pending_count})"
            )
            return transcription_job_id
        except Exception as e:
            logger.warning(f"[JobProcessor] Não foi possível criar transcription job: {e}")
            return None

    def _fire_transcription_batch(
        self,
        formatted_data: list,
        transcription_job_id: Optional[str],
    ) -> None:
        """Dispara transcrição de vídeos em thread separada (fire-and-forget)."""
        user_jwt = self.user_jwt
        user_id = self.user_id
        access_token = self.access_token

        def _run():
            try:
                from app.services.transcription_worker import run_transcription_batch
                run_transcription_batch(
                    user_jwt,
                    user_id,
                    access_token,
                    formatted_data,
                    transcription_job_id=transcription_job_id,
                )
            except Exception as e:
                logger.warning(f"[JobProcessor] Transcription batch failed (best-effort): {e}")

        threading.Thread(target=_run, daemon=True).start()
        logger.info("[JobProcessor] Transcription batch disparado em background")


def process_job_async(
    user_jwt: str,
    user_id: str,
    access_token: str,
    job_id: str,
    processing_owner: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Função para processar job (pode ser chamada em background).
    
    Args:
        user_jwt: JWT do Supabase
        user_id: ID do usuário
        access_token: Token de acesso da Meta API
        job_id: ID do job (report_run_id)
    
    Returns:
        Dict com resultado do processamento
    """
    processor = JobProcessor(user_jwt, user_id, access_token, processing_owner=processing_owner)
    return processor.process(job_id)


def get_job_processor(
    user_jwt: str,
    user_id: str,
    access_token: str,
    processing_owner: Optional[str] = None,
) -> JobProcessor:
    """Factory function para criar JobProcessor."""
    return JobProcessor(user_jwt, user_id, access_token, processing_owner=processing_owner)

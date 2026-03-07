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
from typing import Any, Dict, List, Optional
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
)
from app.services.insights_collector import get_insights_collector
from app.services.ads_enricher import get_ads_enricher
from app.services.dataformatter import format_ads_for_api
from app.core.supabase_client import get_supabase_service
from app.services import supabase_repo
from app.services.background_tasks import spawn_pack_background_tasks
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
        use_service_role: bool = False,
    ):
        self.user_jwt = user_jwt
        self.user_id = user_id
        self.access_token = access_token
        self.use_service_role = use_service_role
        self._sb = get_supabase_service() if use_service_role else None
        self.tracker = get_job_tracker(
            user_jwt, user_id,
            processing_owner=processing_owner,
            use_service_role=use_service_role,
        )

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
                sb_client=self._sb,
            )
            self.tracker.merge_payload(job_id, {"created_pack_id": None})
        except Exception as cleanup_error:
            logger.exception(
                f"[JobProcessor] Falha no cleanup compensatório do pack {pack_id} para job {job_id}: {cleanup_error}"
            )

    @staticmethod
    def _extract_thumb_url_from_formatted_ad(ad: Dict[str, Any]) -> Optional[str]:
        thumb_url: Optional[str] = None
        thumbs = ad.get("adcreatives_videos_thumbs")
        if isinstance(thumbs, list) and thumbs:
            first = str(thumbs[0] or "").strip()
            if first:
                thumb_url = first
        if not thumb_url:
            creative = ad.get("creative") or {}
            thumb_url = str(creative.get("thumbnail_url") or "").strip() or None
        return thumb_url

    def _build_thumb_groups_by_ad_name(self, formatted_data: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Constrói grupos de thumbnails por ad_name (normalizado), deduplicando por ad_id.

        Retorno:
        {
            ad_name_key: {
                "ad_name": str,
                "ad_ids": List[str],
                "rep_ad_id": str,
                "thumb_url": str,
            }
        }
        """
        canonical_by_ad_id: Dict[str, Dict[str, Optional[str]]] = {}
        duplicate_rows = 0

        for ad in formatted_data:
            ad_id = str(ad.get("ad_id") or "").strip()
            if not ad_id:
                continue

            ad_name = str(ad.get("ad_name") or "").strip()
            thumb_url = self._extract_thumb_url_from_formatted_ad(ad)

            existing = canonical_by_ad_id.get(ad_id)
            if not existing:
                canonical_by_ad_id[ad_id] = {"ad_name": ad_name, "thumb_url": thumb_url}
                continue

            duplicate_rows += 1
            if not existing.get("ad_name") and ad_name:
                existing["ad_name"] = ad_name
            if not existing.get("thumb_url") and thumb_url:
                existing["thumb_url"] = thumb_url

        grouped_ad_ids: Dict[str, List[str]] = {}
        ad_name_labels: Dict[str, str] = {}
        skipped_missing_name = 0
        skipped_missing_thumb = 0

        for ad_id, item in canonical_by_ad_id.items():
            ad_name = str(item.get("ad_name") or "").strip()
            if not ad_name:
                skipped_missing_name += 1
                continue

            thumb_url = str(item.get("thumb_url") or "").strip()
            if not thumb_url:
                skipped_missing_thumb += 1
                continue

            ad_name_key = ad_name.casefold()
            grouped_ad_ids.setdefault(ad_name_key, []).append(ad_id)
            ad_name_labels.setdefault(ad_name_key, ad_name)

        groups: Dict[str, Dict[str, Any]] = {}
        for ad_name_key, ad_ids in grouped_ad_ids.items():
            sorted_ad_ids = sorted(ad_ids)
            rep_ad_id = sorted_ad_ids[0]
            rep_thumb_url = str(canonical_by_ad_id.get(rep_ad_id, {}).get("thumb_url") or "").strip()
            if not rep_thumb_url:
                continue
            groups[ad_name_key] = {
                "ad_name": ad_name_labels.get(ad_name_key) or ad_name_key,
                "ad_ids": sorted_ad_ids,
                "rep_ad_id": rep_ad_id,
                "thumb_url": rep_thumb_url,
            }

        logger.info(
            "[JobProcessor] Thumb groups por ad_name: ad_ids_unique=%s, groups_total=%s, "
            "skipped_missing_name=%s, skipped_missing_thumb=%s, duplicate_rows=%s",
            len(canonical_by_ad_id),
            len(groups),
            skipped_missing_name,
            skipped_missing_thumb,
            duplicate_rows,
        )
        return groups

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
            meta_filters = payload.get("filters")
            if not isinstance(meta_filters, list):
                meta_filters = []
            
            # ===== FASE 1: PAGINAÇÃO =====
            if not self.tracker.mark_processing(job_id, STAGE_PAGINATION, {
                "page_count": 0,
                "total_collected": 0
            }):
                self._raise_if_job_stopped(job_id, "Lease de processamento perdido ao iniciar paginação")
            
            def on_pagination_progress(page_count: int, total_collected: int):
                # progress=100 is a placeholder; frontend calculates real % from details.stage
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
            if not self.tracker.mark_processing(job_id, STAGE_ENRICHMENT, {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_before_dedup": len(raw_data),
                "enrichment_batches": 0,
                "enrichment_total": 0,
                "ads_enriched": 0
            }):
                self._raise_if_job_stopped(job_id, "Lease de processamento perdido ao iniciar enriquecimento")

            def on_enrichment_progress(batch_num: int, total_batches: int, ads_enriched: int):
                batch_text = f"bloco {batch_num}/{total_batches}" if total_batches > 0 else f"bloco {batch_num}"
                self._heartbeat_or_raise(
                    job_id,
                    status=STATUS_PROCESSING,
                    progress=100,
                    message=f"Enriquecendo dados: {batch_text}...",
                    details={
                        "stage": STAGE_ENRICHMENT,
                        "page_count": page_count,
                        "total_collected": total_collected,
                        "ads_before_dedup": len(raw_data),
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
                    sb_client=self._sb,
                )
                ad_ids = list(existing_ads_map.keys()) if existing_ads_map else refresh_ad_ids
                if not ad_ids:
                    logger.warning("[JobProcessor] Nenhum ad_id para enriquecer após get_existing_ads_map")
                    return {"success": False, "error": "Nenhum ad_id para enriquecer"}
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
                meta_filters=meta_filters,
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
            unique_count = enrich_result.get("unique_count", 0)
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

            # ===== CONCLUSÃO =====
            completion_details = {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_after_dedup": unique_count,
                "ads_enriched": enriched_count,
                "ads_formatted": len(formatted_data)
            }

            self.tracker.mark_completed(
                job_id,
                pack_id,
                result_count=len(formatted_data),
                details=completion_details,
            )

            logger.info(f"[JobProcessor] Job {job_id} concluído com sucesso. Pack: {pack_id}, Ads: {len(formatted_data)}")

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
                    existing_pack = supabase_repo.get_pack(self.user_jwt, existing_created_pack_id, self.user_id, sb_client=self._sb)
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
                            sb_client=self._sb,
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
                            sb_client=self._sb,
                        )
                    except PackNameConflictError:
                        raise
                    except Exception as e:
                        raise PersistStageError("pack_create", f"Erro ao criar pack: {e}") from e

                    created_pack_id = pack_id
                    pack_created_in_this_run = True
                    self.tracker.merge_payload(job_id, {"created_pack_id": pack_id})
                    logger.info(f"[JobProcessor] Pack criado: {pack_id}")

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
                        sb_client=self._sb,
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
                        sb_client=self._sb,
                    )
                except Exception as e:
                    if pack_created_in_this_run and created_pack_id:
                        self._cleanup_new_pack(created_pack_id, job_id, "falha em metrics_upsert")
                    raise PersistStageError("metrics_upsert", f"Erro ao salvar métricas: {e}") from e

                ad_ids = sorted(list({str(a.get("ad_id")) for a in formatted_data if a.get("ad_id")}))
                hb("Otimizando tudo...", force=True)
                try:
                    supabase_repo.update_pack_ad_ids(self.user_jwt, pack_id, ad_ids, user_id=self.user_id, sb_client=self._sb)
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
                        sb_client=self._sb,
                    )
                except Exception as e:
                    raise PersistStageError("pack_refresh_status", f"Erro ao atualizar refresh do pack: {e}") from e

            if formatted_data and pack_id:
                ensure_not_cancelled("before_stats")
                hb("Calculando resumo...", force=True)
                try:
                    stats = supabase_repo.calculate_pack_stats_essential(
                        self.user_jwt,
                        pack_id,
                        user_id=self.user_id,
                        sb_client=self._sb,
                    )
                    if stats and stats.get("totalSpend") is not None:
                        hb("Finalizando...", force=True)
                        supabase_repo.update_pack_stats(
                            self.user_jwt,
                            pack_id,
                            stats,
                            user_id=self.user_id,
                            sb_client=self._sb,
                        )
                        logger.info(f"[JobProcessor] Stats essenciais salvos para pack {pack_id}: totalSpend={stats.get('totalSpend')}")
                    else:
                        logger.warning(f"[JobProcessor] Stats essenciais não calculados/salvos para pack {pack_id} (best-effort)")
                except Exception as e:
                    logger.warning(f"[JobProcessor] Erro ao calcular/salvar stats essenciais para pack {pack_id} (best-effort): {e}")

                # Spawn tasks em background: thumbnails + stats estendidos
                ad_name_groups = self._build_thumb_groups_by_ad_name(formatted_data)
                spawn_pack_background_tasks(
                    job_id=job_id,
                    pack_id=pack_id,
                    user_id=self.user_id,
                    user_jwt=self.user_jwt,
                    ad_name_groups=ad_name_groups,
                    use_service_role=self.use_service_role,
                )

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
    processor = JobProcessor(user_jwt, user_id, access_token, processing_owner=processing_owner, use_service_role=True)
    return processor.process(job_id)


def get_job_processor(
    user_jwt: str,
    user_id: str,
    access_token: str,
    processing_owner: Optional[str] = None,
) -> JobProcessor:
    """Factory function para criar JobProcessor."""
    return JobProcessor(user_jwt, user_id, access_token, processing_owner=processing_owner)

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
from typing import Any, Dict, Optional
import time
from app.services.job_tracker import (
    JobTracker,
    get_job_tracker,
    STATUS_PROCESSING,
    STATUS_PERSISTING,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STAGE_PAGINATION,
    STAGE_ENRICHMENT,
    STAGE_FORMATTING,
    STAGE_PERSISTENCE,
    STAGE_COMPLETE,
)
from app.services.insights_collector import get_insights_collector
from app.services.ads_enricher import get_ads_enricher, AdsEnricher
from app.services.dataformatter import format_ads_for_api
from app.services import supabase_repo

logger = logging.getLogger(__name__)


class JobProcessor:
    """Processa jobs de anúncios em background."""
    
    def __init__(
        self,
        user_jwt: str,
        user_id: str,
        access_token: str
    ):
        self.user_jwt = user_jwt
        self.user_id = user_id
        self.access_token = access_token
        self.tracker = get_job_tracker(user_jwt, user_id)
    
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
            self.tracker.mark_processing(job_id, STAGE_PAGINATION, {
                "page_count": 0,
                "total_collected": 0
            })
            
            def on_pagination_progress(page_count: int, total_collected: int):
                self.tracker.heartbeat(
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
            
            collector = get_insights_collector(self.access_token, on_progress=on_pagination_progress)
            collect_result = collector.collect(job_id)
            
            if not collect_result.get("success"):
                self.tracker.mark_failed(job_id, collect_result.get("error", "Erro ao coletar insights"))
                return {"success": False, "error": collect_result.get("error")}
            
            raw_data = collect_result.get("data", [])
            page_count = collect_result.get("page_count", 0)
            total_collected = collect_result.get("total_collected", 0)
            
            logger.info(f"[JobProcessor] Coleta concluída: {total_collected} registros em {page_count} páginas")
            
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
            
            self.tracker.mark_processing(job_id, STAGE_ENRICHMENT, {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_before_dedup": len(raw_data),
                "ads_after_dedup": unique_count,
                "enrichment_batches": 0,
                "enrichment_total": 0,
                "ads_enriched": 0
            })
            
            def on_enrichment_progress(batch_num: int, total_batches: int, ads_enriched: int):
                self.tracker.heartbeat(
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
            
            enricher = get_ads_enricher(self.access_token, on_progress=on_enrichment_progress)
            enrich_result = enricher.enrich(act_id, raw_data)
            
            enriched_data = enrich_result.get("data", raw_data)
            # unique_count já foi calculado acima, mas validar se bate com o resultado
            enrich_result_unique_count = enrich_result.get("unique_count", 0)
            if enrich_result_unique_count != unique_count:
                logger.warning(f"[JobProcessor] Discrepância em unique_count: calculado={unique_count}, resultado={enrich_result_unique_count}")
            unique_count = enrich_result_unique_count if enrich_result_unique_count > 0 else unique_count
            enriched_count = enrich_result.get("enriched_count", 0)
            
            logger.info(f"[JobProcessor] Enriquecimento concluído: {enriched_count} de {unique_count} anúncios únicos")
            
            # ===== FASE 3: FORMATAÇÃO =====
            self.tracker.mark_processing(job_id, STAGE_FORMATTING, {
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_after_dedup": unique_count,
                "ads_enriched": enriched_count,
                "ads_formatted": 0
            })
            
            formatted_data = format_ads_for_api(enriched_data, act_id)
            
            logger.info(f"[JobProcessor] Formatação concluída: {len(formatted_data)} anúncios formatados")
            
            # ===== FASE 4: PERSISTÊNCIA =====
            # Não chamar mark_persisting aqui - os heartbeats específicos dentro de _persist_data
            # vão atualizar o status com mensagens detalhadas por etapa
            pack_id = self._persist_data(job_id, payload, formatted_data, is_refresh, pack_id_from_payload)
            
            if not pack_id:
                self.tracker.mark_failed(job_id, "Erro ao persistir dados")
                return {"success": False, "error": "Erro ao persistir dados"}
            
            # ===== CONCLUSÃO =====
            self.tracker.mark_completed(job_id, pack_id, result_count=len(formatted_data), details={
                "page_count": page_count,
                "total_collected": total_collected,
                "ads_after_dedup": unique_count,
                "ads_enriched": enriched_count,
                "ads_formatted": len(formatted_data)
            })
            
            logger.info(f"[JobProcessor] Job {job_id} concluído com sucesso. Pack: {pack_id}, Ads: {len(formatted_data)}")
            
            return {
                "success": True,
                "data": formatted_data,
                "pack_id": pack_id,
                "result_count": len(formatted_data)
            }
            
        except Exception as e:
            logger.exception(f"[JobProcessor] Erro ao processar job {job_id}: {e}")
            self.tracker.mark_failed(job_id, str(e))
            return {"success": False, "error": str(e)}
    
    def _persist_data(
        self,
        job_id: str,
        payload: Dict[str, Any],
        formatted_data: list,
        is_refresh: bool,
        pack_id_from_payload: Optional[str]
    ) -> Optional[str]:
        """Persiste dados no Supabase."""
        try:
            # Heartbeat limiter: evita spam de updates no jobs durante loops longos
            # Intervalo reduzido para 1s para garantir feedback mais frequente durante batches
            last_hb_ts = 0.0
            hb_min_interval_s = 1.0

            def hb(message: str, force: bool = False) -> None:
                nonlocal last_hb_ts
                now = time.monotonic()
                if not force and (now - last_hb_ts) < hb_min_interval_s:
                    return
                last_hb_ts = now
                # Sempre incluir stage no details para consistência com frontend
                self.tracker.heartbeat(
                    job_id,
                    status=STATUS_PERSISTING,
                    progress=100,
                    message=message,
                    details={"stage": STAGE_PERSISTENCE}
                )

            # Marcar início da persistência imediatamente
            hb("Salvando tudo...", force=True)

            pack_id = None
            
            if is_refresh and pack_id_from_payload:
                # É refresh: atualizar pack existente
                pack_id = pack_id_from_payload
                logger.info(f"[JobProcessor] Atualizando pack após refresh: {pack_id}")
                
                if formatted_data:
                    hb("Salvando anúncios...", force=True)
                    supabase_repo.upsert_ads(
                        self.user_jwt,
                        formatted_data,
                        user_id=self.user_id,
                        pack_id=pack_id,
                        on_batch_progress=lambda b, t: hb(f"Salvando anúncios: bloco {b}/{t}..."),
                    )
                    hb("Salvando métricas...", force=True)
                    supabase_repo.upsert_ad_metrics(
                        self.user_jwt,
                        formatted_data,
                        user_id=self.user_id,
                        pack_id=pack_id,
                        on_batch_progress=lambda b, t: hb(f"Salvando métricas: bloco {b}/{t}..."),
                    )
                    
                    ad_ids = sorted(list({str(a.get("ad_id")) for a in formatted_data if a.get("ad_id")}))
                    hb("Otimizando tudo...", force=True)
                    supabase_repo.update_pack_ad_ids(self.user_jwt, pack_id, ad_ids, user_id=self.user_id)
                
                # Atualizar status de refresh e date_stop do pack
                last_refreshed_at = str(payload.get("date_stop")) if payload else None
                date_stop = str(payload.get("date_stop")) if payload else None
                supabase_repo.update_pack_refresh_status(
                    self.user_jwt,
                    pack_id,
                    user_id=self.user_id,
                    last_refreshed_at=last_refreshed_at,
                    refresh_status="success",
                    date_stop=date_stop,  # Atualizar date_stop para manter sincronizado
                )
            else:
                # É criação de novo pack
                pack_name = payload.get("name")
                if not pack_name:
                    logger.error(f"[JobProcessor] Payload não contém 'name', não é possível criar pack")
                    return None
                
                hb("Salvando pack...", force=True)
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
                
                if not pack_id:
                    logger.error(f"[JobProcessor] Falha ao criar pack no Supabase")
                    return None
                
                logger.info(f"[JobProcessor] Pack criado: {pack_id}")
                
                # Atualizar last_refreshed_at
                today_local = payload.get("today_local") or payload.get("date_stop")
                if today_local:
                    supabase_repo.update_pack_refresh_status(
                        self.user_jwt,
                        pack_id,
                        user_id=self.user_id,
                        last_refreshed_at=str(today_local),
                        refresh_status="success",
                    )
                
                # Persistir ads e métricas
                if formatted_data:
                    hb("Salvando anúncios...", force=True)
                    supabase_repo.upsert_ads(
                        self.user_jwt,
                        formatted_data,
                        user_id=self.user_id,
                        pack_id=pack_id,
                        on_batch_progress=lambda b, t: hb(f"Salvando anúncios: bloco {b}/{t}..."),
                    )
                    hb("Salvando métricas...", force=True)
                    supabase_repo.upsert_ad_metrics(
                        self.user_jwt,
                        formatted_data,
                        user_id=self.user_id,
                        pack_id=pack_id,
                        on_batch_progress=lambda b, t: hb(f"Salvando métricas: bloco {b}/{t}..."),
                    )
                    
                    ad_ids = sorted(list({str(a.get("ad_id")) for a in formatted_data if a.get("ad_id")}))
                    hb("Otimizando tudo...", force=True)
                    supabase_repo.update_pack_ad_ids(self.user_jwt, pack_id, ad_ids, user_id=self.user_id)
            
            # Calcular e salvar stats
            if formatted_data and pack_id:
                # Aguardar um pouco para garantir consistência
                time.sleep(0.5)
                
                hb("Calculando resumo...", force=True)
                stats = supabase_repo.calculate_pack_stats(
                    self.user_jwt,
                    pack_id,
                    user_id=self.user_id
                )
                
                if stats and stats.get("totalSpend") is not None:
                    hb("Finalizando...", force=True)
                    supabase_repo.update_pack_stats(
                        self.user_jwt,
                        pack_id,
                        stats,
                        user_id=self.user_id
                    )
                    logger.info(f"[JobProcessor] Stats salvos para pack {pack_id}: totalSpend={stats.get('totalSpend')}")
                else:
                    # Stats é best-effort: não travar job por isso
                    logger.warning(f"[JobProcessor] Stats não calculados/salvos para pack {pack_id} (best-effort)")
            
            # Nota: O job de sincronização do Google Sheets é criado no endpoint refresh_pack
            # ANTES de iniciar o processamento do Meta, para que o frontend possa ver ambos os toasts
            # simultaneamente desde o início. Não precisamos criar aqui.
            
            return pack_id
            
        except ValueError as e:
            # Propagar erros de validação (ex: nome duplicado) para que a mensagem seja preservada
            error_msg = str(e)
            logger.warning(f"[JobProcessor] Erro de validação ao persistir dados: {error_msg}")
            raise  # Relançar para que seja capturado no process() e marcado como falho com a mensagem correta
        except Exception as e:
            logger.exception(f"[JobProcessor] Erro ao persistir dados: {e}")
            return None


def process_job_async(
    user_jwt: str,
    user_id: str,
    access_token: str,
    job_id: str
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
    processor = JobProcessor(user_jwt, user_id, access_token)
    return processor.process(job_id)


def get_job_processor(
    user_jwt: str,
    user_id: str,
    access_token: str
) -> JobProcessor:
    """Factory function para criar JobProcessor."""
    return JobProcessor(user_jwt, user_id, access_token)


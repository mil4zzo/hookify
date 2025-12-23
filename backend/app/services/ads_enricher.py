"""
AdsEnricher: Enriquece dados de anúncios com detalhes da Meta API.

Responsável por:
- Deduplicar anúncios por nome
- Buscar detalhes (creative, adcreatives, effective_status)
- Mesclar detalhes nos dados brutos
"""
import logging
from typing import Any, Callable, Dict, List, Optional
import requests
import urllib.parse

logger = logging.getLogger(__name__)

# Tamanho do lote para buscar detalhes
BATCH_SIZE = 50
# Timeout por requisição de lote
REQUEST_TIMEOUT = 90


class AdsEnricher:
    """Enriquece dados de anúncios com detalhes da Meta API."""
    
    def __init__(
        self,
        access_token: str,
        base_url: str = "https://graph.facebook.com/v22.0/",
        limit: int = 5000,
        on_progress: Optional[Callable[[int, int, int], None]] = None
    ):
        """
        Args:
            access_token: Token de acesso da Meta API
            base_url: URL base da Graph API
            limit: Limite de registros por requisição
            on_progress: Callback opcional para progresso (batch_num, total_batches, ads_enriched)
        """
        self.access_token = access_token
        self.base_url = base_url
        self.limit = limit
        self.on_progress = on_progress
    
    def deduplicate_by_name(self, raw_data: List[Dict[str, Any]]) -> Dict[str, str]:
        """
        Deduplica anúncios por nome, retornando mapa de ad_name -> ad_id.
        
        Returns:
            Dict mapeando ad_name para ad_id (primeiro encontrado)
        """
        unique_ads: Dict[str, str] = {}
        for ad in raw_data:
            ad_name = ad.get("ad_name")
            ad_id = ad.get("ad_id")
            if ad_name and ad_id and ad_name not in unique_ads:
                unique_ads[ad_name] = ad_id
        
        logger.info(f"[AdsEnricher] Deduplicação: {len(raw_data)} -> {len(unique_ads)} anúncios únicos")
        return unique_ads
    
    def fetch_details(
        self,
        act_id: str,
        ad_ids: List[str]
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Busca detalhes dos anúncios na Meta API.
        
        Args:
            act_id: ID da conta de anúncios
            ad_ids: Lista de IDs de anúncios
        
        Returns:
            Lista de detalhes ou None se falhar
        """
        if not ad_ids:
            return []
        
        all_results = []
        total_batches = (len(ad_ids) + BATCH_SIZE - 1) // BATCH_SIZE
        
        logger.info(f"[AdsEnricher] Iniciando busca de detalhes para {len(ad_ids)} anúncios em {total_batches} lote(s)")
        
        for i in range(0, len(ad_ids), BATCH_SIZE):
            batch_ids = ad_ids[i:i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1
            
            logger.info(f"[AdsEnricher] Processando lote {batch_num}/{total_batches} ({len(batch_ids)} anúncios)")
            
            url = f"{self.base_url}{act_id}/ads?access_token={self.access_token}"
            payload = {
                "fields": "name,effective_status,creative{actor_id,body,call_to_action_type,instagram_permalink_url,object_type,title,video_id,thumbnail_url,effective_object_story_id{attachments,properties}},adcreatives{asset_feed_spec}",
                "limit": self.limit,
                "filtering": "[{'field':'id','operator':'IN','value':['" + "','".join(batch_ids) + "']}]",
            }
            
            try:
                response = requests.get(url, params=payload, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                batch_data = response.json().get("data", [])
                all_results.extend(batch_data)
                
                logger.info(f"[AdsEnricher] Lote {batch_num} concluído: {len(batch_data)} anúncios retornados")
                
                if self.on_progress:
                    self.on_progress(batch_num, total_batches, len(all_results))
                    
            except requests.exceptions.Timeout:
                logger.error(f"[AdsEnricher] Timeout no lote {batch_num} após {REQUEST_TIMEOUT} segundos")
                continue
            except requests.exceptions.HTTPError as http_err:
                decoded_text = urllib.parse.unquote(http_err.response.text)
                # Meta error: reduce the amount of data → fazer split recursivo
                if '"code":1' in decoded_text and "reduce the amount of data" in decoded_text:
                    logger.warning(f"[AdsEnricher] Meta API pediu para reduzir dados no lote {batch_num}, dividindo...")
                    mid = len(batch_ids) // 2
                    first = self.fetch_details(act_id, batch_ids[:mid])
                    second = self.fetch_details(act_id, batch_ids[mid:])
                    if first is not None:
                        all_results.extend(first)
                    if second is not None:
                        all_results.extend(second)
                    continue
                logger.error(f"[AdsEnricher] HTTP error no lote {batch_num}: {http_err.response.status_code} - {decoded_text[:200]}")
                continue
            except Exception as err:
                logger.exception(f"[AdsEnricher] Erro inesperado no lote {batch_num}: {err}")
                continue
        
        logger.info(f"[AdsEnricher] Busca de detalhes concluída: {len(all_results)} de {len(ad_ids)} anúncios")
        return all_results if all_results else None
    
    def merge_details(
        self,
        raw_data: List[Dict[str, Any]],
        details: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Mescla detalhes nos dados brutos.
        
        Args:
            raw_data: Lista de dados brutos de insights
            details: Lista de detalhes dos anúncios
        
        Returns:
            Lista de dados enriquecidos
        """
        if not details:
            return raw_data
        
        # Criar mapas por nome
        creative_map = {d.get("name"): d.get("creative") for d in details}
        status_map = {d.get("name"): d.get("effective_status") for d in details}
        
        # Mapa de vídeos do asset_feed_spec
        videos_map: Dict[str, List[Dict[str, Any]]] = {}
        for d in details:
            name = d.get("name")
            adcreatives = d.get("adcreatives", {})
            if adcreatives and "data" in adcreatives and len(adcreatives["data"]) > 0:
                first_creative = adcreatives["data"][0]
                asset_feed_spec = first_creative.get("asset_feed_spec", {})
                if "videos" in asset_feed_spec:
                    videos_map[name] = asset_feed_spec["videos"]
        
        # Mesclar nos dados brutos
        for ad in raw_data:
            ad_name = ad.get("ad_name")
            if ad_name:
                ad["creative"] = creative_map.get(ad_name)
                ad["effective_status"] = status_map.get(ad_name)
                
                # Videos do asset_feed_spec
                videos = videos_map.get(ad_name, [])
                video_ids = []
                video_thumbs = []
                for v in videos:
                    if v.get("video_id"):
                        video_ids.append(v.get("video_id"))
                    if v.get("thumbnail_url"):
                        video_thumbs.append(v.get("thumbnail_url"))
                ad["adcreatives_videos_ids"] = video_ids
                ad["adcreatives_videos_thumbs"] = video_thumbs
        
        logger.info(f"[AdsEnricher] Detalhes mesclados em {len(raw_data)} anúncios")
        return raw_data
    
    def enrich(
        self,
        act_id: str,
        raw_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Pipeline completo de enriquecimento.
        
        Args:
            act_id: ID da conta de anúncios
            raw_data: Lista de dados brutos de insights
        
        Returns:
            Dict com:
            - success: bool
            - data: Lista de dados enriquecidos
            - unique_count: Quantidade de anúncios únicos
            - enriched_count: Quantidade de anúncios enriquecidos
            - error: str (se houver erro)
        """
        try:
            if not raw_data:
                return {
                    "success": True,
                    "data": [],
                    "unique_count": 0,
                    "enriched_count": 0
                }
            
            # 1. Deduplicar por nome
            unique_ads = self.deduplicate_by_name(raw_data)
            unique_ids = list(unique_ads.values())
            
            # 2. Buscar detalhes
            details = self.fetch_details(act_id, unique_ids)
            
            # 3. Mesclar
            enriched = self.merge_details(raw_data, details or [])
            
            return {
                "success": True,
                "data": enriched,
                "unique_count": len(unique_ids),
                "enriched_count": len(details) if details else 0
            }
            
        except Exception as e:
            logger.exception(f"[AdsEnricher] Erro no pipeline de enriquecimento: {e}")
            return {
                "success": False,
                "data": raw_data,  # Retorna dados brutos como fallback
                "unique_count": 0,
                "enriched_count": 0,
                "error": str(e)
            }


def get_ads_enricher(
    access_token: str,
    on_progress: Optional[Callable[[int, int, int], None]] = None
) -> AdsEnricher:
    """Factory function para criar AdsEnricher."""
    return AdsEnricher(access_token, on_progress=on_progress)


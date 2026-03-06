"""
Configuração de logging customizada para truncar URLs longas nos logs do httpx.
"""
import logging
import re
from urllib.parse import urlparse, urlunparse, unquote


def _truncate_url(url: str, max_url_length: int, truncate_ad_ids: bool) -> str:
    """
    Trunca URL para preservar legibilidade dos logs.

    Se truncate_ad_ids=True, detecta id=in.(...) na query e substitui por
    id=in.(...N IDs...). Caso contrário, aplica apenas truncamento genérico.
    """
    if len(url) <= max_url_length:
        return url

    try:
        parsed = urlparse(url)
        base_path = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"

        if len(base_path) > max_url_length - 50:
            return url[:max_url_length - 20] + "...[truncated]"

        query = parsed.query
        if len(query) <= max_url_length - len(base_path) - 20:
            return url

        try:
            decoded_query = unquote(query)
        except Exception:
            decoded_query = query

        if truncate_ad_ids:
            id_match = re.search(r'id=in\.\(([^)]+)\)', decoded_query)
            if id_match:
                ids_str = id_match.group(1)
                ids_count = len([x for x in ids_str.split(',') if x.strip()])
                if ids_count > 0:
                    truncated_decoded = re.sub(
                        r'id=in\.\([^)]+\)',
                        f'id=in.(...{ids_count} IDs...)',
                        decoded_query
                    )
                    if truncated_decoded != decoded_query:
                        truncated_url = urlunparse((
                            parsed.scheme,
                            parsed.netloc,
                            parsed.path,
                            parsed.params,
                            truncated_decoded,
                            parsed.fragment
                        ))
                        if len(truncated_url) > max_url_length:
                            return truncated_url[:max_url_length - 20] + "...[truncated]"
                        return truncated_url

        max_query_length = max_url_length - len(base_path) - 30
        truncated_query = query[:max_query_length] + "...[truncated]"
        return f"{base_path}?{truncated_query}"
    except Exception:
        return url[:max_url_length - 20] + "...[truncated]"


class URLLoggingFilter(logging.Filter):
    """
    Filtro de logging que trunca URLs longas para preservar a legibilidade dos logs.

    Limita URLs a um tamanho máximo (padrão: 300 caracteres) e adiciona
    um indicador de truncamento quando necessário.
    """

    def __init__(self, max_url_length: int = 300, truncate_ad_ids: bool = True, name: str = ""):
        super().__init__(name)
        self.max_url_length = max_url_length
        self.truncate_ad_ids = truncate_ad_ids

    def filter(self, record: logging.LogRecord) -> bool:
        """
        Filtra e trunca URLs longas nas mensagens de log.

        Procura por padrões de URL (http:// ou https://) e trunca se necessário.
        """
        if hasattr(record, 'msg') and isinstance(record.msg, str):
            url_pattern = r'(https?://[^\s\)]+)'

            def truncate_match(match: re.Match) -> str:
                return _truncate_url(
                    match.group(1),
                    self.max_url_length,
                    self.truncate_ad_ids,
                )

            record.msg = re.sub(url_pattern, truncate_match, record.msg)

        if hasattr(record, 'args') and record.args:
            new_args = []
            url_pattern = r'(https?://[^\s]+)'
            for arg in record.args:
                if isinstance(arg, str):
                    new_arg = re.sub(
                        url_pattern,
                        lambda m: _truncate_url(
                            m.group(1),
                            self.max_url_length,
                            self.truncate_ad_ids,
                        ),
                        arg
                    )
                    new_args.append(new_arg)
                else:
                    new_args.append(arg)
            record.args = tuple(new_args)

        return True


def setup_httpx_logging_filter(max_url_length: int = 300, truncate_ad_ids: bool = True):
    """
    Configura o filtro de logging para o logger do httpx.

    Args:
        max_url_length: Tamanho máximo de URL a ser exibido nos logs (padrão: 300)
        truncate_ad_ids: Se True, substitui id=in.(...) por id=in.(...N IDs...).
            Se False, aplica apenas truncamento genérico (permite ver URL completa).
    """
    httpx_logger = logging.getLogger("httpx")
    httpx_logger.filters = [f for f in httpx_logger.filters if not isinstance(f, URLLoggingFilter)]
    url_filter = URLLoggingFilter(
        max_url_length=max_url_length,
        truncate_ad_ids=truncate_ad_ids,
    )
    httpx_logger.addFilter(url_filter)

    httpcore_logger = logging.getLogger("httpcore")
    httpcore_logger.filters = [f for f in httpcore_logger.filters if not isinstance(f, URLLoggingFilter)]
    httpcore_logger.addFilter(url_filter)

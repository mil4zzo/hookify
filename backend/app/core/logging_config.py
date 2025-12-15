"""
Configuração de logging customizada para truncar URLs longas nos logs do httpx.
"""
import logging
import re


class URLLoggingFilter(logging.Filter):
    """
    Filtro de logging que trunca URLs longas para preservar a legibilidade dos logs.
    
    Limita URLs a um tamanho máximo (padrão: 300 caracteres) e adiciona
    um indicador de truncamento quando necessário.
    """
    
    def __init__(self, max_url_length: int = 300, name: str = ""):
        super().__init__(name)
        self.max_url_length = max_url_length
    
    def filter(self, record: logging.LogRecord) -> bool:
        """
        Filtra e trunca URLs longas nas mensagens de log.
        
        Procura por padrões de URL (http:// ou https://) e trunca se necessário.
        """
        if hasattr(record, 'msg') and isinstance(record.msg, str):
            # Padrão para encontrar URLs completas (http:// ou https://)
            url_pattern = r'(https?://[^\s\)]+)'
            
            def truncate_url(match: re.Match) -> str:
                url = match.group(1)
                if len(url) <= self.max_url_length:
                    return url
                
                # Tentar preservar a parte inicial (base URL) e truncar apenas os parâmetros
                try:
                    from urllib.parse import urlparse, urlunparse, unquote
                    parsed = urlparse(url)
                    
                    # Se a URL base + path já é maior que o limite, truncar simplesmente
                    base_path = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
                    if len(base_path) > self.max_url_length - 50:
                        # URL base já é muito longa, truncar simplesmente
                        return url[:self.max_url_length - 20] + "...[truncated]"
                    
                    # Truncar apenas a query string se ela for muito longa
                    query = parsed.query
                    if len(query) > self.max_url_length - len(base_path) - 20:
                        # Decodificar a query para facilitar processamento
                        try:
                            decoded_query = unquote(query)
                        except Exception:
                            decoded_query = query
                        
                        # Detectar padrão id=in.(...) e contar IDs
                        ids_count = 0
                        id_match = re.search(r'id=in\.\(([^)]+)\)', decoded_query)
                        if id_match:
                            ids_str = id_match.group(1)
                            ids_count = len([x for x in ids_str.split(',') if x.strip()])
                        
                        if ids_count > 0:
                            # Substituir a lista de IDs por um resumo na query decodificada
                            truncated_decoded = re.sub(
                                r'id=in\.\([^)]+\)',
                                f'id=in.(...{ids_count} IDs...)',
                                decoded_query
                            )
                            
                            # Reconstruir URL com query truncada
                            # Se a query decodificada mudou, usar ela; senão truncar a original
                            if truncated_decoded != decoded_query:
                                # A query foi modificada, usar ela (será recodificada pelo urlunparse)
                                truncated_url = urlunparse((
                                    parsed.scheme,
                                    parsed.netloc,
                                    parsed.path,
                                    parsed.params,
                                    truncated_decoded,
                                    parsed.fragment
                                ))
                            else:
                                # Não conseguiu substituir, truncar a query original
                                max_query_length = self.max_url_length - len(base_path) - 30
                                truncated_query = query[:max_query_length] + "...[truncated]"
                                truncated_url = f"{base_path}?{truncated_query}"
                            
                            # Se ainda for muito longa, truncar mais
                            if len(truncated_url) > self.max_url_length:
                                return truncated_url[:self.max_url_length - 20] + "...[truncated]"
                            return truncated_url
                        
                        # Para outras queries longas, truncar a query string
                        max_query_length = self.max_url_length - len(base_path) - 30
                        truncated_query = query[:max_query_length] + "...[truncated]"
                        return f"{base_path}?{truncated_query}"
                    
                    return url
                except Exception:
                    # Se falhar ao parsear, truncar simplesmente
                    return url[:self.max_url_length - 20] + "...[truncated]"
            
            # Aplicar truncamento em todas as URLs encontradas
            record.msg = re.sub(url_pattern, truncate_url, record.msg)
        
        # Também verificar args caso a mensagem seja formatada
        if hasattr(record, 'args') and record.args:
            new_args = []
            for arg in record.args:
                if isinstance(arg, str):
                    # Aplicar o mesmo truncamento em args
                    url_pattern = r'(https?://[^\s]+)'
                    new_arg = re.sub(
                        url_pattern,
                        lambda m: m.group(1) if len(m.group(1)) <= self.max_url_length 
                                 else m.group(1)[:self.max_url_length - 20] + "...[truncated]",
                        arg
                    )
                    new_args.append(new_arg)
                else:
                    new_args.append(arg)
            record.args = tuple(new_args)
        
        return True


def setup_httpx_logging_filter(max_url_length: int = 300):
    """
    Configura o filtro de logging para o logger do httpx.
    
    Args:
        max_url_length: Tamanho máximo de URL a ser exibido nos logs (padrão: 300)
    """
    httpx_logger = logging.getLogger("httpx")
    # Remover filtros existentes do mesmo tipo (evitar duplicatas)
    httpx_logger.filters = [f for f in httpx_logger.filters if not isinstance(f, URLLoggingFilter)]
    # Adicionar nosso filtro
    url_filter = URLLoggingFilter(max_url_length=max_url_length)
    httpx_logger.addFilter(url_filter)
    
    # Também aplicar ao logger httpcore (usado internamente pelo httpx)
    httpcore_logger = logging.getLogger("httpcore")
    httpcore_logger.filters = [f for f in httpcore_logger.filters if not isinstance(f, URLLoggingFilter)]
    httpcore_logger.addFilter(url_filter)


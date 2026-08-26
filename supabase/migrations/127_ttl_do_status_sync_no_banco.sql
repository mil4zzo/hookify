-- 127: TTL do sync de status on-focus sai da memória do processo e vai para o banco.
--
-- O BUG (medido em 2026-08-26)
-- ---------------------------
-- O guarda de 5 minutos por pack vivia num dict de processo:
--
--     _status_sync_last_run: Dict[Tuple[str, str], float] = {}
--
-- O backend sobe com `uvicorn --workers 4` — quatro processos independentes, cada
-- um com o seu próprio dicionário vazio. Recarga 1 cai no worker A, que sincroniza
-- e anota; recarga 2 cai no worker B, que não sabe de nada e sincroniza de novo.
-- **O TTL era anulado pela quantidade de workers.** (O TTL do cliente também não
-- protege: vive num `useRef`, que zera a cada recarga de página.)
--
-- Custo observado em TRÊS recargas seguidas do Manager, via pg_stat_statements:
--
--     UPDATE ads SET effective_status ......... 414 chamadas, 35,3 s
--     SELECT campaign_id, adset_id FROM ads ... 352 chamadas, 11,9 s
--
-- Esse trabalho disputa slots de banco e locks nas MESMAS linhas de `ads` com a
-- consulta do Manager carregando ao lado. Sintoma: recarregar deixava a página
-- mais lenta, não mais rápida (10 s -> 17 s), porque os syncs se acumulavam.
--
-- É a mesma armadilha já conhecida do rate limit em memória: estado de processo
-- vale N vezes com N workers. Aqui o comentário do código dizia "reinício do
-- processo só permite 1 sync extra por pack" — subestimava: é 1 por worker,
-- sempre, não 1 por reinício.
--
-- POR QUE UMA COLUNA EM `packs`
-- -----------------------------
-- A chave do TTL era (user_id, pack_id), mas um pack tem um único dono — então o
-- pack_id sozinho identifica o slot. `packs` já carrega o padrão de controle de
-- refresh (`last_refreshed_at`, `refresh_status`, `refresh_lock_until`); esta
-- coluna entra na mesma família e passa a valer para os 4 workers.
--
-- A reserva vira um UPDATE condicional (`... WHERE last_status_sync_at IS NULL OR
-- < corte`), que é atômico por linha: dois workers simultâneos disputam a mesma
-- linha e só um recebe a linha de volta. Substitui o `threading.Lock`, que só
-- ordenava threads DENTRO de um processo.
--
-- NULL = nunca sincronizado (ou slot liberado após falha, para permitir retry no
-- próximo foco). Sem índice novo: a consulta filtra por `id`, e a PK cobre.

ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS last_status_sync_at timestamptz;

COMMENT ON COLUMN public.packs.last_status_sync_at IS
'Instante do último sync de status on-focus deste pack (TTL de 5 min). Fonte de verdade COMPARTILHADA entre os 4 workers do uvicorn — antes vivia num dict de processo e o TTL era anulado pela quantidade de workers (migration 127). NULL = nunca sincronizado ou slot liberado após falha, para permitir retry.';

-- 147: marca de renomeacao da planilha vinculada.
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- `ad_sheet_integrations.spreadsheet_name` era gravado na criacao do vinculo e,
-- desde 2026-09-07, reconferido no inicio de cada sync. Fora do sync, nada o
-- revalidava: um pack que parou de sincronizar ficava exibindo para sempre o
-- nome que o arquivo tinha no ultimo sync.
--
-- Isso importa mais do que "um rotulo errado". Constatado em producao em
-- 2026-09-09: os 25 vinculos deste banco apontam para UM UNICO spreadsheet_id.
-- Nao sao tres planilhas — e o mesmo arquivo do Drive, renomeado a cada
-- lancamento (EI.29 -> EI.30 -> EI.31) com o conteudo anterior substituido. Ou
-- seja: todo pack encerrado continua ligado ao arquivo VIVO do lancamento atual.
--
-- A revalidacao passiva (na listagem de packs) conserta o nome sozinha. Mas
-- consertar em silencio APAGA A EVIDENCIA: o usuario ve "EI.31" e nunca fica
-- sabendo que aquele pack fora vinculado a "EI.30". Esta coluna guarda o nome
-- anterior justamente para que a troca continue visivel depois do conserto.
--
-- CICLO DE VIDA
-- -------------
-- Escrita  : quando uma revalidacao (ou o proprio sync) detecta que o nome
--            mudou — recebe o nome ANTIGO.
-- Limpeza  : no primeiro sync que aplica linhas de fato (`last_sync_status`
--            = 'success'). Sync bem-sucedido depois da renomeacao significa que
--            o conteudo novo casou com este pack: o alerta cumpriu seu papel.
-- NULL     : nunca foi renomeada, ou ja foi reconciliada por um sync.
--
-- Nao ha backfill: sem o nome anterior gravado em algum lugar, ele nao existe.
-- Os vinculos ja defasados ganham a marca na primeira revalidacao que rodar.

ALTER TABLE public.ad_sheet_integrations
  ADD COLUMN IF NOT EXISTS spreadsheet_renamed_from text;

COMMENT ON COLUMN public.ad_sheet_integrations.spreadsheet_renamed_from IS
  'Nome que a planilha tinha antes da ultima renomeacao detectada. NULL = nunca '
  'renomeada ou ja reconciliada por um sync bem-sucedido. Alimenta o aviso '
  '"Renomeada: era X originalmente." no card do pack.';

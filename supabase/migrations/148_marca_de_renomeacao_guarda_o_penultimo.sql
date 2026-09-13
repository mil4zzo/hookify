-- 148: a marca de renomeacao guarda o PENULTIMO nome, e ganha um "estou ciente".
--
-- O QUE MUDA EM RELACAO A 147
-- ---------------------------
-- A 147 gravava `spreadsheet_renamed_from` uma unica vez, na PRIMEIRA renomeacao
-- detectada, para preservar o nome com que o vinculo nasceu ("era X
-- originalmente"). Decisao revista: a coluna passa a guardar sempre o nome
-- imediatamente anterior.
--
-- Por que o penultimo e melhor: a pergunta que o aviso responde e "o que mudou
-- desde a ultima vez que olhei?", nao "como esse arquivo se chamava no inicio
-- dos tempos". Num arquivo renomeado a cada lancamento, o nome de nascimento
-- envelhece ate virar trivia — depois de tres lancamentos, "era EI.29" nao
-- ajuda ninguem a decidir nada. Ja "antes era EI.30" descreve exatamente o
-- salto que acabou de acontecer.
--
-- Consequencia na copia: "era X ORIGINALMENTE" vira "ANTES era X". A palavra
-- "originalmente" passaria a mentir, e uma frase que mente e pior que a
-- ausencia dela.
--
-- TERCEIRA FORMA DE LIMPAR: O "ESTOU CIENTE"
-- ------------------------------------------
-- Ate aqui a marca so saia por um sync que aplicasse linhas. Mas o usuario pode
-- simplesmente SABER que a renomeacao e esperada — foi ele quem renomeou — e
-- nao ter motivo nenhum para rodar um sync so para calar um aviso. Sem uma
-- saida barata, um aviso permanente vira ruido, e ruido permanente e ignorado
-- justamente no dia em que ele estiver certo.
--
-- CICLO DE VIDA (atualizado)
-- --------------------------
-- Escrita  : toda renomeacao detectada — recebe o nome imediatamente anterior.
-- Limpeza  : (a) primeiro sync que aplica linhas de fato; (b) "estou ciente" do
--            usuario (POST .../dismiss-rename).
-- NULL     : nunca renomeada, ja reconciliada por um sync, ou dispensada.

COMMENT ON COLUMN public.ad_sheet_integrations.spreadsheet_renamed_from IS
  'Nome imediatamente anterior da planilha, quando uma renomeacao foi detectada '
  'no Drive. NULL = nunca renomeada, ja reconciliada por um sync que aplicou '
  'linhas, ou dispensada pelo usuario ("estou ciente"). Alimenta o aviso '
  '"Renomeada: antes era X." no card do pack.';

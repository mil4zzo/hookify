-- Migration 119: Boards — views de agrupamento de criativos por regra.
--
-- O QUE E
--   Um board e uma LENTE, nao uma pasta. Ele guarda grupos; cada grupo e uma
--   REGRA sobre a linha do Manager (agrupada por criativo). O board nao guarda
--   quais criativos estao em cada grupo — isso e derivado no cliente a cada
--   abertura, sobre o recorte (packs + periodo) que estiver ativo no momento.
--
-- POR QUE NAO TEM PERTENCIMENTO MANUAL (nenhuma tabela board_group_ads)
--   Decisao de produto de 2026-08-23. Se o usuario quer "jogar estes 3 aqui",
--   a ferramenta certa e uma tag — que ja existe, ja e do criativo e ja
--   sobrevive ao anuncio sumir da Meta (migration 116). Guardar membership
--   manual criaria um segundo estado de verdade que envelhece em silencio:
--   o criativo sai da Meta e o board continua afirmando que ele esta la.
--
-- POR QUE O BOARD NAO AMARRA PACK NEM PERIODO
--   Amarrar transformaria a lente em pasta: "Analise de Hooks — Cliente A",
--   "— Cliente B", "— Cliente C". O recorte vem do seletor global, entao o
--   mesmo board serve qualquer pack. Se algum dia um board precisar de recorte
--   proprio, isso entra como colunas opcionais aqui — nao como duplicacao.
--
-- POR QUE OS GRUPOS SAO TABELA, E NAO UM JSONB EM boards
--   O grupo e uma entidade que o usuario nomeia, reordena e edita UMA por vez.
--   Em jsonb, salvar um grupo reescreve o array inteiro (last-write-wins entre
--   duas abas) e nao ha como limitar a quantidade no banco. Como tabela, o
--   PATCH e do grupo e a RLS/CHECK valem por linha.
--
-- ESCOPO
--   Board e SEMPRE do usuario que criou, sem compartilhamento. As regras
--   referenciam tag_id, e tag e privada por usuario (migration 116) — um board
--   compartilhado mostraria grupos vazios para o convidado. Apresentacao em
--   reuniao e feita por compartilhamento de tela, nao por link.

BEGIN;

-- ---------------------------------------------------------------------------
-- boards: a lente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.boards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT boards_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT boards_name_max_len   CHECK (char_length(name) <= 60)
);

CREATE INDEX IF NOT EXISTS boards_user_position_idx
  ON public.boards (user_id, position, created_at);

-- ---------------------------------------------------------------------------
-- board_groups: o balde
--
-- `rules` guarda {"logic":"AND"|"OR","conditions":[...]} — a mesma arvore que o
-- avaliador do frontend le (lib/boards/evaluate.ts). Fica em jsonb porque e um
-- documento que so o cliente interpreta: o banco nunca filtra por dentro dela.
--
-- ATENCAO ao valor de condicao percentual: e gravado na ESCALA QUE O USUARIO
-- DIGITOU (30 para 30%), nao em razao (0.3). A conversao acontece na avaliacao,
-- via isManagerRatioPercentMetric. Gravar em razao amarraria o conteudo do
-- banco a um registry do frontend — se a metrica trocar de formatKind, todas
-- as regras salvas passariam a significar outra coisa em silencio.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT 'chart1',   -- token --chart-*, igual a tags.color
  position   integer NOT NULL DEFAULT 0,
  rules      jsonb NOT NULL DEFAULT '{"logic":"AND","conditions":[]}'::jsonb,
  sort_metric    text NOT NULL DEFAULT 'spend',
  sort_direction text NOT NULL DEFAULT 'desc',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT board_groups_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT board_groups_name_max_len   CHECK (char_length(name) <= 60),
  CONSTRAINT board_groups_sort_direction CHECK (sort_direction IN ('asc', 'desc')),
  -- Objeto, nunca array/escalar: o avaliador espera {logic, conditions}.
  CONSTRAINT board_groups_rules_object    CHECK (jsonb_typeof(rules) = 'object')
);

CREATE INDEX IF NOT EXISTS board_groups_board_position_idx
  ON public.board_groups (board_id, position, created_at);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_boards_set_updated_at ON public.boards;
CREATE TRIGGER trg_boards_set_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_board_groups_set_updated_at ON public.board_groups;
CREATE TRIGGER trg_board_groups_set_updated_at
  BEFORE UPDATE ON public.board_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: dono ve e escreve so o proprio. Mesmo formato de tags_modify_own.
--
-- board_groups checa o PROPRIO user_id (nao um EXISTS no board pai): a coluna
-- e obrigatoria e o backend a preenche, entao a politica fica sargable e nao
-- paga um subselect por linha.
-- ---------------------------------------------------------------------------
ALTER TABLE public.boards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boards_modify_own ON public.boards;
CREATE POLICY boards_modify_own ON public.boards
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS board_groups_modify_own ON public.board_groups;
CREATE POLICY board_groups_modify_own ON public.board_groups
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.boards IS
  'Board = lente de agrupamento de criativos. Nao guarda pack nem periodo: o recorte vem do seletor global.';
COMMENT ON TABLE public.board_groups IS
  'Grupo de um board. Pertencimento e DERIVADO de rules (jsonb), nunca manual — nao existe tabela de membership.';
COMMENT ON COLUMN public.board_groups.rules IS
  'Arvore {logic, conditions} avaliada no cliente. Valor de condicao percentual fica na escala digitada (30 = 30%).';

COMMIT;

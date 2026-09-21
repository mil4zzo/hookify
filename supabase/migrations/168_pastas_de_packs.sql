-- ===========================================================================
-- 168 — Pastas de packs: organização da Biblioteca
-- ===========================================================================
--
-- Contexto: documentation/roadmap-pastas-de-packs.md (Lote 2). Usuários ativos
-- passam de 30 packs e a /packs desenha um card alto por pack, sem nenhuma
-- noção de agrupamento. A pasta COLAPSA (30 cards viram ~8); etiqueta só
-- filtraria, sem tirar nada da tela. Por isso pasta, e por isso exclusiva:
-- se um pack morasse em duas, seria desenhado duas vezes e a tela ficaria
-- MAIS cheia. A exclusividade é o que faz o colapso existir.
--
-- DECISÃO 1 — a pasta é de QUEM ORGANIZA, não do pack.
--   Tabela de vínculo com user_id, nunca uma coluna folder_id em packs. Motivo
--   prático: pack compartilhado. Se o dono compartilha "Cliente A" comigo, eu
--   preciso guardá-lo na MINHA pasta sem tocar no pack dele — e a RLS de packs
--   (user_id = auth.uid()) nem me deixaria escrever lá. Com coluna em packs, o
--   convidado simplesmente não conseguiria organizar a própria tela.
--
--   Isto NÃO contradiz a 139 (que levou ad_tags para o silo do pack). A tag
--   classifica um CONTEÚDO que é o mesmo para todos; a pasta organiza uma LISTA
--   que é diferente para cada pessoa (meus packs + os que N donos me
--   compartilharam). Regra que fica: classificação de conteúdo é do silo;
--   organização de workspace é de quem olha.
--
-- DECISÃO 2 — parent_id no schema desde já, UI plana.
--   Pasta dentro de pasta ficou para depois. A coluna auto-referente custa ~zero
--   agora e custaria migration + rework de toda a navegação depois. Enquanto a
--   UI for plana, parent_id é sempre NULL.
--
-- DECISÃO 3 — a pasta NÃO é sujeito de permissão. Não existe folder_shares, e
--   não deve existir. "Compartilhar pasta" na UI compartilha os packs que estão
--   nela NAQUELE momento. Se a pasta fosse dona do acesso, um pack movido para
--   dentro depois herdaria permissão em silêncio. Este projeto já pagou para
--   revogar uma herança invisível (o julgamento por usuário, P2); herança
--   invisível de ACESSO é categoricamente pior.
--
-- Sem RPC: a leitura é um SELECT nas duas tabelas e o agrupamento acontece no
-- cliente, sobre os packs que a página já carrega. Zero query por pasta.
--
-- VOLTA ATRÁS:
--   DROP TABLE public.pack_folder_members;
--   DROP TABLE public.folders;
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- folders: a pasta
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL,
  parent_id  uuid REFERENCES public.folders(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT folders_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT folders_name_max_len   CHECK (char_length(name) <= 60),
  -- Pasta não é pai de si mesma. Ciclos mais longos não são possíveis enquanto
  -- a UI é plana (parent_id sempre NULL); quando deixar de ser, a checagem de
  -- ciclo entra junto com a tela que permite aninhar.
  CONSTRAINT folders_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS folders_user_position_idx
  ON public.folders (user_id, position, name);

-- ---------------------------------------------------------------------------
-- pack_folder_members: o vínculo, por usuário
--
-- UNIQUE (user_id, pack_id) é onde a EXCLUSIVIDADE mora: um pack tem uma pasta
-- só, por pessoa. Mover = upsert nessa chave, não delete + insert.
--
-- Sem FK composta para packs(id, user_id) — ao contrário de pack_shares — porque
-- aqui user_id é o ATOR que organiza, não o dono do pack. Um convidado arquiva
-- o pack alheio na pasta dele, e a FK composta proibiria exatamente isso.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pack_folder_members (
  user_id    uuid NOT NULL,
  pack_id    uuid NOT NULL REFERENCES public.packs(id)   ON DELETE CASCADE,
  folder_id  uuid NOT NULL REFERENCES public.folders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pack_folder_members_pkey PRIMARY KEY (user_id, pack_id)
);

-- Listar o conteúdo de uma pasta e contar quantos packs ela tem.
CREATE INDEX IF NOT EXISTS pack_folder_members_folder_idx
  ON public.pack_folder_members (folder_id, pack_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_folders_set_updated_at ON public.folders;
CREATE TRIGGER trg_folders_set_updated_at
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: cada um vê e escreve só o próprio. Mesmo formato de boards_modify_own.
--
-- pack_folder_members checa o PRÓPRIO user_id (não um EXISTS em folders): a
-- coluna é obrigatória e o backend a preenche, então a policy fica sargable e
-- não paga um subselect por linha.
-- ---------------------------------------------------------------------------
ALTER TABLE public.folders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pack_folder_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folders_modify_own ON public.folders;
CREATE POLICY folders_modify_own ON public.folders
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS pack_folder_members_modify_own ON public.pack_folder_members;
CREATE POLICY pack_folder_members_modify_own ON public.pack_folder_members
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.folders IS
  'Pasta da Biblioteca de packs. E de QUEM ORGANIZA (user_id = ator), nao do pack: um convidado arquiva pack compartilhado na pasta dele sem tocar no pack do dono. Nao e sujeito de permissao — nao existe folder_shares.';
COMMENT ON COLUMN public.folders.parent_id IS
  'Pasta dentro de pasta: schema pronto, UI ainda plana (migration 168). Enquanto a UI for plana este campo e sempre NULL.';
COMMENT ON TABLE public.pack_folder_members IS
  'Vinculo pack->pasta, por usuario. A PK (user_id, pack_id) e onde mora a EXCLUSIVIDADE: um pack tem uma pasta so, por pessoa. Mover = upsert nessa chave.';

COMMIT;

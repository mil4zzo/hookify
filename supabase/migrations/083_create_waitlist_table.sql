-- 083_create_waitlist_table.sql
--
-- Cria a tabela de waitlist (lista de espera / early access) alimentada pela
-- landing page pública /waitlist.
--
-- Captura de leads ANTES do cadastro: o formulário público insere direto via
-- client Supabase usando a publishable/anon key (role `anon`). Por isso a RLS
-- libera INSERT para `anon`/`authenticated`, mas NÃO libera SELECT — ninguém
-- consegue ler a lista pelo cliente (apenas service_role / dashboard).
--
-- Deduplicação por e-mail (case-insensitive): índice único em lower(email).
-- Em caso de duplicata o INSERT retorna 23505, tratado no front como
-- "você já está na lista".
--
-- Migration ADITIVA e segura: nenhuma outra parte do schema depende dela.

CREATE TABLE IF NOT EXISTS public.waitlist (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  source      text        NOT NULL DEFAULT 'waitlist',
  referrer    text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

COMMENT ON TABLE public.waitlist IS
  'Lista de espera / early access capturada pela landing page pública /waitlist. '
  'INSERT liberado para anon via RLS; SELECT apenas service_role.';

-- Dedup case-insensitive por e-mail
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_lower_uidx
  ON public.waitlist (lower(email));

-- Ordenação/relatório por data de entrada
CREATE INDEX IF NOT EXISTS waitlist_created_at_idx
  ON public.waitlist (created_at DESC);

-- RLS: insert público, sem leitura pública
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_public_insert ON public.waitlist;
CREATE POLICY waitlist_public_insert
  ON public.waitlist
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

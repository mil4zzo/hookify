-- Migration 062: vincular ad_accounts à conexão Facebook que enxerga a conta
--
-- Isso permite reaproveitar a conexão correta durante criação/duplicação
-- de anúncios e campanhas, sem depender apenas da conexão primária.

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS connection_id uuid;

COMMENT ON COLUMN public.ad_accounts.connection_id IS
  'ID da conexão Facebook que concedeu acesso a esta conta de anúncios. NULL mantém compatibilidade com registros antigos.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ad_accounts_connection_id_fkey'
  ) THEN
    ALTER TABLE public.ad_accounts
      ADD CONSTRAINT ad_accounts_connection_id_fkey
      FOREIGN KEY (connection_id)
      REFERENCES public.facebook_connections(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ad_accounts_user_connection_idx
  ON public.ad_accounts (user_id, connection_id);

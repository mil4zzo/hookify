-- Rollback da 183. Recria a tabela VAZIA (as linhas apagadas não voltam) — só faz
-- sentido junto com a volta do backend legado, que é quem a usava.
BEGIN;

CREATE TABLE IF NOT EXISTS public.bulk_ad_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    job_id text NOT NULL,
    user_id uuid NOT NULL,
    file_name text NOT NULL,
    file_index integer NOT NULL,
    adset_id text NOT NULL,
    adset_name text,
    ad_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    meta_ad_id text,
    meta_creative_id text,
    error_message text,
    error_code text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bundle_id text,
    bundle_name text,
    slot_files jsonb,
    is_multi_slot boolean DEFAULT false NOT NULL,
    campaign_name text,
    slot_media jsonb,
    error_details jsonb,
    CONSTRAINT bulk_ad_items_status_check CHECK (status = ANY (ARRAY['pending','uploading_media','creating_creative','creating_campaign','creating_adsets','creating_ad','success','error','skipped']))
);
CREATE INDEX IF NOT EXISTS bulk_ad_items_job_idx ON public.bulk_ad_items (job_id);
CREATE INDEX IF NOT EXISTS bulk_ad_items_bundle_idx ON public.bulk_ad_items (job_id, bundle_id);
ALTER TABLE public.bulk_ad_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own bulk_ad_items" ON public.bulk_ad_items FOR SELECT USING (user_id = (SELECT auth.uid()));
GRANT ALL ON public.bulk_ad_items TO service_role;

COMMIT;

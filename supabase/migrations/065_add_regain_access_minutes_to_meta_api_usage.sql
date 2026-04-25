ALTER TABLE public.meta_api_usage
  ADD COLUMN IF NOT EXISTS regain_access_minutes integer;

ALTER TABLE public.meta_api_usage
  ADD COLUMN IF NOT EXISTS page_route text;

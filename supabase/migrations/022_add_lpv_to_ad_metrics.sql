-- Adiciona LPV (landing page views) como coluna agregável no ad_metrics
-- Motivo: permitir médias/razões consistentes no frontend (ex: page_conv = results / lpv)
-- sem depender de parsing de JSONB (actions) em tempo de request.

alter table public.ad_metrics
  add column if not exists lpv integer not null default 0;

-- Backfill best-effort a partir de actions (jsonb array com {action_type, value})
-- Mantém 0 quando actions estiver ausente/ inválido/ não contiver landing_page_view.
update public.ad_metrics
set lpv = coalesce(
  (
    select sum(((elem ->> 'value')::numeric))::int
    from jsonb_array_elements(
      case
        when jsonb_typeof(actions) = 'array' then actions
        else '[]'::jsonb
      end
    ) as elem
    where (elem ->> 'action_type') = 'landing_page_view'
  ),
  0
)
where lpv is null or lpv = 0;



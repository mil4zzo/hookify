-- Migration: Adicionar coluna hold_rate na tabela ad_metrics
-- Data: 2024
-- Descrição: Adiciona a métrica hold_rate (NUMERIC) calculada como (video_total_thruplays / plays) / hook
--            Fórmula: (thruplay_rate) / hook_rate
--            Esta métrica mede a taxa de retenção após o hook inicial do vídeo
--            Usa video_total_thruplays que já existe no banco (não criar coluna duplicada)

-- Adicionar coluna hold_rate do tipo NUMERIC
alter table public.ad_metrics 
add column if not exists hold_rate numeric;

-- Comentário na coluna para documentação
comment on column public.ad_metrics.hold_rate is 
'Taxa de retenção (Hold Rate) calculada como (video_total_thruplays / plays) / hook (retention at 3 seconds). 
Primeiro calcula a taxa de thruplays (thruplays/plays), depois divide pela taxa de hook.
Representa quantos usuários que passaram do hook inicial continuaram assistindo até o thruplay.';


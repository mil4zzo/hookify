-- Migration: Remover coluna video_thruplay_watched_actions (duplicada)
-- Data: 2024
-- Descrição: Remove a coluna video_thruplay_watched_actions que é duplicada de video_total_thruplays
--            Ambos contêm o mesmo valor extraído de video_thruplay_watched_actions[0].value
--            Vamos usar apenas video_total_thruplays que já existia

-- Remover coluna video_thruplay_watched_actions se existir
alter table public.ad_metrics 
drop column if exists video_thruplay_watched_actions;


-- Migration 037
-- Aumenta statement_timeout do role 'authenticated' de 8s (default) para 30s.
-- Motivo: RPCs agregadas como fetch_manager_analytics_aggregated precisam de mais
-- tempo para processar alto volume de dados (ex: 5000+ variações × 30 dias).
-- 30s é suficiente para queries otimizadas e ainda protege contra queries infinitas.

ALTER ROLE authenticated SET statement_timeout = '30s';

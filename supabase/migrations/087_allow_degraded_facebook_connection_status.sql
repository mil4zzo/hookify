-- Migration: allow 'degraded' as a valid facebook_connections.status value.
--
-- Contexto: app/services/facebook_scopes.py grava status='degraded' quando um
-- scope crítico (ex: business_management) vem ausente do /me/permissions pós-OAuth.
-- A constraint original (migration 003) só admitia ('active','expired','invalid'),
-- então toda conexão com scope crítico faltando estourava 23514 -> 500 no callback.
-- Safe to run multiple times.

alter table public.facebook_connections
  drop constraint if exists facebook_connections_status_check;

alter table public.facebook_connections
  add constraint facebook_connections_status_check
  check (status in ('active', 'expired', 'invalid', 'degraded'));

-- Adiciona campo 'niche' na tabela user_preferences
-- Permite que o usuário defina seu nicho de negócio (texto livre)

alter table public.user_preferences
add column if not exists niche text;


-- Rollback da 192: tira a chave composta (a chave simples folder_id -> folders(id) continua).
BEGIN;
ALTER TABLE public.pack_folder_members DROP CONSTRAINT IF EXISTS pack_folder_members_folder_owner_fkey;
COMMIT;

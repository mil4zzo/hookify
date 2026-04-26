-- Drop obsolete user profile table.
-- User identity data now comes from auth.users metadata and connected accounts.
DROP TABLE IF EXISTS public.profiles;

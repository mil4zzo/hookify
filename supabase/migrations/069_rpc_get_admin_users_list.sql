-- RPC for admin panel: returns all users with subscription + packs count + meta account
CREATE OR REPLACE FUNCTION public.get_admin_users_list()
RETURNS TABLE (
  user_id       uuid,
  email         text,
  name          text,
  tier          text,
  meta_email    text,
  packs_count   bigint,
  created_at    timestamptz,
  expires_at    timestamptz,
  updated_at    timestamptz,
  granted_by    uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id                                        AS user_id,
    u.email                                     AS email,
    COALESCE(u.raw_user_meta_data->>'name', u.email) AS name,
    COALESCE(s.tier, 'standard')                AS tier,
    fc.facebook_email                           AS meta_email,
    COUNT(DISTINCT p.id)                        AS packs_count,
    s.created_at                                AS created_at,
    s.expires_at                                AS expires_at,
    s.updated_at                                AS updated_at,
    s.granted_by                                AS granted_by
  FROM auth.users u
  LEFT JOIN public.subscriptions s   ON s.user_id = u.id
  LEFT JOIN public.facebook_connections fc
         ON fc.user_id = u.id AND fc.is_primary = true
  LEFT JOIN public.packs p           ON p.user_id = u.id
  GROUP BY u.id, u.email, u.raw_user_meta_data, s.tier, fc.facebook_email,
           s.created_at, s.expires_at, s.updated_at, s.granted_by
  ORDER BY s.created_at DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_admin_users_list() IS
  'Admin-only: returns all users with tier, meta account, and packs count. Callable only via service role (no RLS).';

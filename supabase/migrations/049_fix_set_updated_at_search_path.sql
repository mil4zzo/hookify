-- Fix security warning: pin search_path on set_updated_at trigger function.
-- Without SET search_path, a malicious schema earlier in the path could
-- shadow objects the function references. Risk is low here (only uses now()),
-- but fixing removes the warning and is good practice.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

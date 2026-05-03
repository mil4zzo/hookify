-- Migration 080: track which ad accounts require Meta's "Transparência dos anúncios"
-- (DSA / regional_regulation_*) compliance fields on adset creation.
--
-- Meta enforces this requirement per-account based on its own criteria (not purely
-- by country targeting). When campaign duplication hits subcode 3858495, we mark
-- the account here so the frontend can warn the user upfront on the next attempt
-- if they pick a template adset that lacks the compliance fields.
--
-- The flag is set automatically by the backend on first failure; it is never
-- cleared automatically (Meta does not lift the requirement once it applies).

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS requires_ads_transparency boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ad_accounts.requires_ads_transparency IS
  'True when Meta has rejected an adset creation on this account with subcode 3858495 (compliance_section). Set automatically by campaign_bulk_service when the error occurs. Used by the frontend to warn before submission.';

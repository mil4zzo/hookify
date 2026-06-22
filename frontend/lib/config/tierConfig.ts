export const TIER_HIERARCHY = ['standard', 'insider', 'admin'] as const
export type Tier = (typeof TIER_HIERARCHY)[number]

// Grace period mirrors backend/app/core/tier.py GRACE_PERIOD_DAYS
export const GRACE_PERIOD_DAYS = 7

export function canAccess(userTier: Tier, requiredTier: Tier): boolean {
  return TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(requiredTier)
}

/**
 * Returns the enforced tier considering expires_at and grace period.
 * NULL expiresAt = never expires (manual/promo grants).
 * Pure function — safe for use in middleware (edge runtime).
 */
export function getEffectiveTier(tier: Tier, expiresAt: string | null | undefined): Tier {
  if (!expiresAt) return tier
  const expiry = new Date(expiresAt)
  const now = new Date()
  // expired more than GRACE_PERIOD_DAYS ago → downgrade
  if (now > expiry && now.getTime() - expiry.getTime() > GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
    return 'standard'
  }
  return tier
}

export const ROUTE_MINIMUM_TIER: Record<string, Tier> = {
  '/explorer':   'insider',
  '/gold':       'insider',
  '/plano':      'insider',
  '/upload':     'insider',
  '/meta-usage': 'insider',
  '/admin':      'admin',
}

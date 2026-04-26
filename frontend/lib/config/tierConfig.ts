export const TIER_HIERARCHY = ['standard', 'insider', 'admin'] as const
export type Tier = (typeof TIER_HIERARCHY)[number]

export function canAccess(userTier: Tier, requiredTier: Tier): boolean {
  return TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(requiredTier)
}

export const ROUTE_MINIMUM_TIER: Record<string, Tier> = {
  '/explorer':   'insider',
  '/gold':       'insider',
  '/upload':     'insider',
  '/meta-usage': 'insider',
  '/admin':      'admin',
}

import { FREE_TIER_LIMITS, PRO_FEATURES, type FeatureId, type LicenseState } from "../../shared/types";

export function isPro(state: LicenseState | null): boolean {
  return !!state && state.validity === "valid" && state.plan === "pro";
}

/**
 * A feature is available if the active license is a valid Pro license and
 * either grants it explicitly (payload.features) or the payload has no
 * feature list at all (treated as "everything the pro plan includes").
 */
export function hasFeature(state: LicenseState | null, feature: FeatureId): boolean {
  if (!isPro(state)) return false;
  const granted = state?.payload?.features;
  if (!granted || granted.length === 0) return PRO_FEATURES.includes(feature);
  return granted.includes(feature);
}

export function getHostLimit(state: LicenseState | null): number | null {
  return hasFeature(state, "unlimitedHosts") ? null : FREE_TIER_LIMITS.maxHosts;
}

export function getGroupLimit(state: LicenseState | null): number | null {
  return hasFeature(state, "unlimitedGroups") ? null : FREE_TIER_LIMITS.maxGroups;
}

export class ProFeatureRequiredError extends Error {
  constructor(public feature: FeatureId) {
    super(`This feature ("${feature}") requires a Wharf Pro license.`);
    this.name = "ProFeatureRequiredError";
  }
}

export function requireFeature(state: LicenseState | null, feature: FeatureId): void {
  if (!hasFeature(state, feature)) {
    throw new ProFeatureRequiredError(feature);
  }
}

export class LimitReachedError extends Error {
  constructor(
    public resource: "hosts" | "groups",
    public limit: number,
  ) {
    super(`Free plan limit reached: up to ${limit} ${resource} on the free tier. Upgrade to Pro for unlimited ${resource}.`);
    this.name = "LimitReachedError";
  }
}

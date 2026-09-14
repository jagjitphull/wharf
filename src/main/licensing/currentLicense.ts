import { getLicenseState, setLicenseState } from "../services/store";
import { evaluateLicense } from "./license";
import type { LicenseKey, LicenseState } from "../../shared/types";

/**
 * Single source of truth for "what plan is active right now", re-verified
 * from the stored license key on every read rather than trusting a cached
 * validity flag — so a manually edited store file or an expiry that has
 * since passed is always caught.
 */
export function getCurrentLicenseState(): LicenseState {
  const stored = getLicenseState();
  const state = evaluateLicense(stored?.licenseKey ?? null, stored?.activatedAt ?? null);
  // Keep the persisted copy in sync (e.g. validity flips to "expired").
  if (!stored || stored.validity !== state.validity || stored.plan !== state.plan) {
    setLicenseState(state);
  }
  return state;
}

export function activateLicense(licenseKey: LicenseKey): LicenseState {
  const state = evaluateLicense(licenseKey, null);
  setLicenseState(state);
  return state;
}

export function deactivateLicense(): LicenseState {
  const state = evaluateLicense(null);
  setLicenseState(state);
  return state;
}

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { LicenseKey, LicensePayload, LicenseState, LicenseValidity } from "../../shared/types";
import { LICENSE_PUBLIC_KEY_PEM } from "./keys";

const publicKey = createPublicKey(LICENSE_PUBLIC_KEY_PEM);

interface Header {
  alg: "Ed25519";
  v: 1;
}

function b64urlToBuffer(b64url: string): Buffer {
  return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifies a Wharf license key of the form `header.payload.signature`
 * (each segment base64url), where the signature covers `header.payload`
 * using Ed25519. Returns the decoded payload if — and only if — the
 * signature is valid; callers still need to check expiry separately via
 * {@link evaluateLicense}.
 */
export function verifyLicenseKey(licenseKey: LicenseKey): LicensePayload | null {
  const parts = licenseKey.trim().split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: Header;
  let payload: LicensePayload;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString("utf8"));
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "Ed25519") return null;

  const signature = b64urlToBuffer(sigB64);
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");

  const valid = cryptoVerify(null, signedData, publicKey, signature);
  if (!valid) return null;

  if (!isLicensePayload(payload)) return null;
  return payload;
}

function isLicensePayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.licenseId === "string" &&
    typeof v.email === "string" &&
    (v.plan === "free" || v.plan === "pro") &&
    typeof v.seats === "number" &&
    typeof v.issuedAt === "number" &&
    (v.expiresAt === null || typeof v.expiresAt === "number") &&
    Array.isArray(v.features)
  );
}

/**
 * Full evaluation of a license key: signature validity + expiry, producing
 * the {@link LicenseState} the rest of the app treats as ground truth.
 *
 * `activatedAt` is caller-supplied (not derived) so re-verifying an
 * already-activated license on every app launch doesn't reset its
 * activation timestamp — pass the previously stored value, or `null` when
 * activating for the first time (this function fills in "now" in that case).
 */
export function evaluateLicense(licenseKey: LicenseKey | null, previousActivatedAt: number | null = null): LicenseState {
  if (!licenseKey) {
    return { validity: "unactivated", plan: "free", licenseKey: null, payload: null, activatedAt: null };
  }

  const payload = verifyLicenseKey(licenseKey);
  if (!payload) {
    return { validity: "invalid", plan: "free", licenseKey, payload: null, activatedAt: null };
  }

  let validity: LicenseValidity = "valid";
  if (payload.expiresAt !== null && payload.expiresAt < Date.now()) {
    validity = "expired";
  }

  return {
    validity,
    // An expired or invalid license falls back to the free plan's limits.
    plan: validity === "valid" ? payload.plan : "free",
    licenseKey,
    payload,
    activatedAt: previousActivatedAt ?? Date.now(),
  };
}

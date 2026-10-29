/**
 * IANA time zone validation for free-text inputs (Settings → Profile).
 * A name like "Eastern Time" is not a zone: Postgres rejects it with 22023
 * and Intl throws a RangeError.
 */
let supported: Set<string> | null = null;
function supportedZones(): Set<string> | null {
  if (supported) return supported;
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  if (typeof intl.supportedValuesOf !== "function") return null;
  try { supported = new Set([...intl.supportedValuesOf("timeZone"), "UTC", "Etc/UTC"]); } catch { return null; }
  return supported;
}

/**
 * True for names in Intl.supportedValuesOf("timeZone") (plus UTC), or a
 * legacy alias the engine canonicalises to one of them (e.g. Asia/Calcutta,
 * US/Eastern), which is what some devices report as their own zone.
 */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  const name = (tz ?? "").trim();
  if (!name) return false;
  let canonical: string;
  try { canonical = new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone; } catch { return false; }
  const zones = supportedZones();
  if (!zones) return true; // old engine without supportedValuesOf: the Intl check above is all we have
  return zones.has(name) || zones.has(canonical);
}

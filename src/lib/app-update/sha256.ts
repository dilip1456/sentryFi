import { SHA256_RE } from "./version";

export const normalizeSha256 = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const v = s.trim().toLowerCase();
  return SHA256_RE.test(v) ? v : null;
};

/** Constant-shape comparison of two hex digests; false if either is malformed. */
export const sha256Matches = (expected: unknown, actual: unknown): boolean => {
  const a = normalizeSha256(expected);
  const b = normalizeSha256(actual);
  if (!a || !b) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** SHA-256 of bytes as lowercase hex (WebCrypto). Used by tests and as a JS-side cross-check. */
export const sha256Hex = async (data: ArrayBuffer | Uint8Array): Promise<string> => {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

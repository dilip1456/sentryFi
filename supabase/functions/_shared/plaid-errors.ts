/**
 * The only Plaid error fields that are safe to log. Plaid response bodies
 * (accounts/get, liabilities/get, item/remove, link/token/create, …) can carry
 * account names and masks, balances, owner names, addresses and the request
 * we sent, so never log a body whole: log plaidErrorSummary(body) instead.
 *
 * Pure TS with no imports so it runs in Deno (edge functions) and vitest.
 */
export interface PlaidErrorSummary {
  error_code: string | null;
  error_type: string | null;
  request_id: string | null;
  /** HTTP status, when the caller passes it. */
  status?: number;
}

export function plaidErrorSummary(body: unknown, status?: number): PlaidErrorSummary {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const out: PlaidErrorSummary = { error_code: str(b.error_code), error_type: str(b.error_type), request_id: str(b.request_id) };
  if (typeof status === 'number') out.status = status;
  return out;
}

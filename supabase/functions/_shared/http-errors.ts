// Safe summary of a failed upstream HTTP call (Groq / OpenAI-compatible APIs).
//
// Error bodies can echo the prompt, which carries the user's transactions,
// merchant names and balances, so they must never be logged, thrown or
// returned. Keep only the HTTP status plus the provider's error code / type
// and request id. Pure (no Deno imports) so vitest can exercise it.

export interface UpstreamErrorSummary {
  status: number;
  code: string | null;
  type: string | null;
  request_id: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v.length <= 120 ? v : null);

/** Summarise from the status, response headers and raw body text (which is then dropped). */
export function upstreamErrorSummary(status: number, headers?: Headers | null, bodyText?: string | null): UpstreamErrorSummary {
  let code: string | null = null;
  let type: string | null = null;
  let rid: string | null = null;
  try {
    const j = bodyText ? JSON.parse(bodyText) : null;
    const e = j && typeof j === "object" ? (j.error && typeof j.error === "object" ? j.error : j) : null;
    if (e) {
      code = str(e.code) ?? str(e.error_code);
      type = str(e.type) ?? str(e.error_type);
      rid = str(e.request_id) ?? str(j.request_id);
    }
  } catch { /* not JSON: keep nothing from it */ }
  rid = rid ?? str(headers?.get("x-request-id")) ?? str(headers?.get("request-id"));
  return { status, code, type, request_id: rid };
}

/** Read a failed Response's body only to extract the summary. */
export async function summarizeFailedResponse(res: Response): Promise<UpstreamErrorSummary> {
  const raw = await res.text().catch(() => "");
  return upstreamErrorSummary(res.status, res.headers, raw);
}

/** "status 400, code model_decommissioned, request req_1" (for Error messages / client errors). */
export function describeUpstreamError(s: UpstreamErrorSummary): string {
  return [`status ${s.status}`, s.code && `code ${s.code}`, s.type && `type ${s.type}`, s.request_id && `request ${s.request_id}`]
    .filter(Boolean).join(", ");
}

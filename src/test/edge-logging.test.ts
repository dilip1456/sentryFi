/**
 * Edge functions must never log a whole Plaid (or AI) response body: they
 * can carry account names/masks, balances, owner names and addresses.
 * Only error_code / error_type / request_id (+ HTTP status) are logged.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { plaidErrorSummary } from "../../supabase/functions/_shared/plaid-errors.ts";
import {
  describeUpstreamError, summarizeFailedResponse, upstreamErrorSummary,
} from "../../supabase/functions/_shared/http-errors.ts";

const FN_ROOT = path.resolve(__dirname, "../../supabase/functions");
const tsFiles = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
});

describe("plaidErrorSummary", () => {
  it("keeps only error_code, error_type, request_id (and status)", () => {
    const body = {
      error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", request_id: "req-123",
      error_message: "the login details of this item have changed",
      accounts: [{ account_id: "a1", name: "Dilip's Checking", mask: "1234", balances: { current: 5120.33 } }],
      item: { institution_id: "ins_1" }, owners: [{ names: ["Dilip"], addresses: [{ street: "1 Main" }] }],
    };
    const s = plaidErrorSummary(body, 400);
    expect(s).toEqual({ error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", request_id: "req-123", status: 400 });
    expect(JSON.stringify(s)).not.toMatch(/Dilip|1234|5120|Main|account_id|login details/);
  });
  it("tolerates junk", () => {
    expect(plaidErrorSummary(null)).toEqual({ error_code: null, error_type: null, request_id: null });
    expect(plaidErrorSummary("oops")).toEqual({ error_code: null, error_type: null, request_id: null });
    expect(plaidErrorSummary({ error_code: 42 })).toEqual({ error_code: null, error_type: null, request_id: null });
  });
});

describe("upstreamErrorSummary (Groq / OpenAI-style errors)", () => {
  const body = JSON.stringify({ error: { message: "Bad prompt: Dilip spent $5,120.33 at Whole Foods ...", type: "invalid_request_error", code: "model_decommissioned" } });
  it("keeps status, code, type and request id only", () => {
    const s = upstreamErrorSummary(400, new Headers({ "x-request-id": "req_9" }), body);
    expect(s).toEqual({ status: 400, code: "model_decommissioned", type: "invalid_request_error", request_id: "req_9" });
    expect(describeUpstreamError(s)).toBe("status 400, code model_decommissioned, type invalid_request_error, request req_9");
    expect(JSON.stringify(s)).not.toMatch(/Dilip|5,120|Whole Foods|prompt/);
  });
  it("drops non-JSON bodies entirely", async () => {
    const s = await summarizeFailedResponse(new Response("<html>Dilip's statement</html>", { status: 502 }));
    expect(s).toEqual({ status: 502, code: null, type: null, request_id: null });
  });
});

type SinkKind = "log" | "throw" | "response";
/** Every console.*(...), new Error(...) and json({ error: ... }) argument list (single line). */
const sinks = (src: string): { kind: SinkKind; args: string }[] => [
  ...[...src.matchAll(/console\.(?:log|info|warn|error|debug)\(([^;\n]*)\)/g)].map(m => ({ kind: "log" as const, args: m[1] })),
  ...[...src.matchAll(/new Error\(([^;\n]*)\)/g)].map(m => ({ kind: "throw" as const, args: m[1] })),
  ...[...src.matchAll(/json\(\s*\{\s*error:([^;\n]*)\)/g)].map(m => ({ kind: "response" as const, args: m[1] })),
];

/** Drop string-literal text (keep only ${...} expressions of template literals). */
const codeOnly = (s: string) => s
  .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
  .replace(/`(?:[^`\\]|\\.)*`/g, tl => (tl.match(/\$\{[^}]*\}?\)*\}?/g) ?? []).join(" "));

// Identifiers that hold a Plaid / AI / HTTP response body in these functions.
const BODY_VARS = ["data", "body", "accData", "exData", "credData", "aiResponse", "rawText", "text", "errText", "errBody", "responseText", "resText", "raw"];
const SAFE_FIELDS = "length|error_code|error_type|request_id|status|code";

/**
 * Why a sink's arguments leak a body, or null. Plaid's human error_message
 * may go back to the signed-in user in a response, never into logs/errors.
 */
function leak(args: string, kind: SinkKind = "log"): string | null {
  const s = codeOnly(args).replace(/plaidErrorSummary\([^)]*\)/g, "").replace(/(summarizeFailedResponse|describeUpstreamError|upstreamErrorSummary)\([^)]*\)+/g, "");
  if (/\.(text|json)\(\)/.test(s)) return "reads a response body (.text()/.json())";
  if (kind !== "response" && /error_message/.test(s)) return "error_message";
  if (/JSON\.stringify\(\s*(data|body)/.test(s)) return "JSON.stringify(body)";
  for (const v of BODY_VARS) {
    // bare use, a template-literal ${v...}, or v.slice()/substring()/anything but a safe field
    const safe = kind === "response" ? `${SAFE_FIELDS}|error_message` : SAFE_FIELDS;
    const re = new RegExp(`(^|[^\\w.$])${v}(?![\\w$])(?!\\??\\.(?:${safe})\\b)`);
    if (re.test(s)) return `uses ${v}`;
  }
  return null;
}

describe("the leak detector itself", () => {
  it.each([
    ['"[x] Groq error:", res.status, rawText.slice(0, 300)'],
    ["`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`"],
    ["'[x] Groq error:', errText"],
    ["`Groq API error: ${errText.slice(0, 300)}`"],
    ["'[x]', await res.json()"],
    ['"[x]", data'],
    ["`failed: ${text}`"],
    ['"[x]", body.substring(0, 50)'],
    ["`x ${data.error_message}`"],
  ])("flags %s", (args) => { expect(leak(args)).not.toBeNull(); });
  it("flags a whole body returned to the client, allows Plaid's error_message there", () => {
    expect(leak("exData.error_message || 'failed', detail: exData }, 400", "response")).not.toBeNull();
    expect(leak("exData.error_message || 'failed', detail: plaidErrorSummary(exData) }, 400", "response")).toBeNull();
  });
  it.each([
    ["'[x] accounts/get error:', plaidErrorSummary(data, res.status)"],
    ["'[x] Groq error:', await summarizeFailedResponse(res)"],
    ["`Groq error (${describeUpstreamError(await summarizeFailedResponse(res))})`"],
    ["'[x] AI text length', text.length"],
    ["'[x]', data.error_code, data?.request_id"],
    ['"Plaid error"'],
  ])("allows %s", (args) => { expect(leak(args)).toBeNull(); });
});

describe("edge functions don't log, throw or return response bodies", () => {
  const files = tsFiles(FN_ROOT);

  it("finds the edge functions", () => { expect(files.length).toBeGreaterThan(10); });

  it.each(files.map(f => [path.relative(FN_ROOT, f), f]))("%s", (_rel, file) => {
    const offenders = sinks(readFileSync(file as string, "utf8"))
      .map(({ kind, args }) => ({ kind, args: args.trim(), why: leak(args, kind) }))
      .filter(o => o.why);
    expect(offenders).toEqual([]);
  });

  it("plaid-sync-transactions logs an accounts/get error via the summary", () => {
    const src = readFileSync(path.join(FN_ROOT, "plaid-sync-transactions/index.ts"), "utf8");
    expect(src).toMatch(/accounts\/get error:', plaidErrorSummary\(data, res\.status\)/);
  });
});

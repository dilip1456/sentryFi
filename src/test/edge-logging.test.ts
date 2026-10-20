/**
 * Edge functions must never log a whole Plaid (or AI) response body: they
 * can carry account names/masks, balances, owner names and addresses.
 * Only error_code / error_type / request_id (+ HTTP status) are logged.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { plaidErrorSummary } from "../../supabase/functions/_shared/plaid-errors.ts";

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

describe("edge functions don't log response bodies", () => {
  // Identifiers that hold a parsed Plaid / AI response in these functions.
  const BODY_VARS = ["data", "body", "accData", "exData", "credData", "aiResponse", "rawText", "text"];
  const consoleCalls = (src: string) => [...src.matchAll(/console\.(?:log|info|warn|error|debug)\(([^;\n]*)\)/g)].map(m => m[1]);
  const files = tsFiles(FN_ROOT);

  it("finds the edge functions", () => { expect(files.length).toBeGreaterThan(10); });

  it.each(files.map(f => [path.relative(FN_ROOT, f), f]))("%s", (_rel, file) => {
    const offenders = consoleCalls(readFileSync(file as string, "utf8")).filter(args => {
      // args of the console call, minus anything wrapped in plaidErrorSummary(...)
      const stripped = args.replace(/plaidErrorSummary\([^)]*\)/g, "");
      return BODY_VARS.some(v => new RegExp(`(^|[\\s,(])${v}(?![\\w.(?]|\\?\\.|\\.length)`).test(stripped))
        || /error_message|JSON\.stringify\(\s*(data|body)/.test(stripped);
    });
    expect(offenders).toEqual([]);
  });

  it("plaid-sync-transactions logs an accounts/get error via the summary", () => {
    const src = readFileSync(path.join(FN_ROOT, "plaid-sync-transactions/index.ts"), "utf8");
    expect(src).toMatch(/accounts\/get error:', plaidErrorSummary\(data, res\.status\)/);
  });
});

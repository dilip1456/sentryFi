/**
 * user_settings, alert_log and alert_preferences were created by hand on the
 * live project; the baseline migrations create them on a fresh project
 * (`supabase db reset`) and must be no-ops where they already exist.
 */
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8");

describe.each(["user_settings", "alert_log", "alert_preferences"])("baseline for %s", (table) => {
  const baseline = files.find(f => f.endsWith(`_baseline_${table}.sql`));
  it("exists and sorts before every other migration that references the table", () => {
    expect(baseline).toBeDefined();
    const first = files.find(f => f !== baseline && new RegExp(`\\b${table}\\b`).test(read(f).replace(/--.*$/gm, "")));
    expect(first).toBeDefined();
    expect(files.indexOf(baseline!)).toBeLessThan(files.indexOf(first!));
  });
  it("does nothing when the table already exists (production)", () => {
    const sql = read(baseline!);
    expect(sql).toMatch(new RegExp(`IF to_regclass\\('public\\.${table}'\\) IS NOT NULL THEN[\\s\\S]*?RETURN;`));
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    // every statement lives inside the guarded DO block
    const outside = sql.replace(/--.*$/gm, "").replace(/DO \$\$[\s\S]*?END \$\$;/g, "").trim();
    expect(outside).toBe("");
  });
  it("enables RLS with an owner policy and never grants to anon", () => {
    const sql = read(baseline!);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY[\s\S]*auth\.uid\(\)\) = user_id/);
    expect(sql).not.toMatch(/GRANT[^;]*TO[^;]*\banon\b/i);
  });
});

describe("pg_cron migrations skip cleanly without pg_cron (fresh supabase db reset)", () => {
  it.each(files.filter(f => /\bcron\.(schedule|unschedule|job)\b/.test(read(f).replace(/--.*$/gm, ""))))("%s", (f) => {
    const sql = read(f).replace(/--.*$/gm, "");
    const guard = sql.search(/IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\) THEN[\s\S]*?RETURN;/);
    const firstUse = sql.search(/\bcron\.(schedule|unschedule|job)\b/);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(firstUse);
  });
});

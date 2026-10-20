// Classify PostgREST / Postgres errors so a screen can degrade gracefully when
// the live database is behind the migrations in supabase/migrations (e.g. a
// column or table the code expects hasn't been created yet) instead of
// spinning forever.

export interface PgError { code?: string | null; message?: string | null; details?: string | null; hint?: string | null }

const text = (e: PgError) => `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`;

/** Column referenced by select/filter/order doesn't exist (Postgres 42703, PostgREST PGRST204). */
export const isMissingColumnError = (e: PgError | null | undefined, column?: string): boolean => {
  if (!e) return false;
  const t = text(e);
  const hit = e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(t);
  return hit && (!column || t.includes(column));
};

/** Table/relation doesn't exist or isn't in PostgREST's schema cache (42P01, PGRST205 → HTTP 404). */
export const isMissingTableError = (e: PgError | null | undefined): boolean => {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST200"
    || /relation .* does not exist|could not find the table/i.test(text(e));
};

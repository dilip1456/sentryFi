# Security hardening (2026-10-20 audit follow-up)

This file goes with the `fix/security-hardening` PR. It covers the code-level
fixes from the 2026-10-20 audit and what the owner still has to do by hand.
Nothing here rotates keys, changes repo settings, or applies migrations.

## Migrations: apply in this order

| # | File | Audit | Before applying |
|---|------|-------|-----------------|
| 1 | `20261020170000_plaid_items_hide_access_token.sql` | H2 | none |
| 2 | `20261020170100_rls_owner_policies.sql` | H4 | Read the `WARNING` lines it prints (permissive leftover policies) |
| 3 | `20261020170200_profiles_protect_disabled.sql` | M2 | Deploy the `admin-set-user-disabled` function **with or before** the frontend |
| 4 | `20261020170300_send_alerts_cron_secret.sql` | M1 | Create the Vault secrets `send_alerts_cron_secret` and `anon_key`, and set the `CRON_SECRET` function secret, first (see below). It raises an error if either Vault secret is missing |
| 5 | `20261020170400_has_role_self_only.sql` | L2 | none |

All five can be re-run safely. #2 works in either order with PR #4
(`20261020120100_user_settings_unique_user_id.sql` and
`20261020120200_card_benefits_ensure.sql`):
- It never creates tables.
- It skips any table that does not exist yet.
- It uses PR #4's policy names for `user_settings` and `card_benefits`, so whichever file runs second does nothing for those policies.

If #2 printed `skipped` for a table, run it again after the table exists.

Before merging, all five were run against a local Postgres 17 with Supabase-like
roles (anon, authenticated, service_role, `auth.uid()`). The run covered both
orders relative to PR #4 and a second run of each file.

Results:
- authenticated can no longer read `plaid_items.access_token`. The columns the app selects still work.
- anon has no access to any of the 7 tables.
- alert_log: owners can read their rows and mark them read, and nothing else.
- Users cannot change `profiles.disabled` on their own row, or on anyone's row through the API. service_role can.
- `has_role(<other uid>, 'admin')` returns false.

## Deploy order (owner)

1. Pick a cron secret: `openssl rand -hex 32`.
2. `supabase secrets set CRON_SECRET=<secret>`
3. In the SQL editor, run `select vault.create_secret('<secret>', 'send_alerts_cron_secret');`.
   Then run `select vault.create_secret('<anon key>', 'anon_key');` too, unless an `anon_key` secret already exists.
   After this, the cron job no longer has the anon JWT hard-coded (L5).
4. Apply migrations 1–5 in order.
5. Deploy these functions: `supabase functions deploy send-alerts ai-categorize fetch-card-benefits admin-set-user-disabled plaid-grant-consent`. Every other function only got its supabase-js version pinned, so redeploy them when convenient.
6. Deploy the frontend (Vercel) and merge so CI builds and signs a new APK. The APK picks up Capacitor 8.5.3 and the Android hardening.
7. In the dashboard, check that **verify JWT** is on for every function.

## Owner-only actions (not done in this PR)

- **C1 / H1, leaked release keystore.**
  - Treat the old key (`54c3eb21…`) as permanently compromised and delete every local copy.
  - Confirm the new keystore was freshly generated and uses new passwords.
  - Tell users on builds from 2026-07-10 to 2026-10-18 to uninstall and reinstall.
  - In Firebase/GCP, add the new cert's SHA-1/SHA-256 and remove the old fingerprint.
  - Open a GitHub Support request to purge cached objects and `refs/pull/1`, `refs/pull/2` (SHAs `9210e408…` through `18407b18…`).
  - Optional and destructive: delete the Actions runs that point at pre-scrub SHAs.
- **H2.** Confirm whether the live schema came from `migrations/` or from `supabase-schema.sql`. If you suspect abuse, call Plaid `/item/access_token/invalidate` for each item.
- **H4.** Run these in the SQL editor:
  - `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r';`
  - Review `pg_policies` for the 7 tables.
  - Run the Security Advisor.
- **M2.** Users who were already disabled are **not** banned yet. After deploy, toggle each one off and on in Admin → Users. List them with `select user_id from profiles where disabled;`. A banned user's current access token keeps working until it expires (default 1 h).
- **M5.** Delete the `latest` pre-release and its 12 debug-signed APKs. Plan a move away from committing `public/downloads/SentryFi.apk` to git.
- **M6.** After deploy, run `curl -sI https://sentryfiapp.vercel.app | grep -i content-security` and watch the browser console for CSP violations on Plaid Link, Google sign-in and statement import. The CSP allows `*.supabase.co`. Tighten it to the project host if you like.
- **M7.**
  - Enable secret scanning, push protection, Dependabot alerts and Dependabot security updates.
  - Protect `main`. The APK workflow pushes the APK to `main`, so allow `github-actions[bot]` to bypass, or stop committing the APK first.
  - Optionally require SHA-pinned actions in repo settings.
- **L5.** Pause or delete the old Supabase project `xvxo…` if it still exists. Consider the new `sb_publishable_` keys.
- **L6.** Restrict the Firebase API key `AIza…_1hc` to Android app `com.sentryfi.app` plus the new cert, and to FCM and Installations only. Make sure the Generative Language API is disabled.
- **L7.** In GitHub email settings, turn on "Keep my email private" and "Block command line pushes that expose my email".
- Check the Supabase Auth redirect allow-list and the Plaid dashboard redirect URIs.

## M3: gift card number / PIN encryption (design, not implemented)

Goal: a stolen session or a DB read must not reveal full card numbers or PINs.
They should be revealed only after an explicit user action.

1. Add `gift_card_secrets(card_id uuid pk references gift_cards on delete cascade, user_id uuid, card_number_ct bytea, pin_ct bytea, key_id uuid, updated_at)`.
   - RLS on, **no** policies, so it is service_role only.
   - Keep `gift_cards.card_last4` for display.
2. Encrypt with an AEAD key in Supabase Vault (`vault.create_secret`), or pgsodium `crypto_aead_det_encrypt` with a key id, inside two edge functions:
   - `gift-card-secret-put`: validates the JWT, checks the user owns the card, encrypts, upserts.
   - `gift-card-secret-reveal`: validates the JWT, checks ownership, applies a per-user rate limit, writes an audit row to `gift_card_activity`, and returns the plaintext once.
3. Client changes:
   - Stop selecting `*` from `gift_cards`.
   - Show `•••• 1234`.
   - A "Reveal" button calls the reveal function. Never cache the result in state longer than the dialog is open.
4. Migration: one service_role backfill moves `card_number` / `pin` into `gift_card_secrets`, then sets the plaintext columns to NULL. Drop them in a later release.
5. Optional: client-side encryption with a user passphrase (zero-knowledge). This protects against a DB compromise too, but recovery is harder.

This was left out because it touches about 40 places in `GiftCardsSection.tsx`, which PR #4 is also changing.

## Remaining lower-severity items (listed, not fixed)

- **L3.** `send-alerts` still emails `alert_preferences.email`, which the user chooses and nobody verifies. Changing that removes a feature, so it needs a verify-address flow first. The HTML injection part **is** fixed: the email body is now escaped.
- **L4.**
  - CORS is still `*`. Restricting it needs the final list of web origins plus `capacitor://localhost` / `https://localhost`.
  - Generic errors are in place for the functions this PR touched. Other Plaid functions still return raw error text and details.
- **M4.** R8/minify is still off in release builds. It needs ProGuard rules for Capacitor plugins, plus on-device testing.
- **AI functions.** They now require a user JWT, but there is no per-user rate limit yet.
- **L9.**
  - `@capacitor/cli` moved to devDependencies, so `tar` is now 7.5.22.
  - Still open: `react-router-dom` 6.x (GHSA-wrjc-x8rr-h8h6, fixed only in 7.18) and dev-only advisories (`npm audit`: 36 total, 2 runtime-moderate). These need major upgrades.
- **L10 / M5.** Repo bloat from committed APKs.

import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { APP_VERSION } from "@/lib/constants";

const Privacy = () => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="max-w-[760px] mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        <Link to="/welcome" className="inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to SentryFi
        </Link>
        <div className="font-display text-sm text-foreground">Privacy Policy</div>
      </div>
    </header>

    <main className="max-w-[760px] mx-auto px-4 md:px-8 py-10 md:py-14">
      <div className="mb-8 rounded-xl border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] px-4 py-3 text-[13px] text-foreground">
        <strong>Draft — pending legal review.</strong> This is placeholder language, not a finished legal
        document. Have an attorney review and finalize this page — especially the data-handling
        commitments — before relying on it as a binding privacy notice.
      </div>

      <h1 className="font-display text-3xl md:text-4xl mb-2">Privacy Policy</h1>
      <p className="text-[13px] text-muted-foreground mb-10">Last updated: August 16, 2026 · SentryFi v{APP_VERSION}</p>

      <div className="space-y-7 text-[14.5px] leading-[1.7] text-foreground/90">
        <section>
          <h2 className="text-[15px] font-semibold mb-2">1. What we collect</h2>
          <p>Account info you give us directly (email, display name, and profile photo if you sign in
          with Google). Financial data from institutions you connect through Plaid — account names,
          balances, and transactions — on a read-only basis. Any manual accounts, budgets, categories,
          or gift card details you add yourself. Basic usage analytics to keep the app working reliably.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">2. What we don't do</h2>
          <p>SentryFi cannot initiate transfers, payments, or any changes to your linked accounts —
          Plaid access is read-only. We don't sell your financial data to third parties.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">3. How we use your data</h2>
          <p>To calculate the figures the app shows you (True Available Funds, budgets, net worth, upcoming
          bills), to detect recurring transactions and generate suggestions, to send you notifications
          you've opted into, and to operate and improve the Service.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">4. Who we share it with</h2>
          <p>Plaid, to establish and maintain your bank connections. Supabase, our database and
          authentication provider, which stores your account data. Payment processors, if and when you
          subscribe to a paid plan. We do not share your data with advertisers.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">5. Gift card and sensitive details</h2>
          <p>Gift card numbers and PINs you choose to store are kept behind a reveal-to-view control in
          the app. Treat any device you're signed into as sensitive, the same as you would a banking app.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">6. Data retention and deletion</h2>
          <p>You can permanently delete your account and associated data at any time from Profile &amp;
          Settings. Deletion disconnects every linked bank and removes your stored data from our systems.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">7. Security</h2>
          <p>Data is encrypted in transit. Your bank credentials are never entered into or stored by
          SentryFi — Plaid's secure flow handles authentication with your institution directly.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">8. Your choices</h2>
          <p>You can disconnect a linked bank, delete manual accounts or gift cards, adjust notification
          preferences, or delete your account entirely — all from within the app.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">9. Changes to this policy</h2>
          <p>We may update this Privacy Policy from time to time. We'll post the revised version here
          with an updated date.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">10. Contact</h2>
          <p>Questions about this policy or your data? Reach out at <span className="text-foreground">support@sentryfiapp.com</span> (update with your real support address).</p>
        </section>
      </div>

      <p className="mt-10 text-[12.5px] text-muted-foreground">
        See also our <Link to="/terms" className="underline underline-offset-2">Terms of Service</Link>.
      </p>
    </main>
  </div>
);

export default Privacy;

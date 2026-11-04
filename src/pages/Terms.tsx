import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { APP_VERSION } from "@/lib/constants";

const Terms = () => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="max-w-[760px] mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        <Link to="/welcome" className="inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Sentry Finance
        </Link>
        <div className="font-display text-sm text-foreground">Terms of Service</div>
      </div>
    </header>

    <main className="max-w-[760px] mx-auto px-4 md:px-8 py-10 md:py-14">
      <div className="mb-8 rounded-xl border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] px-4 py-3 text-[13px] text-foreground">
        <strong>Draft, pending legal review.</strong> This is placeholder language, not a finished legal
        document. Have an attorney review and finalize this page before relying on it as a binding
        agreement with users.
      </div>

      <h1 className="font-display text-3xl md:text-4xl mb-2">Terms of Service</h1>
      <p className="text-[13px] text-muted-foreground mb-10">Last updated: August 16, 2026 · Sentry Finance v{APP_VERSION}</p>

      <div className="space-y-7 text-[14.5px] leading-[1.7] text-foreground/90">
        <section>
          <h2 className="text-[15px] font-semibold mb-2">1. Acceptance of terms</h2>
          <p>By creating an account or using Sentry Finance ("the Service"), you agree to these Terms of Service.
          If you don't agree, don't use the Service.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">2. What Sentry Finance does</h2>
          <p>Sentry Finance connects to your financial accounts through Plaid on a read-only basis and
          calculates budgeting and net-worth figures (such as "True Available Funds") from that data.
          Sentry Finance cannot move money, initiate payments, or make any changes to your linked accounts.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">3. Not financial advice</h2>
          <p>Sentry Finance is a budgeting and tracking tool. Nothing in the Service is investment, tax, or
          financial advice, and Sentry Finance is not a licensed financial advisor. Decisions you make based on
          information shown in the app are your responsibility.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">4. Your account</h2>
          <p>You're responsible for keeping your login credentials secure and for all activity under your
          account. Tell us right away if you believe your account has been accessed without authorization.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">5. Acceptable use</h2>
          <p>Don't use the Service to break the law, attempt to access other users' data, reverse-engineer
          the app, or interfere with its normal operation.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">6. Subscriptions and billing</h2>
          <p>Paid plans, when available, are billed on a recurring basis and can be canceled at any time;
          cancellation takes effect at the end of the current billing period. Pricing details live on the
          <Link to="/pricing" className="underline underline-offset-2 mx-1">Pricing page</Link>
          and may change with notice.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">7. Termination</h2>
          <p>You can delete your account at any time from Profile &amp; Settings. We may suspend or
          terminate accounts that violate these terms.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">8. Disclaimers and limitation of liability</h2>
          <p>The Service is provided "as is" without warranties of any kind. Sentry Finance is not liable for
          financial decisions made using the app, or for interruptions, inaccuracies, or delays in data
          synced from third parties such as Plaid or your financial institutions.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">9. Changes to these terms</h2>
          <p>We may update these Terms from time to time. Continued use of the Service after an update
          means you accept the revised Terms.</p>
        </section>

        <section>
          <h2 className="text-[15px] font-semibold mb-2">10. Contact</h2>
          <p>Questions about these Terms? Reach out at <span className="text-foreground">support@sentryfiapp.com</span> (update with your real support address).</p>
        </section>
      </div>
    </main>
  </div>
);

export default Terms;

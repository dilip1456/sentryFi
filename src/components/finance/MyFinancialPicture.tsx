/**
 * My Financial Picture: one inventory of Dilip's financial life (Nov 2026,
 * "a full picture of all my finances and obligations and savings and
 * expenses in one place"): a compact summary, the review queue (only when
 * something needs a decision), Income, Obligations & expenses (weekly to
 * yearly: Upcoming / By cadence / By category), Savings & contributions and
 * Accounts & balances. Every row shows its amount, how often, next date,
 * status and yearly total.
 *
 * mode="insights" is the separate Insights screen: taxes, where the money
 * goes, recommendations and the editable monthly breakdown (the old "Your
 * Data" and insight cards), built from the same model.
 *
 * Desktop opens details in dialogs; phones push full screens for sections and
 * open bottom sheets (vaul) for a single row. Every open is a history entry,
 * so Back closes it. Until the person's saved review decisions are loaded the
 * page shows its own skeleton (never a guessed review or another layout).
 *
 * Figures come from the shared model in src/lib/picture (which reuses
 * src/lib/classify, src/lib/recurring and src/lib/infer). Edits are one
 * settings patch per action through useUserSettings().update.
 */
import { ArrowLeft, ChartNoAxesColumnDecreasing, Check, FlaskConical, Lightbulb, Pencil } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import "./picture/picture.css";
import { PictureProvider, usePicture, type MyFinancialPictureProps } from "./picture/state";
import { OverlayProvider, useOverlay } from "./picture/overlays";
import { DataDesktop, DataMobile } from "./picture/data-column";
import { InsightsDesktop, InsightsMobile } from "./picture/insights";
import { renderDetail } from "./picture/details";
import { HistoryHintPublisher } from "./picture/history-hint";
import { AccountedCard, AllocationCard, CategoryCard, RecsCard, ReviewQueue, TaxCard, UpcomingPlan, renderPlanDetail } from "./picture/plan";
import { AccountsSection, IncomeSection, InsightsLink, PictureSummary, SavingsSection, renderInventoryDetail } from "./picture/inventory";
import { PictureSkeleton } from "./picture/PictureSkeleton";
import { fmt } from "./picture/bits";

export type { MyFinancialPictureProps, PictureSettingsPatch } from "./picture/state";
export type PictureMode = "picture" | "insights";

function PeriodSeg() {
  const { full, setFull } = usePicture();
  return (
    <div className="seg" role="group" aria-label="Period">
      <button type="button" aria-pressed={!full} onClick={() => setFull(false)}>Monthly</button>
      <button type="button" aria-pressed={full} onClick={() => setFull(true)}>Full Picture</button>
    </div>
  );
}

const ExampleTag = () => <span className="example-tag"><FlaskConical className="h-3 w-3" aria-hidden="true" />Example data</span>;

function PicturePage({ isMobile }: { isMobile: boolean }) {
  const pc = usePicture();
  const nav = pc.props.onNavigate;
  if (isMobile) {
    return (
      <div className="px-4 pt-3 pb-28 fp-one" data-testid="picture-page">
        <div className="flex items-center gap-2">{pc.demo && <ExampleTag />}<span className="text-[12.5px] text-muted-foreground">All your money in one place · {pc.today.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span></div>
        <PictureSummary />
        <ReviewQueue />
        <IncomeSection />
        <UpcomingPlan />
        <AccountedCard />
        <SavingsSection />
        <AccountsSection />
        <InsightsLink />
      </div>
    );
  }
  return (
    <div className="content-max px-8 pt-6 pb-12 fp-one" data-testid="picture-page">
      <div className="flex items-center gap-4 pb-2 flex-wrap">
        <div className="min-w-0 flex items-center gap-2 mr-auto">
          <h1 className="font-display text-[28px] font-semibold">My Financial Picture</h1>
          {pc.demo && <ExampleTag />}
        </div>
        {nav && <button type="button" className="btn tap-44" onClick={() => nav("insights")}><Lightbulb className="h-4 w-4" aria-hidden="true" />Insights</button>}
      </div>
      <p className="text-[13px] text-muted-foreground -mt-1">Everything you earn, owe, pay and set aside, weekly to yearly, and whether it's all accounted for.</p>
      <PictureSummary />
      <ReviewQueue />
      <div className="fp-one-grid">
        <div className="min-w-0">
          <UpcomingPlan />
          <AccountedCard />
        </div>
        <div className="min-w-0">
          <IncomeSection />
          <SavingsSection />
          <AccountsSection />
        </div>
      </div>
      <InsightsLink />
    </div>
  );
}

function InsightsContext() {
  const { plan } = usePicture();
  return (
    <p className="pl-context ins-context" data-testid="insights-context">
      Net worth <b>{fmt(plan.nw.netWorth)}</b> · Cash <b>{fmt(plan.cash)}</b> · Take-home <b>{fmt(plan.incomeMonthly)}/mo</b>{plan.savingsRate.pct != null && <> · Savings rate <b>{plan.savingsRate.pct}%</b></>}
    </p>
  );
}

function InsightsPage({ isMobile }: { isMobile: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const nav = pc.props.onNavigate;
  const periodLabel = pc.full ? `${pc.year}, whole year` : pc.today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const back = nav && <button type="button" className="btn tap-44" onClick={() => nav("myfinances")} aria-label="Back to Picture"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Picture</button>;
  if (isMobile) {
    return (
      <div className="px-4 pt-3 pb-28 fp-one" data-testid="insights-page">
        <div className="flex items-center gap-2 flex-wrap">{pc.demo && <ExampleTag />}<span className="text-[12.5px] text-muted-foreground mr-auto">Taxes, where your money goes and tips</span>{back}</div>
        <InsightsContext />
        <RecsCard />
        <AllocationCard />
        <CategoryCard />
        <TaxCard />
        <div className="mt-6"><PeriodSeg /><p className="text-[12.5px] text-muted-foreground mt-2">{periodLabel}</p></div>
        <section aria-labelledby="yd-h" className="mt-4"><DataMobile /></section>
        <section aria-labelledby="in-h" className="mt-6"><InsightsMobile /></section>
      </div>
    );
  }
  return (
    <div className="content-max px-8 pt-6 pb-12 fp-one" data-testid="insights-page">
      <div className="flex items-center gap-3 pb-2 flex-wrap">
        <div className="min-w-0 flex items-center gap-2 mr-auto">
          <h1 className="font-display text-[28px] font-semibold">Insights</h1>
          {pc.demo && <ExampleTag />}
        </div>
        <button type="button" className="btn tap-44" onClick={() => open("cashflow")}><ChartNoAxesColumnDecreasing className="h-4 w-4" aria-hidden="true" />Where it goes</button>
        {back}
      </div>
      <p className="text-[13px] text-muted-foreground -mt-1">What your numbers say: taxes paid and saved, where your money goes, and what to do next. Estimates, from your own data.</p>
      <InsightsContext />
      <div className="fp-one-grid">
        <div className="min-w-0"><RecsCard /><AllocationCard /></div>
        <div className="min-w-0"><TaxCard /><CategoryCard /></div>
      </div>
      <div className="fp-one-period">
        <div><h2 className="font-display text-[22px] font-semibold">Monthly breakdown</h2><p className="text-[13px] text-muted-foreground">{periodLabel}. Income, paycheck deductions, bills, budgets, cards and savings — all editable.</p></div>
        <div className="flex items-center gap-2"><PeriodSeg />{!pc.full && (pc.editing
          ? <><button type="button" className="btn" onClick={pc.cancelEdit}>Cancel</button><button type="button" className="btn-gold" onClick={pc.saveEdit}><Check className="h-4 w-4" aria-hidden="true" />Done</button></>
          : <button type="button" className="btn" onClick={pc.startEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</button>)}</div>
      </div>
      <div className="grid grid-cols-2 gap-6 xl:gap-8 items-start mt-2">
        <section aria-labelledby="yd-h"><DataDesktop showEditAction={false} /></section>
        <section aria-labelledby="in-h"><InsightsDesktop /></section>
      </div>
    </div>
  );
}

function WithOverlays({ mode }: { mode: PictureMode }) {
  const isMobile = useIsMobile();
  const pc = usePicture();
  if (!pc.ready) return <PictureSkeleton insights={mode === "insights"} />;
  return (
    <OverlayProvider isMobile={isMobile} render={key => renderInventoryDetail(key, pc) ?? renderPlanDetail(key, pc) ?? renderDetail(key, pc)}>
      <HistoryHintPublisher />
      {mode === "insights" ? <InsightsPage isMobile={isMobile} /> : <PicturePage isMobile={isMobile} />}
    </OverlayProvider>
  );
}

export function MyFinancialPicture({ mode = "picture", ...props }: MyFinancialPictureProps & { mode?: PictureMode }) {
  return (
    <div className="fp" data-testid={mode === "insights" ? "financial-insights" : "financial-picture"}>
      <PictureProvider props={props}><WithOverlays mode={mode} /></PictureProvider>
    </div>
  );
}

export default MyFinancialPicture;

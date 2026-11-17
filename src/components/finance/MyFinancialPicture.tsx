/**
 * My Financial Picture: the one place for everything Dilip has to pay or plan
 * for (weekly to yearly, detected or added by hand), whether it's all
 * accounted for, where the money goes, taxes, recommendations, and net worth
 * as context — then the editable monthly plan ("Your Data") and insights.
 *
 * Merged from the old "My Financial Picture" and "Picture Preview" screens
 * (Nov 2026): the classic page's dense Your Data / Insights and phone cards,
 * the preview's summary-first layout and header Edit, plus the new plan.
 * Desktop opens details in dialogs; phones push full screens for sections and
 * open bottom sheets (vaul) for a single row. Every open is a history entry,
 * so Back closes it.
 *
 * Figures come from the shared model in src/lib/picture (which reuses
 * src/lib/classify, src/lib/recurring and src/lib/infer). Edits are one
 * settings patch per action through useUserSettings().update.
 */
import { ChartNoAxesColumnDecreasing, FlaskConical, Pencil } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import "./picture/picture.css";
import { PictureProvider, usePicture, type MyFinancialPictureProps } from "./picture/state";
import { OverlayProvider, useOverlay } from "./picture/overlays";
import { DataDesktop, DataMobile } from "./picture/data-column";
import { InsightsDesktop, InsightsMobile } from "./picture/insights";
import { renderDetail } from "./picture/details";
import { HistoryHintPublisher } from "./picture/history-hint";
import { AccountedCard, AllocationCard, CategoryCard, MoreCard, NetWorthCard, PlanSummary, RecsCard, ReviewQueue, TaxCard, UpcomingPlan, renderPlanDetail } from "./picture/plan";

export type { MyFinancialPictureProps, PictureSettingsPatch } from "./picture/state";

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

function Page({ isMobile }: { isMobile: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const periodLabel = pc.full ? `${pc.year}, whole year` : pc.today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (isMobile) {
    return (
      <div className="px-4 pt-3 pb-28 fp-one">
        <div className="flex items-center gap-2">{pc.demo && <ExampleTag />}<span className="text-[12.5px] text-muted-foreground">Everything you pay or plan for · {pc.today.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span></div>
        <HistoryHintPublisher />
        <PlanSummary />
        <ReviewQueue />
        <UpcomingPlan />
        <AccountedCard />
        <RecsCard />
        <CategoryCard />
        <AllocationCard />
        <TaxCard />
        <NetWorthCard />
        <MoreCard />
        <div className="mt-6"><PeriodSeg /><p className="text-[12.5px] text-muted-foreground mt-2">{periodLabel}</p></div>
        <section aria-labelledby="yd-h" className="mt-4"><DataMobile /></section>
        <section aria-labelledby="in-h" className="mt-6"><InsightsMobile /></section>
      </div>
    );
  }
  return (
    <div className="content-max px-8 pt-6 pb-12 fp-one">
      <div className="flex items-center gap-4 pb-2 flex-wrap">
        <div className="min-w-0 flex items-center gap-2 mr-auto">
          <h1 className="font-display text-[28px] font-semibold">My Financial Picture</h1>
          {pc.demo && <ExampleTag />}
        </div>
        <button type="button" className="btn" onClick={() => open("cashflow")}><ChartNoAxesColumnDecreasing className="h-4 w-4" aria-hidden="true" />Where it goes</button>
      </div>
      <p className="text-[13px] text-muted-foreground -mt-1">Everything you pay or plan for, weekly to yearly, and whether it's all accounted for.</p>
      <HistoryHintPublisher />
      <PlanSummary />
      <div className="fp-one-grid">
        <div className="min-w-0">
          <ReviewQueue />
          <UpcomingPlan />
          <CategoryCard />
          <AllocationCard />
        </div>
        <div className="min-w-0">
          <AccountedCard />
          <RecsCard />
          <TaxCard />
          <NetWorthCard />
          <MoreCard />
        </div>
      </div>
      <div className="fp-one-period">
        <div><h2 className="font-display text-[22px] font-semibold">Monthly plan & insights</h2><p className="text-[13px] text-muted-foreground">{periodLabel}. Income, paycheck deductions, bills, budgets, cards and savings — all editable.</p></div>
        <div className="flex items-center gap-2"><PeriodSeg />{!pc.full && <button type="button" className="btn" onClick={pc.editing ? pc.cancelEdit : pc.startEdit}><Pencil className="h-4 w-4" aria-hidden="true" />{pc.editing ? "Cancel" : "Edit"}</button>}</div>
      </div>
      <div className="grid grid-cols-2 gap-6 xl:gap-8 items-start mt-2">
        <section aria-labelledby="yd-h"><DataDesktop showEditAction={false} /></section>
        <section aria-labelledby="in-h"><InsightsDesktop /></section>
      </div>
    </div>
  );
}

function WithOverlays() {
  const isMobile = useIsMobile();
  const pc = usePicture();
  return (
    <OverlayProvider isMobile={isMobile} render={key => renderPlanDetail(key, pc) ?? renderDetail(key, pc)}>
      <Page isMobile={isMobile} />
    </OverlayProvider>
  );
}

export function MyFinancialPicture(props: MyFinancialPictureProps) {
  return (
    <div className="fp" data-testid="financial-picture">
      <PictureProvider props={props}><WithOverlays /></PictureProvider>
    </div>
  );
}

export default MyFinancialPicture;

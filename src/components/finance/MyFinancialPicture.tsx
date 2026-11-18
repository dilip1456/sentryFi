/**
 * My Financial Picture collects editable profile data. The dedicated Insights
 * destination uses the same provider/model to present its derived analysis.
 * Desktop opens details in dialogs; mobile
 * pushes full screens for sections and insights and opens a bottom sheet
 * (vaul) for a single row. Every open is a history entry, so Back closes it.
 *
 * Figures come from the shared model in src/lib/picture (which reuses
 * src/lib/classify, src/lib/recurring and src/lib/infer). Edits are one
 * settings patch per action through useUserSettings().update.
 */
import { ChartNoAxesColumnDecreasing, FlaskConical } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import "./picture/picture.css";
import { PictureProvider, usePicture, type MyFinancialPictureProps } from "./picture/state";
import { OverlayProvider, useOverlay } from "./picture/overlays";
import { DataDesktop, DataMobile } from "./picture/data-column";
import { InsightsDesktop, InsightsMobile } from "./picture/insights";
import { renderDetail } from "./picture/details";
import { HistoryHint } from "./picture/history-hint";

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

function Page({ isMobile, insightsOnly = false }: { isMobile: boolean; insightsOnly?: boolean }) {
  const pc = usePicture();
  const { open } = useOverlay();
  const periodLabel = pc.full ? `${pc.year}, whole year` : pc.today.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (isMobile) {
    return (
      <div className="px-4 pt-3 pb-28">
        {insightsOnly && <h1 className="font-display text-[24px] font-semibold mb-3">Insights</h1>}
        <PeriodSeg />
        <div className="flex items-center gap-2 mt-3">{pc.demo && <ExampleTag />}<span className="text-[12.5px] text-muted-foreground">{periodLabel}</span></div>
        <HistoryHint />
        {insightsOnly
          ? <section aria-labelledby="in-h" className="mt-4"><InsightsMobile /></section>
          : <section aria-labelledby="yd-h" className="mt-4"><DataMobile /></section>}
      </div>
    );
  }
  return (
    <div className={insightsOnly ? "pt-0 pb-4" : "content-max px-8 pt-6 pb-12"}>
      <div className="flex items-center gap-4 pb-2">
        <div className="min-w-0 flex items-center gap-2">
          {!insightsOnly && <h1 className="font-display text-[28px] font-semibold">My Financial Picture</h1>}
          {pc.demo && <ExampleTag />}
        </div>
        <div className={insightsOnly ? "ml-auto" : "mx-auto"}><PeriodSeg /></div>
        {!insightsOnly && <button type="button" className="btn" onClick={() => open("cashflow")}><ChartNoAxesColumnDecreasing className="h-4 w-4" aria-hidden="true" />Where it goes</button>}
      </div>
      <HistoryHint />
      {insightsOnly ? (
        <section aria-labelledby="in-h" className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-4 xl:gap-6 items-start"><InsightsDesktop /></section>
      ) : (
        <section aria-labelledby="yd-h" className="mt-2"><DataDesktop /></section>
      )}
    </div>
  );
}

function WithOverlays({ insightsOnly = false }: { insightsOnly?: boolean }) {
  const isMobile = useIsMobile();
  const pc = usePicture();
  return (
    <OverlayProvider isMobile={isMobile} render={key => renderDetail(key, pc)}>
      <Page isMobile={isMobile} insightsOnly={insightsOnly} />
    </OverlayProvider>
  );
}

export function MyFinancialPicture(props: MyFinancialPictureProps & { insightsOnly?: boolean }) {
  const { insightsOnly = false, ...pictureProps } = props;
  return (
    <div className="fp" data-testid={insightsOnly ? "financial-insights" : "financial-picture"}>
      <PictureProvider props={pictureProps}><WithOverlays insightsOnly={insightsOnly} /></PictureProvider>
    </div>
  );
}

export default MyFinancialPicture;

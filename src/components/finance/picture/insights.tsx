/** Insights: desktop cards (right column) and the mobile insight cards/tiles. */
import { useState, type ReactNode } from "react";
import {
  ChartCandlestick, ChartNoAxesColumnDecreasing, ChevronRight, CircleAlert, CircleCheck, CircleHelp, Gauge as GaugeIcon,
  Hourglass, Info, Lock, LockOpen, Percent, PiggyBank, ShieldCheck, TrendingUp, TriangleAlert,
} from "lucide-react";
import { usePicture } from "./state";
import { useOverlay } from "./overlays";
import { Donut, Gauge, LimitBar, SavingsStack, fmt, pctOf } from "./bits";
import { RISK_LEVELS, riskGaugeValue } from "@/lib/picture/risk";
import { taxTable } from "@/lib/tax-tables";
import { shortDate } from "@/lib/picture/model";

const ico = "h-[18px] w-[18px]";

function Head({ icon, title, sub, k, compact }: { icon: ReactNode; title: string; sub: string; k: string; compact?: boolean }) {
  const { open } = useOverlay();
  return (
    <div className="sec-h">
      <span className="sec-ico" aria-hidden="true">{icon}</span>
      <div className={compact ? "min-w-0 flex-1" : "min-w-0"}>
        <div className="sec-t">{title}</div>
        <div className="sec-s">{sub}</div>
      </div>
      {compact ? (
        <button type="button" className="icon-btn shrink-0" onClick={() => open(k)} aria-label={`${title} details`}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      ) : (
        <button type="button" className="sec-more" onClick={() => open(k)}>View details<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      )}
    </div>
  );
}

export const riskLabel = (r: string | undefined) => RISK_LEVELS.find(x => x.key === r);

/** "Do you have an employer 401(k) match?" — asked once, then the status. */
export function MatchBlock({ compact }: { compact: boolean }) {
  const { match, act, fp } = usePicture();
  const em = fp.employerMatch;
  const [pct, setPct] = useState(String(em?.pct ?? 50));
  const [upTo, setUpTo] = useState(String(em?.upToPct ?? 6));
  if (!match.answered) {
    return (
      <div className="q">
        <div className="flex items-start gap-2 text-[14px] font-semibold"><CircleHelp className="h-4 w-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />Do you have an employer 401(k) match?</div>
        <p className="note mt-1">Tell us once and we'll check you put in enough to get all of it.</p>
        <div className="flex gap-2 mt-2 flex-wrap">
          <button type="button" className="chipbtn" onClick={() => act.setMatch({ answer: "yes", pct: 50, upToPct: 6 })}>Yes</button>
          <button type="button" className="chipbtn" onClick={() => act.setMatch({ answer: "no" })}>No</button>
          <button type="button" className="chipbtn" onClick={() => act.setMatch({ answer: "unsure" })}>Not sure</button>
        </div>
      </div>
    );
  }
  if (match.answer === "yes") {
    return (
      <>
        <div className="flex items-center gap-3 min-h-[44px] flex-wrap">
          <span className="text-[14px] w-[92px] shrink-0">Employer match</span>
          <span className={`st ${match.full ? "st-ok" : "st-warn"}`}>
            {match.full ? <CircleCheck className="h-4 w-4" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4" aria-hidden="true" />}
            {match.full ? "Getting the full match" : "Missing part of the match"}
          </span>
          <span className="ml-auto text-[12.5px] text-muted-foreground text-right">{match.pct}% up to {match.upToPct}% of pay · {fmt(match.worth)}/yr</span>
        </div>
        {!compact && (
          <>
            <p className="note">
              You put in {match.yourPct.toFixed(1)}% of pay; the match needs {match.upToPct}%.{!match.full && match.missing > 0 ? ` You're leaving about ${fmt(match.missing)}/yr on the table.` : ""}{" "}
              <button type="button" className="text-primary font-semibold underline-offset-2 hover:underline min-h-[44px]" onClick={() => act.setMatch(undefined)}>Change answer</button>
            </p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <label className="block text-[13px]">
                <span className="text-muted-foreground">They match (% of what you put in)</span>
                <span className="amt-in mt-1 !w-full"><input inputMode="decimal" value={pct} aria-label="Match rate, percent of what you put in"
                  onChange={e => setPct(e.target.value)} onBlur={() => { const v = Number(pct); if (v > 0 && v <= 200) act.setMatch({ answer: "yes", pct: v, upToPct: match.upToPct }); }} /><span>%</span></span>
              </label>
              <label className="block text-[13px]">
                <span className="text-muted-foreground">Up to (% of your pay)</span>
                <span className="amt-in mt-1 !w-full"><input inputMode="decimal" value={upTo} aria-label="Matched up to, percent of pay"
                  onChange={e => setUpTo(e.target.value)} onBlur={() => { const v = Number(upTo); if (v > 0 && v <= 100) act.setMatch({ answer: "yes", pct: match.pct, upToPct: v }); }} /><span>%</span></span>
              </label>
            </div>
          </>
        )}
      </>
    );
  }
  if (match.answer === "unsure") {
    return (
      <p className="note"><Info className="h-3.5 w-3.5 inline -mt-0.5 mr-1" aria-hidden="true" />Check your benefits portal for "401(k) match". Most matches need 3–6% of pay.{" "}
        <button type="button" className="text-primary font-semibold min-h-[44px]" onClick={() => act.setMatch(undefined)}>Answer now</button></p>
    );
  }
  return <p className="note">No employer match. <button type="button" className="text-primary font-semibold min-h-[44px]" onClick={() => act.setMatch(undefined)}>Change</button></p>;
}

export function CoverageCard() {
  const { cov } = usePicture();
  const { open } = useOverlay();
  const good = cov.pct >= 85;
  return (
    <div className="sec" id="ins-coverage">
      <Head icon={<ShieldCheck className={ico} />} title="Coverage Health" sub="Is every bill paid from somewhere, and every goal funded?" k="coverage" />
      <div className="flex items-center gap-6 flex-wrap">
        <Donut pct={cov.pct} />
        <div className="flex-1 min-w-[220px]">
          <div className="text-[16px] font-semibold flex items-center gap-2">
            {good ? <CircleCheck className="h-4 w-4 text-positive" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4 text-warning" aria-hidden="true" />}
            {good ? "You're in good shape" : "A few things need a home"}
          </div>
          <p className="mini mt-1">{cov.pct}% of your bills, budgets, cards and goals have an account behind them.</p>
          {cov.flags.length > 0 && (
            <div className="flags mt-3">
              <div className="text-[13.5px] font-semibold flex items-center gap-2" style={{ color: "hsl(var(--negative-text))" }}>
                <TriangleAlert className="h-4 w-4" aria-hidden="true" />{cov.flags.length} red flag{cov.flags.length === 1 ? "" : "s"}
              </div>
              {cov.flags.map(f => (
                <button type="button" key={f.key} className="flag-btn" onClick={() => open(f.key)}>
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{f.text}</span><ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TaxSaversCard() {
  const { savers, m } = usePicture();
  return (
    <div className="sec" id="ins-tax">
      <Head icon={<TrendingUp className={ico} />} title="Tax Savers" sub="HSA, 401(k) and other tax-saving accounts" k="taxsavers" />
      <div className="big-line">You save {fmt(savers.now)} a year in taxes.<br />Max out to save <b>+{fmt(savers.more)}</b> more.</div>
      <div className="space-y-3 mt-4">
        <LimitBar label="HSA" yearly={m.payroll.hsa * 12} limit={savers.hsaLimit} sub="Self-only limit" />
        <LimitBar label="401(k)" yearly={m.payroll.k401 * 12} limit={savers.k401Limit} />
      </div>
      <div className="mt-3 pt-3 border-t border-border"><MatchBlock compact /></div>
      <p className="mini mt-2" data-testid="state-tax-note">State tax not included</p>
    </div>
  );
}

export const TIERS = [
  { k: "now" as const, l: "Available now", Icon: LockOpen, s: "Checking and savings, use any time" },
  { k: "long" as const, l: "Long term", Icon: Hourglass, s: "HSA, 529, brokerage and company shares" },
  { k: "ret" as const, l: "Retirement", Icon: Lock, s: "401(k) and IRA, penalty before 59½" },
];

export function BreakdownCard() {
  const { bd } = usePicture();
  return (
    <div className="sec" id="ins-breakdown">
      <Head icon={<PiggyBank className={ico} />} title="Savings Breakdown" sub="Includes savings goals, HSA, shares and 401(k)" k="breakdown" />
      <SavingsStack now={bd.tiers.now} long={bd.tiers.long} ret={bd.tiers.ret} />
      <div className="grid grid-cols-3 gap-3 mt-3">
        {TIERS.map(t => (
          <div key={t.k}>
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span className={`dot c-${t.k}`} aria-hidden="true" />{t.l}
              {t.k === "ret" && <><span className="sr-only">(locked)</span><Lock className="h-3 w-3" aria-hidden="true" /></>}
            </div>
            <div className="kpi text-[22px] mt-1">{fmt(bd.tiers[t.k])}</div>
            <div className="text-[12px] text-muted-foreground">{pctOf(bd.tiers[t.k], bd.total)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BracketCard() {
  const { tax, m, year } = usePicture();
  const bs = taxTable(year).brackets[m.filing];
  const slice = bs.map((b, i) => ({ ...b, i, lo: i ? bs[i - 1].upTo + 1 : 0 })).slice(Math.max(0, tax.idx - 1), tax.idx + 2);
  return (
    <div className="sec" id="ins-bracket">
      <Head icon={<Percent className={ico} />} title="Tax Bracket" sub={`Federal ${year}, est.`} k="bracket" compact />
      <div className="flex items-end gap-2"><span className="kpi text-[40px] text-primary">{Math.round(tax.rate * 100)}%</span><span className="mini pb-1">your bracket</span></div>
      <p className="mini mt-1">{tax.toNext != null && tax.nextRate != null ? `${fmt(tax.toNext)} below the ${Math.round(tax.nextRate * 100)}% bracket.` : "You're in the top bracket."}</p>
      <table className="brk mt-2">
        <caption className="sr-only">{year} federal brackets, {m.filing === "single" ? "single" : "married filing jointly"}</caption>
        <tbody>
          {slice.map(b => (
            <tr key={b.i} className={b.i === tax.idx ? "me" : ""}>
              <td>{Math.round(b.rate * 100)}%</td>
              <td className="text-right">{fmt(b.lo)} – {Number.isFinite(b.upTo) ? fmt(b.upTo) : "up"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mini mt-2" data-testid="state-tax-note">State tax not included</p>
    </div>
  );
}

export function RiskCard() {
  const { risk } = usePicture();
  const r = riskLabel(risk);
  return (
    <div className="sec" id="ins-risk">
      <Head icon={<GaugeIcon className={ico} />} title="Risk Profile" sub="Your comfort with risk" k="risk" compact />
      <div className="flex flex-col items-center">
        <Gauge v={riskGaugeValue(risk)} w={170} label={r?.label ?? "not set"} />
        <div className="text-[16px] font-semibold -mt-1">{r?.label ?? "Not set yet"}</div>
        <p className="mini text-center mt-1">{r?.desc ?? "Tell us how you feel about ups and downs."}</p>
      </div>
    </div>
  );
}

export function SharesCard() {
  const { shares } = usePicture();
  const { open } = useOverlay();
  return (
    <div className="sec" id="ins-shares">
      <Head icon={<ChartCandlestick className={ico} />} title="Shares" sub="ESPP + RSU" k="shares" />
      {shares.total > 0 || shares.esppMonthly ? (
        <>
          <div className="kpi text-[26px]">{fmt(shares.total)}</div>
          <p className="mini mt-1">Company stock{shares.account ? ` in ${shares.account.label}` : ""}</p>
          <div className="lst mt-2">
            <div className="li !min-h-[40px]">
              <span className="grow"><b className="font-semibold">ESPP</b> <span className="text-[13px] text-muted-foreground">· {fmt(shares.esppMonthly ?? 0)}/mo{shares.esppNextBuy ? ` · next buy ${shortDate(shares.esppNextBuy)}` : ""}</span></span>
              <b className="tabular">{fmt(shares.esppValue ?? 0)}</b>
            </div>
            <div className="li !min-h-[40px]">
              <span className="grow"><b className="font-semibold">RSU</b> <span className="text-[13px] text-muted-foreground">{shares.rsuNextVest ? `· ${shares.rsuNextVestShares ? `${shares.rsuNextVestShares} shares ` : ""}vest ${shortDate(shares.rsuNextVest)}` : "· no vest date yet"}</span></span>
              <b className="tabular">{fmt(shares.rsuValue ?? 0)}</b>
            </div>
          </div>
        </>
      ) : (
        <div>
          <p className="mini">Company stock from ESPP or RSUs doesn't show up in bank data. Add what you hold to see it here and in your Savings Breakdown.</p>
          <button type="button" className="btn mt-3" onClick={() => open("shares")}>Add your shares</button>
        </div>
      )}
    </div>
  );
}

export const FLOW_COLORS: Record<string, string> = {
  obligations: "hsl(var(--negative) / .75)", fixed: "hsl(var(--warning) / .8)", budgets: "hsl(var(--info))", savings: "hsl(var(--primary))", left: "hsl(var(--positive))",
};

export function FlowMini() {
  const { flow, P, per } = usePicture();
  return (
    <div className="sec" id="ins-flow">
      <Head icon={<ChartNoAxesColumnDecreasing className={ico} />} title="Where your money goes" sub={`Income ${fmt(flow.income * P)}${per} → what's left`} k="cashflow" />
      <div className="stack" role="img" aria-label={`Take-home split: ${flow.parts.map(p => `${p.label} ${fmt(p.amount * P)}`).join(", ")}, left over ${fmt(flow.left * P)}`}>
        {flow.parts.map(p => <span key={p.key} style={{ flex: Math.max(0, p.amount), background: FLOW_COLORS[p.key] }} />)}
        <span style={{ flex: Math.max(0, flow.left), background: FLOW_COLORS.left }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12.5px] text-muted-foreground">
        {flow.parts.map(p => <span key={p.key} className="flex items-center gap-1.5"><span className="dot" style={{ background: FLOW_COLORS[p.key] }} />{p.label} {fmt(p.amount * P)}</span>)}
        <span className="flex items-center gap-1.5 text-foreground font-semibold"><span className="dot" style={{ background: FLOW_COLORS.left }} />{flow.left >= 0 ? "Left" : "Short"} {fmt(flow.left * P)}</span>
      </div>
    </div>
  );
}

export function InsightsDesktop() {
  const { full, year } = usePicture();
  return (
    <>
      <div className="col-h"><div><h2 id="in-h">Insights</h2><p>{full ? `Your financial health for ${year}.` : "A snapshot of your financial health this month."}</p></div></div>
      <CoverageCard />
      <div className="mt-[14px]"><TaxSaversCard /></div>
      <div className="mt-[14px]"><BreakdownCard /></div>
      <div className="ins-grid"><BracketCard /><RiskCard /></div>
      <div className="mt-[14px]"><SharesCard /></div>
      <div className="mt-[14px]"><FlowMini /></div>
    </>
  );
}

export function InsightsMobile() {
  const { cov, savers, match, bd, tax, risk, shares } = usePicture();
  const { open } = useOverlay();
  const r = riskLabel(risk);
  const chev = <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />;
  return (
    <>
      <div className="col-h !mb-3"><div><h2 id="in-h" className="!text-[22px]">Insights</h2><p>What your data tells us</p></div></div>
      <button type="button" className="sum-card !min-h-[96px]" onClick={() => open("coverage")}>
        <Donut pct={cov.pct} size={64} w={8} />
        <span className="flex-1 min-w-0">
          <span className="t block">Coverage Health</span>
          <span className="s">{cov.flags.length
            ? <span className="st st-bad !text-[12.5px]"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{cov.flags.length} red flag{cov.flags.length === 1 ? "" : "s"}</span>
            : <span className="st st-ok !text-[12.5px]"><CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />No red flags</span>}</span>
        </span>
        {chev}
      </button>
      <button type="button" className="sum-card !min-h-[96px]" onClick={() => open("taxsavers")}>
        <span className="sec-ico" aria-hidden="true"><TrendingUp className={ico} /></span>
        <span className="flex-1 min-w-0">
          <span className="t block">Tax Savers</span>
          <span className="s">You save {fmt(savers.now)}/yr · <span className="text-positive font-semibold">+{fmt(savers.more)} if maxed</span></span>
          {!match.answered && <span className="s"><CircleHelp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Employer match? Tap to answer</span>}
          {match.answer === "yes" && <span className="s">{match.full ? "Getting the full 401(k) match" : `Missing ${fmt(match.missing)}/yr of match`}</span>}
          <span className="s" data-testid="state-tax-note">State tax not included</span>
        </span>
        {chev}
      </button>
      <div className="grid grid-cols-2 gap-[10px] mt-[10px]">
        <button type="button" className="tile" onClick={() => open("breakdown")}>
          <span className="t"><PiggyBank className="h-4 w-4 text-primary" aria-hidden="true" />Savings</span>
          <span className="kpi text-[22px]">{fmt(bd.total)}</span>
          <SavingsStack now={bd.tiers.now} long={bd.tiers.long} ret={bd.tiers.ret} className="!h-2 w-full" />
          <span className="mini">{fmt(bd.tiers.now)} available now</span>
        </button>
        <button type="button" className="tile" onClick={() => open("bracket")}>
          <span className="t"><Percent className="h-4 w-4 text-primary" aria-hidden="true" />Tax Bracket</span>
          <span className="kpi text-[30px] text-primary">{Math.round(tax.rate * 100)}%</span>
          <span className="mini">{tax.toNext != null && tax.nextRate != null ? `${fmt(tax.toNext)} below ${Math.round(tax.nextRate * 100)}%` : "Top bracket"}</span>
          <span className="mini" data-testid="state-tax-note">State tax not included</span>
        </button>
        <button type="button" className="tile" onClick={() => open("risk")}>
          <span className="t"><GaugeIcon className="h-4 w-4 text-primary" aria-hidden="true" />Risk Profile</span>
          <span className="self-center"><Gauge v={riskGaugeValue(risk)} w={96} label={r?.label ?? "not set"} /></span>
          <span className="text-[14px] font-semibold text-center -mt-1">{r?.label ?? "Not set"}</span>
        </button>
        <button type="button" className="tile" onClick={() => open("shares")}>
          <span className="t"><ChartCandlestick className="h-4 w-4 text-primary" aria-hidden="true" />Shares</span>
          <span className="kpi text-[22px]">{fmt(shares.total)}</span>
          <span className="mini">{shares.rsuNextVest ? `ESPP + RSU · ${shares.rsuNextVestShares ? `${shares.rsuNextVestShares} ` : ""}vest ${shortDate(shares.rsuNextVest)}` : shares.total ? "ESPP + RSU" : "Tap to add"}</span>
        </button>
      </div>
      <button type="button" className="sum-card mt-[10px]" onClick={() => open("cashflow")}>
        <span className="sec-ico" aria-hidden="true"><ChartNoAxesColumnDecreasing className={ico} /></span>
        <span className="flex-1 min-w-0"><span className="t block">Where your money goes</span><span className="s">Paycheck → bills → goals → left over</span></span>
        {chev}
      </button>
    </>
  );
}

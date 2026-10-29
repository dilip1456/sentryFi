/**
 * Small shared pieces of My Financial Picture (ported from the approved
 * prototype, review/financial-picture/prototype/fp.js): money format, the
 * "Covered by" chip, tags, donut, risk gauge, limit bars, radio group.
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { CreditCard, Landmark, PiggyBank, Sparkles, TriangleAlert } from "lucide-react";
import type { AcctInfo } from "@/lib/picture/model";

export const fmt = (n: number) => (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
export const fmtSigned = (n: number) => (n >= 0 ? "+" : "") + fmt(n);
export const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function CovChip({ acct, text }: { acct: AcctInfo | null | undefined; text?: string }) {
  if (!acct) {
    return (
      <span className="cov cov-none" title="Nothing covers this yet">
        <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{text ?? "Unassigned"}</span>
      </span>
    );
  }
  const Icon = acct.chip === "save" ? PiggyBank : acct.chip === "card" ? CreditCard : Landmark;
  return (
    <span className={`cov cov-${acct.chip}`} title={acct.label}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{acct.name}</span>
    </span>
  );
}

export function Tag({ kind }: { kind: "pre" | "post" | "det" }) {
  if (kind === "pre") return <span className="tag tag-pre">Pre-tax</span>;
  if (kind === "post") return <span className="tag tag-post">Post-tax</span>;
  return (
    <span className="tag tag-det">
      <Sparkles className="h-3 w-3" aria-hidden="true" />Detected
    </span>
  );
}

export function Donut({ pct, size = 132, w = 14, label = "covered" }: { pct: number; size?: number; w?: number; label?: string }) {
  const r = (size - w) / 2, c = 2 * Math.PI * r, d = (c * Math.max(0, Math.min(100, pct))) / 100;
  const small = size < 90;
  return (
    <span className="donut" style={{ width: size, height: size }} role="img" aria-label={`${pct}% ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={w} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--positive))" strokeWidth={w} strokeLinecap="round"
          strokeDasharray={`${d} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="c" aria-hidden="true">
        <span>
          <b style={small ? { fontSize: 17 } : undefined}>{pct}%</b>
          {!small && <small>{label}</small>}
        </span>
      </span>
    </span>
  );
}

/** Half-circle risk gauge (prototype gauge()): three arcs and a needle at v (0–1). */
export function Gauge({ v, w = 200, label }: { v: number | null; w?: number; label: string }) {
  const h = w * 0.58, cx = w / 2, cy = w * 0.52, r = w * 0.4, sw = w * 0.09;
  const p = (a: number) => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))] as const;
  const arc = (a0: number, a1: number) => { const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1}`; };
  const ang = Math.PI * (1 - (v ?? 0.5));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Risk profile: ${label}`}>
      <path d={arc(0.01, 0.32)} stroke="hsl(var(--info) / .55)" strokeWidth={sw} fill="none" />
      <path d={arc(0.34, 0.66)} stroke="hsl(var(--primary))" strokeWidth={sw} fill="none" />
      <path d={arc(0.68, 0.99)} stroke="hsl(var(--negative) / .6)" strokeWidth={sw} fill="none" />
      {v != null && (
        <>
          <line x1={cx} y1={cy} x2={cx + r * 0.82 * Math.cos(ang)} y2={cy - r * 0.82 * Math.sin(ang)} stroke="hsl(var(--foreground))" strokeWidth={w * 0.03} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={w * 0.04} fill="hsl(var(--foreground))" />
        </>
      )}
    </svg>
  );
}

export function LimitBar({ label, yearly, limit, sub }: { label: string; yearly: number; limit: number; sub?: ReactNode }) {
  const p = Math.min(100, pctOf(yearly, limit));
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 items-center">
      <div>
        <div className="text-[14px] font-medium">{label}</div>
        <div className="text-[12px] text-muted-foreground tabular">{fmt(yearly)}/yr</div>
      </div>
      <div>
        <div className="flex justify-between text-[12px] text-muted-foreground mb-1">
          <span>{p}% of limit</span><span className="tabular">2026 max {fmt(limit)}</span>
        </div>
        <div className="bar" role="img" aria-label={`${label}: ${p}% of the ${fmt(limit)} limit`}><span style={{ width: `${p}%` }} /></div>
        {sub && <div className="text-[12px] text-muted-foreground mt-1">{sub}</div>}
      </div>
    </div>
  );
}

export function SavingsStack({ now, long, ret, className = "" }: { now: number; long: number; ret: number; className?: string }) {
  const t = now + long + ret || 1; // for the label
  return (
    <div className={`stack ${className}`} role="img" aria-label={`Available now ${pctOf(now, t)}%, long term ${pctOf(long, t)}%, retirement ${pctOf(ret, t)}%`}>
      <span className="c-now" style={{ flex: now }} />
      <span className="c-long" style={{ flex: long }} />
      <span className="c-ret" style={{ flex: ret }} />
    </div>
  );
}

/** Accessible single-choice list (role=radiogroup, arrow keys move). */
export function RadioList<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const id = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const n = (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
    onChange(options[n].value);
    (document.getElementById(`${id}-${n}`) as HTMLElement | null)?.focus();
  };
  const sel = options.findIndex(o => o.value === value);
  return (
    <div role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <div
          key={o.value} id={`${id}-${i}`} role="radio" aria-checked={o.value === value}
          tabIndex={o.value === value || (sel < 0 && i === 0) ? 0 : -1}
          className="radio" onClick={() => onChange(o.value)}
          onKeyDown={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onChange(o.value); } else onKey(e, i); }}
        >
          <span className="rd" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">{o.label}</span>
            {o.sub && <span className="block text-[12px] text-muted-foreground">{o.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SecHead({ icon, title, sub, right }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="sec-h">
      <span className="sec-ico" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <div className="sec-t">{title}</div>
        {sub && <div className="sec-s">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

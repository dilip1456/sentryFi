import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GIFT_CARD_BRANDS, logoUrlForDomain, clearbitLogoUrl, faviconUrlForDomain, brandGradient, searchBrands, type BrandSuggestion } from "@/lib/gift-card-brands";
import { toast } from "sonner";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import {
  Gift, Plus, X, ExternalLink, ShoppingBag, Pencil, Trash2, Search,
  CheckCircle2, AlertCircle, Loader2, Clock, Eye, EyeOff,
  ChevronLeft, ChevronRight, ChevronDown, Copy, ScanBarcode, Archive, ArchiveRestore,
  Wallet, Layers, List, LayoutGrid,
} from "lucide-react";
import { fmtShortDate } from "@/lib/format-date";
import {
  BARCODE_FORMATS, DEFAULT_BARCODE_FORMAT, EXPIRY_WARNING_DAYS, SORT_OPTIONS,
  barcodeValue, daysUntil, expiryLabel, expiryStatus, filterCards, groupByIssuer, issuerHue,
  issuerInitials, resolveFormat, sortCards, splitArchived, summarize,
  type BarcodeFormat, type GiftCard, type IssuerGroup, type SortKey,
} from "@/lib/gift-cards";
import { CheckoutView } from "./giftcards/CheckoutView";
import { GiftCardBarcode } from "./giftcards/GiftCardBarcode";

// gift_cards / gift_card_activity aren't in the generated Supabase types, so
// talk to them through an untyped client and the hand-written GiftCard row.
const db = supabase as unknown as SupabaseClient;

const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
};

type GiftCardRow = GiftCard;

// Hand-written mirror of public.gift_card_activity
// (supabase/migrations/20260925120000_gift_cards_trash_and_activity.sql,
// 'archived'/'unarchived' kinds from 20261117000000).
type GiftCardActivityKind = "added" | "spend" | "adjustment" | "removed" | "restored" | "archived" | "unarchived";
type GiftCardActivityRow = {
  id: string;
  gift_card_id: string;
  user_id: string;
  kind: GiftCardActivityKind;
  amount: number | null;
  balance_after: number;
  note: string | null;
  created_at: string;
};

// Set once a load discovers gift_card_activity is missing on the live DB, so
// later inserts don't spam 404s while the migration is pending.
let activityTableMissing = false;
// Set once a write discovers barcode_format / archived_at are missing (the
// 20261117000000 migration isn't applied yet), so later writes skip them.
let barcodeColumnMissing = false;

/** Append-only usage-trail insert. Fire-and-forget on purpose — a logging
 *  failure shouldn't block or roll back the balance change that triggered it. */
const logActivity = async (entry: {
  gift_card_id: string; user_id: string; kind: GiftCardActivityKind;
  amount: number | null; balance_after: number; note?: string | null;
}) => {
  if (activityTableMissing) return;
  const { error } = await db.from("gift_card_activity").insert({
    gift_card_id: entry.gift_card_id,
    user_id: entry.user_id,
    kind: entry.kind,
    amount: entry.amount,
    balance_after: entry.balance_after,
    note: entry.note ?? null,
  });
  if (error) {
    if (isMissingTableError(error)) activityTableMissing = true;
    console.error("[gift_card_activity] insert failed:", error.message);
  }
};

/** Writes a gift_cards row, retrying without barcode_format if the live DB
 *  predates 20261117000000 (so adding/editing a card never breaks on it). */
const writeCard = async <T,>(
  payload: Record<string, unknown>,
  run: (p: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<{ data: T | null; error: { message: string; code?: string } | null }> => {
  const p = { ...payload };
  if (barcodeColumnMissing) delete p.barcode_format;
  const res = await run(p);
  if (res.error && "barcode_format" in p && isMissingColumnError(res.error, "barcode_format")) {
    barcodeColumnMissing = true;
    console.warn("[gift_cards] barcode_format column missing — apply supabase/migrations/20261117000000_gift_cards_barcode_archive.sql");
    delete p.barcode_format;
    return run(p);
  }
  return res;
};

const ACTIVITY_LABEL: Record<GiftCardActivityKind, string> = {
  added: "Card added", spend: "Spent", adjustment: "Balance adjusted", removed: "Removed", restored: "Restored",
  archived: "Marked used", unarchived: "Back in wallet",
};

/** Compact usage trail shown inside the card detail popup and the desktop
 *  detail panel — renders nothing when there's no history yet. */
const ActivityHistoryList = ({ entries }: { entries: GiftCardActivityRow[] }) => {
  if (!entries.length) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-[12px] uppercase tracking-wider text-muted-foreground block">Activity</span>
      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
        {entries.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-[12.5px]">
            <div className="min-w-0 truncate">
              <span className="text-foreground">{ACTIVITY_LABEL[e.kind] ?? e.kind}</span>
              {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
              {e.amount != null && (
                <span className="tabular">{e.kind === "spend" && e.amount > 0 ? "-" : ""}{fmtUSD(Math.abs(Number(e.amount)))}</span>
              )}
              <span>{fmtShortDate(e.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const isoInDays = (d: number): string => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const agoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// Illustrative cards shown only in demo/guest mode — several issuers, some
// with more than one card, every barcode type, and a couple expiring soon.
const demoCard = (p: Partial<GiftCardRow> & Pick<GiftCardRow, "id" | "brand_name" | "balance">): GiftCardRow => ({
  user_id: "demo", domain: null, logo_url: null, balance_check_url: null, buy_url: null,
  card_number: null, card_number_last4: null, pin: null, notes: null, expiry_date: null,
  balance_verified: true, created_at: agoIso(30), barcode_format: null, archived_at: null, deleted_at: null, ...p,
});
const buildDemoCards = (): GiftCardRow[] => [
  demoCard({ id: "demo-sb1", brand_name: "Starbucks", domain: "starbucks.com", balance: 18.40, card_number: "6061987412345521", card_number_last4: "5521", pin: "73914", barcode_format: "code128", expiry_date: isoInDays(12), notes: "Birthday gift", balance_check_url: "https://www.starbucks.com/card", created_at: agoIso(60) }),
  demoCard({ id: "demo-sb2", brand_name: "Starbucks", domain: "starbucks.com", balance: 6.25, card_number: "6061987412340087", card_number_last4: "0087", pin: "20486", barcode_format: "code128", balance_check_url: "https://www.starbucks.com/card", created_at: agoIso(10) }),
  demoCard({ id: "demo-amz1", brand_name: "Amazon", domain: "amazon.com", balance: 50.00, card_number: "AQ7K-9XZP-4M2R", card_number_last4: "4M2R", barcode_format: "qrcode", notes: "Work raffle", balance_check_url: "https://www.amazon.com/gc/balance", created_at: agoIso(5) }),
  demoCard({ id: "demo-amz2", brand_name: "Amazon", domain: "amazon.com", balance: 25.00, card_number: "BR3T-6YLQ-8N1W", card_number_last4: "8N1W", barcode_format: "qrcode", balance_check_url: "https://www.amazon.com/gc/balance", created_at: agoIso(40) }),
  demoCard({ id: "demo-tgt", brand_name: "Target", domain: "target.com", balance: 64.18, card_number: "041234567890123", card_number_last4: "0123", pin: "48210713", barcode_format: "pdf417", expiry_date: isoInDays(400), balance_check_url: "https://www.target.com/guest/gift-card-balance", created_at: agoIso(90) }),
  demoCard({ id: "demo-bby", brand_name: "Best Buy", domain: "bestbuy.com", balance: 80.22, card_number: "6155432109875130", card_number_last4: "5130", pin: "2841", barcode_format: "code128", expiry_date: isoInDays(220), balance_check_url: "https://www.bestbuy.com/giftcard/online/balancecheck", created_at: agoIso(120) }),
  demoCard({ id: "demo-ikea", brand_name: "IKEA", domain: "ikea.com", balance: 42.41, card_number: "4006381333931", card_number_last4: "3931", barcode_format: "ean13", balance_check_url: "https://www.ikea.com/us/en/customer-service/gift-card/", created_at: agoIso(75) }),
  demoCard({ id: "demo-pan", brand_name: "Panera Bread", domain: "panerabread.com", balance: 34.67, card_number: "6006491234564608", card_number_last4: "4608", barcode_format: "code128", expiry_date: isoInDays(26), balance_check_url: "https://www.panerabread.com/en-us/giftcards.html", balance_verified: false, created_at: agoIso(20) }),
  demoCard({ id: "demo-dom", brand_name: "Domino's", domain: "dominos.com", balance: 5.00, expiry_date: isoInDays(-3), balance_check_url: "https://www.dominos.com/en/pages/giftcards/", created_at: agoIso(200) }),
  demoCard({ id: "demo-lowes", brand_name: "Lowe's", domain: "lowes.com", balance: 0, card_number: "6006491111112222", card_number_last4: "2222", archived_at: agoIso(14), created_at: agoIso(300) }),
];

const cardLabel = (c: Pick<GiftCardRow, "brand_name" | "card_number_last4">) =>
  `${c.brand_name}${c.card_number_last4 ? ` ending ${c.card_number_last4}` : ""}`;

/** "1 Year, 5 Months, 2 Days" style countdown for the card detail panel. */
const humanizeCountdown = (dateStr: string): string => {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  if (target <= now) return "Expired";
  let years = target.getFullYear() - now.getFullYear();
  let months = target.getMonth() - now.getMonth();
  let days = target.getDate() - now.getDate();
  if (days < 0) { months -= 1; days += new Date(target.getFullYear(), target.getMonth(), 0).getDate(); }
  if (months < 0) { years -= 1; months += 12; }
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} Year${years!==1?"s":""}`);
  if (months > 0) parts.push(`${months} Month${months!==1?"s":""}`);
  if (days > 0 || parts.length === 0) parts.push(`${days} Day${days!==1?"s":""}`);
  return parts.join(", ");
};

/** Colored initials badge for issuers with no (or a failed) logo. */
const IssuerMonogram = ({ name, size }: { name: string; size: number }) => {
  const hue = issuerHue(name);
  return (
    <div aria-hidden="true"
      className="rounded-lg grid place-items-center font-semibold shrink-0 text-white"
      style={{ height: size, width: size, fontSize: Math.max(10, size * 0.38), background: `linear-gradient(140deg, hsl(${hue} 62% 48%), hsl(${(hue + 18) % 360} 60% 32%))` }}>
      {issuerInitials(name)}
    </div>
  );
};

const BrandLogo = ({ domain, logoUrl, name, size = 40 }: { domain?: string | null; logoUrl?: string | null; name: string; size?: number }) => {
  const [attempt, setAttempt] = useState(0);
  // Always fetch at least 3x the rendered footprint (floor of 180px) so the
  // logo stays crisp on retina/high-DPI screens instead of upscaling a small source.
  const fetchSize = Math.max(Math.round(size * 3), 180);
  const sources = [
    logoUrl,
    domain ? logoUrlForDomain(domain, fetchSize) : null,
    domain ? clearbitLogoUrl(domain, fetchSize) : null,
    domain ? faviconUrlForDomain(domain, fetchSize) : null,
  ].filter(Boolean) as string[];
  const src = sources[attempt];
  if (!src) return <IssuerMonogram name={name} size={size} />;
  // Fixed-size wrapper so the 10% padding is relative to the logo, not to
  // whatever wide row the logo sits in.
  return (
    <span className="relative inline-block shrink-0" style={{ height: size, width: size }}>
      <img
        src={src}
        alt={`${name} logo`}
        onError={() => setAttempt(a => a + 1)}
        className="absolute inset-0 h-full w-full rounded-lg border border-border/50 object-contain bg-white"
        style={{ padding: Math.round(size * 0.1), imageRendering: "auto" }}
      />
    </span>
  );
};
/** Small gift-card-shaped preview shown on every list/table row so no row is a blank. */
const MiniCardThumb = ({ card }: { card: { brand_name: string; domain?: string | null; logo_url?: string | null } }) => (
  <div className="relative rounded-md overflow-hidden shrink-0 shadow-sm"
    style={{ width: 54, height: 34, background: brandGradient(card.brand_name) }}>
    {/* gloss + depth */}
    <div className="absolute inset-0" style={{ background: "linear-gradient(120deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,0.22) 100%)" }} />
    {/* tiny EMV chip */}
    <div className="absolute top-1 left-1 h-[9px] w-[13px] rounded-[2px]" style={{ background: "linear-gradient(135deg, #f4dd93, #b98f2e)" }} />
    {/* brand logo (BrandLogo already renders on a white chip) */}
    <div className="absolute inset-0 grid place-items-center">
      <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={20} />
    </div>
  </div>
);

/** Large, faded brand mark used as a background watermark on the big card tile — falls back to a soft monogram if no image resolves. */
const BrandWatermark = ({ domain, logoUrl, name }: { domain?: string | null; logoUrl?: string | null; name: string }) => {
  const [attempt, setAttempt] = useState(0);
  // Rendered at 112px (h-28/w-28) — fetch well above that so it stays sharp on retina.
  const sources = [
    logoUrl,
    domain ? logoUrlForDomain(domain, 320) : null,
    domain ? clearbitLogoUrl(domain, 320) : null,
    domain ? faviconUrlForDomain(domain, 320) : null,
  ].filter(Boolean) as string[];
  const src = sources[attempt];
  if (!src) {
    return (
      <div
        aria-hidden
        className="absolute -right-3 -bottom-7 text-white/10 font-display select-none pointer-events-none leading-none"
        style={{ fontSize: 130 }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      onError={() => setAttempt(a => a + 1)}
      className="absolute -right-4 -bottom-4 h-28 w-28 object-contain opacity-15 pointer-events-none select-none rounded-2xl"
    />
  );
};

/** Renders an actual gift-card-shaped tile: brand-tinted gradient, watermark, magstripe accent, logo, balance, masked number. */
const GiftCardTile = ({ card, children }: { card: { brand_name: string; domain?: string | null; logo_url?: string | null; balance: number; card_number_last4?: string | null; expiry_date?: string | null }; children?: React.ReactNode }) => {
  const status = expiryStatus(card.expiry_date);
  return (
    <div
      className="relative rounded-2xl overflow-hidden flex flex-col aspect-[8/5] shadow-[var(--shadow-card)] text-white"
      style={{ background: brandGradient(card.brand_name) }}
    >
      {/* Depth + plastic gloss so it reads as a physical card, not a flat swatch */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(120% 85% at 12% -10%, rgba(255,255,255,0.28), transparent 55%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(118deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 32%, rgba(0,0,0,0.22) 100%)" }} />
      {/* Large faded brand watermark */}
      <BrandWatermark domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} />

      <div className="relative flex-1 p-4 flex flex-col justify-between">
        {/* Top: logo lockup + label/controls */}
        <div className="flex items-start justify-between gap-2">
          <div className="h-9 min-w-9 px-1.5 rounded-lg bg-white grid place-items-center overflow-hidden shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
            <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={28} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">Gift Card</span>
            {children}
          </div>
        </div>

        {/* EMV chip for realism */}
        <div className="relative h-[26px] w-[34px] rounded-[5px] overflow-hidden shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]"
          style={{ background: "linear-gradient(135deg, #f4dd93 0%, #d8b451 45%, #b98f2e 100%)" }}>
          <div className="absolute inset-[3px] rounded-[3px]" style={{ background: "repeating-linear-gradient(0deg, transparent 0 4px, rgba(0,0,0,0.16) 4px 5px)" }} />
          <div className="absolute inset-y-[3px] left-1/2 w-px -translate-x-1/2 bg-black/20" />
        </div>

        {/* Bottom: balance + brand + masked number */}
        <div>
          {status && (
            <div className={cn(
              "inline-flex items-center gap-1 text-[12px] font-medium px-1.5 py-0.5 rounded-full mb-1.5",
              status === "expired" ? "bg-negative/90 text-white" : "bg-warning/90 text-warning-foreground"
            )}>
              <Clock className="h-2.5 w-2.5" />
              {expiryLabel(card.expiry_date)}
            </div>
          )}
          <div className="font-display text-[26px] tabular leading-none drop-shadow-sm">{fmtUSD(Number(card.balance))}</div>
          <div className="flex items-center justify-between mt-1.5 gap-2">
            <span className="text-[13px] text-white/90 font-medium truncate">{card.brand_name}</span>
            {card.card_number_last4 && (
              <span className="text-[12.5px] text-white/70 font-mono tracking-[0.15em] shrink-0">•••• {card.card_number_last4}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Everything a card row / tile / panel can trigger, provided by the section. */
type CardActions = {
  openDetail: (c: GiftCardRow) => void;
  openCheckout: (c: GiftCardRow) => void;
  openBalance: (c: GiftCardRow) => void;
  openEdit: (c: GiftCardRow) => void;
  archive: (c: GiftCardRow) => void;
  unarchive: (c: GiftCardRow) => void;
  requestRemove: (c: GiftCardRow) => void;
  openSheet: (c: GiftCardRow) => void;
};

const ExpiryChip = ({ expiry, className }: { expiry: string | null | undefined; className?: string }) => {
  const st = expiryStatus(expiry);
  const label = expiryLabel(expiry);
  if (!label) return null;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      st === "expired" ? "bg-negative/12 text-negative" : st === "soon" ? "bg-warning/15 text-warning" : "bg-secondary/70 text-muted-foreground",
      className,
    )}>
      {st && <Clock className="h-2.5 w-2.5" aria-hidden="true" />}{label}
    </span>
  );
};

/**
 * Mobile row with touch shortcuts: swipe left to reveal Balance / Mark used,
 * long-press for the full action sheet. Every action is also in the detail
 * popup, so nothing is gesture-only.
 */
const REVEAL = 152;
const SwipeRow = ({ card, children, actions }: { card: GiftCardRow; children: React.ReactNode; actions: CardActions }) => {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const longTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const clearLong = () => { if (longTimer.current) { window.clearTimeout(longTimer.current); longTimer.current = null; } };
  useEffect(() => clearLong, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-swipe]")) return;
    start.current = { x: e.clientX, y: e.clientY, base: open ? -REVEAL : 0 };
    axis.current = null;
    suppressClick.current = false;
    clearLong();
    longTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      start.current = null;
      try { navigator.vibrate?.(12); } catch { /* not supported */ }
      actions.openSheet(card);
    }, 520);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!axis.current && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      axis.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
      clearLong();
    }
    if (axis.current === "h") {
      suppressClick.current = true;
      if (!dragging) setDragging(true);
      setDx(Math.max(-REVEAL - 24, Math.min(0, s.base + mx)));
    }
  };
  const onPointerEnd = () => {
    clearLong();
    if (start.current && axis.current === "h") {
      const next = dx < -REVEAL / 2;
      setOpen(next); setDx(next ? -REVEAL : 0);
    }
    start.current = null;
    setDragging(false);
  };
  const offset = dragging ? dx : open ? -REVEAL : 0;

  return (
    <div className="relative overflow-hidden select-none" data-testid="gc-row" data-card-id={card.id}>
      <div className="absolute inset-y-0 right-0 flex" style={{ width: REVEAL }} aria-hidden={!open}>
        <button tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); actions.openBalance(card); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-info/90 text-white text-[12px] font-medium">
          <Wallet className="h-4 w-4" aria-hidden="true" /> Balance
        </button>
        <button tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); actions.archive(card); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-secondary text-foreground text-[12px] font-medium">
          <Archive className="h-4 w-4" aria-hidden="true" /> Mark used
        </button>
      </div>
      <div
        className="relative bg-card flex items-stretch"
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? "none" : "transform 200ms cubic-bezier(0.22,1,0.36,1)", touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onContextMenu={e => { e.preventDefault(); }}
        onClickCapture={e => {
          if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; return; }
          if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** One card in the mobile list. In issuer groups the brand is already in the group header. */
const CardListRow = ({ card, grouped, actions, index }: { card: GiftCardRow; grouped: boolean; actions: CardActions; index: number }) => {
  const bal = Number(card.balance);
  const title = grouped
    ? (card.card_number_last4 ? `•••• ${card.card_number_last4}` : `Card ${index + 1}`)
    : card.brand_name;
  return (
    <SwipeRow card={card} actions={actions}>
      <button onClick={() => actions.openDetail(card)} aria-label={`${cardLabel(card)}, ${fmtUSD(bal)}`}
        className="flex-1 min-w-0 min-h-[60px] flex items-center gap-3 pl-4 pr-2 py-2.5 text-left hover:bg-surface-hover/30 active:bg-surface-hover/50 transition-colors">
        <MiniCardThumb card={card} />
        <div className="flex-1 min-w-0">
          <div className={cn("text-[14px] font-medium text-foreground truncate", grouped && "font-mono tracking-wider text-[13.5px]")}>{title}</div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <ExpiryChip expiry={card.expiry_date} />
            {!grouped && card.card_number_last4 && <span className="text-[12px] text-muted-foreground font-mono">•••• {card.card_number_last4}</span>}
            {card.notes && <span className="text-[12px] text-muted-foreground truncate min-w-0">{card.notes}</span>}
          </div>
        </div>
        <div className={cn("text-[15px] tabular font-semibold shrink-0", bal === 0 ? "text-muted-foreground" : "text-foreground")}>{fmtUSD(bal)}</div>
      </button>
      <button data-no-swipe onClick={() => actions.openCheckout(card)} aria-label={`Show ${cardLabel(card)} at checkout`}
        className="tap-44 shrink-0 w-12 grid place-items-center text-muted-foreground hover:text-foreground border-l border-border/20">
        <ScanBarcode className="h-5 w-5" aria-hidden="true" />
      </button>
    </SwipeRow>
  );
};

/** Desktop tile: the card art is the select target; checkout is a corner shortcut. */
const CardTileButton = ({ card, selected, actions, onSelect }: { card: GiftCardRow; selected: boolean; actions: CardActions; onSelect: (c: GiftCardRow) => void }) => (
  <div className={cn("relative rounded-2xl transition-shadow", selected && "ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-background")} data-testid="gc-tile" data-card-id={card.id}>
    <button onClick={() => onSelect(card)} aria-pressed={selected} aria-label={`${cardLabel(card)}, ${fmtUSD(Number(card.balance))}`}
      className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-offset-4" />
    <GiftCardTile card={card}>
      {/* Above the select overlay (z-20) so it's its own target. */}
      <button onClick={() => actions.openCheckout(card)} aria-label={`Show ${cardLabel(card)} at checkout`}
        className="tap-44 relative z-20 -mr-1.5 -mt-1.5 h-11 w-11 grid place-items-center rounded-full bg-black/30 text-white hover:bg-black/50">
        <ScanBarcode className="h-5 w-5" aria-hidden="true" />
      </button>
    </GiftCardTile>
  </div>
);

const actionBtn = "tap-44 min-h-11 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-strong text-[13px] font-medium text-foreground hover:bg-secondary/40 transition-colors";

/** Detail content shared by the desktop side panel and the mobile popup. */
const CardDetailBody = ({ card, actions, activity, compact = false }: {
  card: GiftCardRow; actions: CardActions; activity: GiftCardActivityRow[]; compact?: boolean;
}) => {
  const [reveal, setReveal] = useState(false);
  useEffect(() => { setReveal(false); }, [card.id]);
  const status = expiryStatus(card.expiry_date);
  const archived = !!card.archived_at;
  const fmtLabel = BARCODE_FORMATS.find(f => f.value === resolveFormat(card))?.label ?? "Code 128";
  return (
    <div className="space-y-4">
      {!archived && (
        <button onClick={() => actions.openCheckout(card)}
          className="tap-44 w-full min-h-11 h-12 rounded-xl bg-gold text-[15px] font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">
          <ScanBarcode className="h-5 w-5" aria-hidden="true" /> Show at checkout
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {!archived && (
          <button onClick={() => actions.openBalance(card)} className={actionBtn}>
            <Wallet className="h-4 w-4" aria-hidden="true" /> Update balance
          </button>
        )}
        <button onClick={() => actions.openEdit(card)} className={actionBtn}>
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
        </button>
        {archived ? (
          <button onClick={() => actions.unarchive(card)} className={actionBtn}>
            <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> Back to wallet
          </button>
        ) : (
          <button onClick={() => actions.archive(card)} className={actionBtn}>
            <Archive className="h-4 w-4" aria-hidden="true" /> Mark used
          </button>
        )}
        {card.balance_check_url && (
          <a href={card.balance_check_url} target="_blank" rel="noopener noreferrer" className={actionBtn}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Check balance
          </a>
        )}
      </div>

      <div className="surface-card p-3.5 space-y-2.5 text-[14px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Balance</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular font-semibold text-foreground">{fmtUSD(Number(card.balance))}</span>
            {card.balance_verified
              ? <CheckCircle2 className="h-3.5 w-3.5 text-positive" aria-label="Verified on vendor site" />
              : <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" aria-label="Estimated balance" />}
          </span>
        </div>
        {card.expiry_date && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Expires</span>
            <span className={cn("tabular text-[13px] font-medium text-right", status === "expired" ? "text-negative" : status === "soon" ? "text-warning" : "text-foreground")}>
              {status === "expired" ? "Expired" : humanizeCountdown(card.expiry_date)}
            </span>
          </div>
        )}
        {(card.card_number || card.card_number_last4) && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Number</span>
            <span className="inline-flex items-center gap-1 min-w-0">
              <span className="font-mono tracking-wider text-foreground truncate">
                {reveal && card.card_number ? card.card_number : `•••• ${card.card_number_last4 ?? "????"}`}
              </span>
              {card.card_number && (
                <button onClick={() => copyToClipboard(card.card_number!.replace(/\s+/g, ""), "Card number")} aria-label="Copy card number"
                  className="tap-44 h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        )}
        {card.pin && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">PIN</span>
            <span className="inline-flex items-center gap-1">
              <span className="font-mono tracking-wider text-foreground">{reveal ? card.pin : "••••"}</span>
              <button onClick={() => copyToClipboard(card.pin!, "PIN")} aria-label="Copy PIN"
                className="tap-44 h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary">
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
        {(card.card_number || card.pin) && (
          <button onClick={() => setReveal(v => !v)} aria-pressed={reveal}
            className="tap-44 min-h-11 -mx-1 px-1 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
            {reveal ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {reveal ? "Hide number and PIN" : "Reveal number and PIN"}
          </button>
        )}
        {card.card_number && (
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="text-muted-foreground">Barcode</span>
            <span className="text-foreground">{fmtLabel}</span>
          </div>
        )}
        {card.notes && <p className="text-[13px] text-muted-foreground border-t border-border/30 pt-2">{card.notes}</p>}
      </div>

      {!compact && <ActivityHistoryList entries={activity} />}
      {compact && activity.length > 0 && <ActivityHistoryList entries={activity} />}

      <div className="flex flex-wrap items-center gap-2">
        {card.buy_url && (
          <a href={card.buy_url} target="_blank" rel="noopener noreferrer" className={cn(actionBtn, "border-transparent px-2 text-muted-foreground")}>
            <ShoppingBag className="h-4 w-4" aria-hidden="true" /> Buy more
          </a>
        )}
        <button onClick={() => actions.requestRemove(card)}
          className="tap-44 min-h-11 ml-auto px-2 inline-flex items-center gap-1.5 rounded-lg text-[13px] text-negative hover:bg-negative/10">
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
        </button>
      </div>
    </div>
  );
};

/** Mobile popup for one card — swipe or use the arrows to move through the visible list. */
const CardDetailDialog = ({ cards, index, onIndexChange, onClose, actions, activityByCard }: {
  cards: GiftCardRow[]; index: number; onIndexChange: (i: number) => void; onClose: () => void;
  actions: CardActions; activityByCard: Record<string, GiftCardActivityRow[]>;
}) => {
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const widthRef = useRef(1);
  const card = cards[index];
  if (!card) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    widthRef.current = (e.currentTarget as HTMLElement).clientWidth || 1;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    setDragX(e.clientX - startXRef.current);
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const threshold = widthRef.current * 0.18;
    if (dragX < -threshold && index < cards.length - 1) onIndexChange(index + 1);
    else if (dragX > threshold && index > 0) onIndexChange(index - 1);
    setDragX(0);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="flex items-center gap-2 pl-4 pr-1 pt-1 shrink-0">
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-display text-[16px] text-foreground truncate">{card.brand_name} details</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted-foreground">
              {cards.length > 1 ? `${index + 1} of ${cards.length} · swipe for more` : "Gift card"}
            </DialogDescription>
          </div>
          <button onClick={onClose} aria-label="Close" className="tap-44 h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="relative shrink-0 overflow-hidden" style={{ touchAction: "pan-y" }}>
          <div className="px-10 py-3 select-none"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}
            style={{ transform: `translateX(${dragX}px)`, transition: draggingRef.current ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)", cursor: cards.length > 1 ? "grab" : "default" }}>
            <GiftCardTile card={card} />
          </div>
          {cards.length > 1 && (
            <>
              <button onClick={() => { if (index > 0) onIndexChange(index - 1); }} disabled={index === 0} aria-label="Previous card"
                className="tap-44 absolute left-0 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center text-foreground disabled:opacity-30 z-10">
                <span className="h-7 w-7 grid place-items-center rounded-full bg-secondary/80"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></span>
              </button>
              <button onClick={() => { if (index < cards.length - 1) onIndexChange(index + 1); }} disabled={index === cards.length - 1} aria-label="Next card"
                className="tap-44 absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center text-foreground disabled:opacity-30 z-10">
                <span className="h-7 w-7 grid place-items-center rounded-full bg-secondary/80"><ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
              </button>
            </>
          )}
        </div>
        <div className="px-4 pb-4 pt-1 overflow-y-auto min-h-0">
          <CardDetailBody card={card} actions={actions} activity={activityByCard[card.id] ?? []} compact />
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Long-press action sheet (mobile). */
const CardActionSheet = ({ card, onClose, actions }: { card: GiftCardRow; onClose: () => void; actions: CardActions }) => {
  const run = (fn: (c: GiftCardRow) => void) => () => { onClose(); fn(card); };
  const item = "tap-44 w-full min-h-12 flex items-center gap-3 px-5 text-left text-[15px] text-foreground hover:bg-secondary/40";
  const archived = !!card.archived_at;
  return (
    <Drawer open onOpenChange={o => { if (!o) onClose(); }} shouldScaleBackground={false}>
      <DrawerContent closeLabel="Close" className="max-h-[80dvh]" data-testid="gc-action-sheet">
        <div className="px-5 pt-3 pb-2 pr-14">
          <DrawerTitle className="font-display text-[17px] text-foreground truncate">{cardLabel(card)}</DrawerTitle>
          <DrawerDescription className="tabular">{fmtUSD(Number(card.balance))} balance</DrawerDescription>
        </div>
        <div className="pb-3">
          {!archived && <button className={item} onClick={run(actions.openCheckout)}><ScanBarcode className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Show at checkout</button>}
          {!archived && <button className={item} onClick={run(actions.openBalance)}><Wallet className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Update balance</button>}
          <button className={item} onClick={run(actions.openEdit)}><Pencil className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Edit card</button>
          {archived
            ? <button className={item} onClick={run(actions.unarchive)}><ArchiveRestore className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Back to wallet</button>
            : <button className={item} onClick={run(actions.archive)}><Archive className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> Mark used / archive</button>}
          <button className={cn(item, "text-negative")} onClick={run(actions.requestRemove)}><Trash2 className="h-5 w-5" aria-hidden="true" /> Remove card</button>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

/** Issuer section header (shared by mobile list and desktop grid). */
const IssuerHeader = ({ group, collapsed, onToggle, className }: { group: IssuerGroup<GiftCardRow>; collapsed: boolean; onToggle: () => void; className?: string }) => (
  <button onClick={onToggle} aria-expanded={!collapsed} data-testid="gc-issuer" data-issuer={group.key}
    aria-label={`${group.name}, ${group.cards.length} card${group.cards.length !== 1 ? "s" : ""}, ${fmtUSD(group.total)}${group.expiringSoon > 0 ? `, ${group.expiringSoon} expiring soon` : ""}`}
    className={cn("tap-44 w-full min-h-[56px] flex items-center gap-3 px-4 py-2 text-left", className)}>
    <BrandLogo domain={group.domain} logoUrl={group.logo_url} name={group.name} size={34} />
    <div className="flex-1 min-w-0">
      <div className="text-[15px] font-semibold text-foreground truncate">{group.name}</div>
      <div className="text-[12.5px] text-muted-foreground flex items-center gap-1.5 min-w-0">
        <span className="shrink-0">{group.cards.length} card{group.cards.length !== 1 ? "s" : ""}</span>
        {group.expiringSoon > 0 && <span className="text-warning font-medium truncate">· {group.expiringSoon} expiring soon</span>}
      </div>
    </div>
    <div className="text-[15px] tabular font-semibold text-foreground shrink-0" data-testid="gc-issuer-total">{fmtUSD(group.total)}</div>
    <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", collapsed && "-rotate-90")} aria-hidden="true" />
  </button>
);

const OPEN_DIALOG = "[role=dialog][data-state=open],[role=alertdialog][data-state=open]";
type GroupMode = "issuer" | "flat";
const PREFS_KEY = "sentryfi_giftcards_view";
const readPrefs = (): { group: GroupMode; sort: SortKey; collapsed: string[] } => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<{ group: GroupMode; sort: SortKey; collapsed: string[] }>;
    return {
      group: raw.group === "flat" ? "flat" : "issuer",
      sort: SORT_OPTIONS.some(o => o.value === raw.sort) ? raw.sort! : "balance-desc",
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter(x => typeof x === "string") : [],
    };
  } catch { return { group: "issuer", sort: "balance-desc", collapsed: [] }; }
};

/** True at the desktop split layout (tile grid + side panel). */
const WIDE_QUERY = "(min-width: 1024px)";
const useWide = (): boolean => {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(WIDE_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia?.(WIDE_QUERY);
    if (!mql) return;
    const on = () => setWide(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, []);
  return wide;
};

export const GiftCardsSection = ({ demo = false }: { demo?: boolean }) => {
  const { user } = useAuth();
  const wide = useWide();
  const isMobile = useIsMobile();
  const [cards, setCards] = useState<GiftCardRow[] | null>(null);
  const [trashCards, setTrashCards] = useState<GiftCardRow[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // True when the live DB predates the soft-delete migration (no deleted_at
  // column): cards still load, but remove/restore are unavailable.
  const [legacySchema, setLegacySchema] = useState(false);
  const [activity, setActivity] = useState<Record<string, GiftCardActivityRow[]>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [balanceCard, setBalanceCard] = useState<GiftCardRow | null>(null);
  const [editCard, setEditCard] = useState<GiftCardRow | null>(null);
  const [checkoutCard, setCheckoutCard] = useState<GiftCardRow | null>(null);
  const [sheetCard, setSheetCard] = useState<GiftCardRow | null>(null);
  const [removeTarget, setRemoveTarget] = useState<GiftCardRow | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }, [prefs]);
  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);
  const toggleGroup = (key: string) => setPrefs(p => ({ ...p, collapsed: p.collapsed.includes(key) ? p.collapsed.filter(k => k !== key) : [...p.collapsed, key] }));

  // Guest/demo mode never has a real user, so gift_cards can't be queried —
  // show illustrative sample cards instead and block every mutation with an
  // explanatory toast rather than silently failing against Supabase.
  const demoBlocked = () => toast("Create a free account to manage your gift cards", { description: "This is sample data in demo mode." });

  const load = useCallback(async () => {
    if (demo) { setCards(buildDemoCards()); setTrashCards([]); setActivity({}); setLoadError(null); return; }
    if (!user) return;
    try {
      const [{ data, error }, { data: trashData, error: trashError }, { data: activityData, error: activityError }] = await Promise.all([
        db.from("gift_cards").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
        db.from("gift_cards").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
        activityTableMissing
          ? Promise.resolve({ data: [], error: null })
          : db.from("gift_card_activity").select("*").order("created_at", { ascending: false }),
      ]);

      if (error && isMissingColumnError(error, "deleted_at")) {
        // DB is missing the soft-delete migration — show every card rather
        // than failing the whole page.
        const legacy = await db.from("gift_cards").select("*").order("created_at", { ascending: false });
        if (legacy.error) throw new Error(legacy.error.message);
        console.warn("[gift_cards] deleted_at column missing — apply supabase/migrations/20261020120000_repair_gift_cards_trash_and_activity.sql");
        setLegacySchema(true);
        setCards((legacy.data ?? []) as GiftCardRow[]);
        setTrashCards([]);
      } else if (error) {
        throw new Error(error.message);
      } else {
        setLegacySchema(false);
        setCards((data ?? []) as GiftCardRow[]);
        if (trashError) console.error("[gift_cards] removed-cards load failed:", trashError.message);
        else setTrashCards((trashData ?? []) as GiftCardRow[]);
      }
      setLoadError(null);

      if (activityError) {
        if (isMissingTableError(activityError)) activityTableMissing = true;
        console.error("[gift_card_activity] load failed:", activityError.message);
        setActivity({});
      } else {
        const grouped: Record<string, GiftCardActivityRow[]> = {};
        for (const row of (activityData ?? []) as GiftCardActivityRow[]) {
          (grouped[row.gift_card_id] ??= []).push(row);
        }
        setActivity(grouped);
      }
    } catch (e) {
      // A failed query shows an error panel with a retry instead of an
      // endless spinner.
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [user, demo]);

  useEffect(() => { load(); }, [load]);

  const { active, archived } = useMemo(() => splitArchived(cards ?? []), [cards]);
  const summary = useMemo(() => summarize(active), [active]);
  const visible = useMemo(() => {
    const hits = filterCards(active, query);
    return onlyExpiring ? hits.filter(c => expiryStatus(c.expiry_date) === "soon") : hits;
  }, [active, query, onlyExpiring]);
  const groups = useMemo(() => groupByIssuer(visible, prefs.sort), [visible, prefs.sort]);
  const flat = useMemo(() => sortCards(visible, prefs.sort), [visible, prefs.sort]);
  /** Display order (what Prev/Next in the detail popup walks through). */
  const ordered = useMemo(() => prefs.group === "issuer" ? groups.flatMap(g => g.cards) : flat, [prefs.group, groups, flat]);
  useEffect(() => { if (!onlyExpiring) return; if (summary.expiringSoon === 0) setOnlyExpiring(false); }, [onlyExpiring, summary.expiringSoon]);

  const allCards = useMemo(() => [...(cards ?? []), ...trashCards], [cards, trashCards]);
  const selected = (selectedId && allCards.find(c => c.id === selectedId)) || ordered[0] || null;

  const blockedReason = () => {
    if (demo) { demoBlocked(); return true; }
    return false;
  };

  const removeCard = async (card: GiftCardRow) => {
    if (blockedReason()) return;
    if (legacySchema) {
      toast.error("Removing cards isn't available yet", { description: "The gift card database update hasn't been applied. Your cards are safe." });
      return;
    }
    const { error } = await db.from("gift_cards").update({ deleted_at: new Date().toISOString() }).eq("id", card.id);
    if (error) { toast.error("Couldn't remove card", { description: error.message }); return; }
    if (user) await logActivity({ gift_card_id: card.id, user_id: user.id, kind: "removed", amount: null, balance_after: Number(card.balance) });
    toast.success("Gift card removed", { description: "Restore it anytime from Removed cards below." });
    if (detailId === card.id) setDetailId(null);
    load();
  };

  const restoreCard = async (card: GiftCardRow) => {
    if (blockedReason()) return;
    setRestoringId(card.id);
    const { error } = await db.from("gift_cards").update({ deleted_at: null }).eq("id", card.id);
    setRestoringId(null);
    if (error) { toast.error("Couldn't restore card", { description: error.message }); return; }
    if (user) await logActivity({ gift_card_id: card.id, user_id: user.id, kind: "restored", amount: null, balance_after: Number(card.balance) });
    toast.success("Gift card restored");
    load();
  };

  const setArchived = async (card: GiftCardRow, on: boolean) => {
    if (blockedReason()) return;
    const { error } = await db.from("gift_cards").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", card.id);
    if (error) {
      if (isMissingColumnError(error, "archived_at")) {
        toast.error("Archiving isn't available yet", { description: "The gift card database update hasn't been applied. Your card is unchanged." });
      } else toast.error(on ? "Couldn't archive card" : "Couldn't restore card", { description: error.message });
      return;
    }
    if (user) await logActivity({ gift_card_id: card.id, user_id: user.id, kind: on ? "archived" : "unarchived", amount: null, balance_after: Number(card.balance) });
    toast.success(on ? `${card.brand_name} moved to Used & archived` : `${card.brand_name} is back in your wallet`);
    if (on && detailId === card.id) setDetailId(null);
    load();
  };

  // Dialogs here are mounted on demand (no Radix Trigger), so remember the
  // on-page control that opened the first one and hand focus back to it when
  // the last one closes — also across chains like checkout → update balance.
  const returnFocus = useRef<HTMLElement | null>(null);
  const noteOpener = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && !el.closest(OPEN_DIALOG)) returnFocus.current = el;
  };
  const restoreFocus = () => {
    window.setTimeout(() => {
      if (document.querySelector(OPEN_DIALOG)) return;
      const el = returnFocus.current;
      if (el && el.isConnected) el.focus();
    }, 30);
  };
  const closeWith = (fn: () => void) => () => { fn(); restoreFocus(); };

  const actions: CardActions = {
    openDetail: c => { if (wide) setSelectedId(c.id); else { noteOpener(); setDetailId(c.id); } },
    openCheckout: c => { noteOpener(); setDetailId(null); setCheckoutCard(c); },
    openBalance: c => { if (blockedReason()) return; noteOpener(); setCheckoutCard(null); setDetailId(null); setBalanceCard(c); },
    openEdit: c => { if (blockedReason()) return; noteOpener(); setCheckoutCard(null); setDetailId(null); setEditCard(c); },
    archive: c => { void setArchived(c, true); },
    unarchive: c => { void setArchived(c, false); },
    requestRemove: c => { if (blockedReason()) return; noteOpener(); setRemoveTarget(c); },
    openSheet: c => { noteOpener(); setSheetCard(c); },
  };
  const openAdd = () => { if (blockedReason()) return; setAddOpen(true); };

  const detailIndex = detailId ? ordered.findIndex(c => c.id === detailId) : -1;
  const detailList = detailIndex >= 0 ? ordered : (detailId ? allCards.filter(c => c.id === detailId) : []);
  const segBtn = (on: boolean) => cn(
    "tap-44 h-11 min-h-11 px-3 inline-flex items-center gap-1.5 rounded-[7px] text-[13px] font-medium transition-colors whitespace-nowrap",
    on ? "bg-surface-elevated text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
  );

  const loaded = cards !== null;
  const hasCards = active.length > 0;

  return (
    <section className="space-y-4 min-w-0" data-testid="giftcards">
      {/* ── Summary header ── */}
      <div className="surface-card p-4 md:p-5 relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full opacity-25 blur-2xl" style={{ background: "hsl(var(--gold, 45 90% 55%))" }} />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">Your cards</h2>
            {loaded && hasCards ? (
              <>
                <div className="text-[12px] uppercase tracking-wider text-muted-foreground mt-2">Total value</div>
                <div className="font-display text-[30px] md:text-[36px] leading-none tabular text-foreground mt-1" data-testid="gc-total">{fmtUSD(summary.total)}</div>
                <div className="text-[13px] text-muted-foreground mt-1.5">
                  {summary.count} card{summary.count !== 1 ? "s" : ""} · {summary.issuers} issuer{summary.issuers !== 1 ? "s" : ""}
                  {summary.expired > 0 && <> · <span className="text-negative">{summary.expired} expired</span></>}
                </div>
              </>
            ) : (
              <p className="text-[13px] text-muted-foreground mt-1">Balances, barcodes and expiry dates in one place.</p>
            )}
          </div>
          <button onClick={openAdd} aria-label="Add gift card"
            className="tap-44 shrink-0 inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-full bg-gold text-[14px] font-semibold hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> <span>Add</span>
          </button>
        </div>
        {loaded && summary.expiringSoon > 0 && (
          <button onClick={() => setOnlyExpiring(v => !v)} aria-pressed={onlyExpiring} data-testid="gc-expiring"
            className={cn("tap-44 relative mt-3 w-full min-h-11 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
              onlyExpiring ? "border-warning bg-warning/20" : "border-warning/30 bg-warning/10 hover:bg-warning/15")}>
            <Clock className="h-4 w-4 text-warning shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-foreground">
              <span className="font-semibold tabular">{fmtUSD(summary.expiringSoonValue)}</span> expiring in the next {EXPIRY_WARNING_DAYS} days
              <span className="text-muted-foreground"> · {summary.expiringSoon} card{summary.expiringSoon !== 1 ? "s" : ""}</span>
            </span>
            <span className="text-warning font-semibold shrink-0">{onlyExpiring ? "Show all" : "Review"}</span>
          </button>
        )}
      </div>

      {loadError && (
        <div className="surface-card p-6 text-center">
          <AlertCircle className="h-6 w-6 mx-auto text-negative/70 mb-2" aria-hidden="true" />
          <div className="text-[14px] text-foreground font-medium">Couldn't load your gift cards</div>
          <div className="text-[12.5px] text-muted-foreground mt-1 break-words">{loadError}</div>
          <button onClick={() => { setCards(null); setLoadError(null); load(); }}
            className="tap-44 mt-3 inline-flex items-center gap-1.5 h-11 px-4 rounded-md border border-border-strong text-[13px] font-medium hover:bg-secondary/40 transition-colors">
            Try again
          </button>
        </div>
      )}

      {loadError && !hasCards ? null : !loaded ? (
        <div className="surface-card p-8 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading gift cards" />
        </div>
      ) : !hasCards ? (
        /* ── Empty state ── */
        <div className="surface-card px-6 py-10 text-center" data-testid="gc-empty">
          <div aria-hidden="true" className="relative mx-auto h-24 w-36 mb-5">
            <div className="absolute inset-x-3 top-0 h-20 rounded-xl rotate-[-8deg] opacity-60" style={{ background: brandGradient("Target") }} />
            <div className="absolute inset-x-1 top-1 h-20 rounded-xl rotate-[5deg] opacity-80" style={{ background: brandGradient("Starbucks") }} />
            <div className="absolute inset-x-0 top-3 h-20 rounded-xl grid place-items-center shadow-lg" style={{ background: brandGradient("Amazon") }}>
              <Gift className="h-8 w-8 text-white/90" />
            </div>
          </div>
          <div className="text-[16px] text-foreground font-semibold">{archived.length > 0 ? "No active gift cards" : "Keep every gift card in one place"}</div>
          <ul className="text-[13px] text-muted-foreground mt-2 space-y-1">
            <li>Show a scannable barcode at the register</li>
            <li>Track what's left on each card</li>
            <li>Get a heads-up before a card expires</li>
          </ul>
          <button onClick={openAdd}
            className="tap-44 mt-5 inline-flex items-center gap-1.5 h-11 px-5 rounded-full bg-gold text-[14px] font-semibold hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add your first gift card
          </button>
        </div>
      ) : (
        <>
          {/* ── Toolbar: search, grouping, sort ── */}
          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" aria-hidden="true" />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search gift cards"
                placeholder="Search issuer, notes or last 4"
                className="w-full h-11 pl-9 pr-10 rounded-lg bg-surface/60 border border-border/60 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors [&::-webkit-search-cancel-button]:hidden" />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search"
                  className="tap-44 absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex gap-2 min-w-0">
              <div role="group" aria-label="Group cards" className="inline-flex p-0.5 rounded-lg bg-secondary/60 border border-border/40 shrink-0">
                <button onClick={() => setPrefs(p => ({ ...p, group: "issuer" }))} aria-pressed={prefs.group === "issuer"} className={segBtn(prefs.group === "issuer")}>
                  <Layers className="h-3.5 w-3.5 hidden min-[380px]:block" aria-hidden="true" /> By issuer
                </button>
                <button onClick={() => setPrefs(p => ({ ...p, group: "flat" }))} aria-pressed={prefs.group === "flat"} className={segBtn(prefs.group === "flat")}>
                  {wide ? <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> : <List className="h-3.5 w-3.5 hidden min-[380px]:block" aria-hidden="true" />} All cards
                </button>
              </div>
              <select value={prefs.sort} onChange={e => setPrefs(p => ({ ...p, sort: e.target.value as SortKey }))} aria-label="Sort cards"
                className="h-11 min-w-0 flex-1 sm:flex-none sm:w-44 rounded-lg bg-surface/60 border border-border/60 px-2.5 text-[14px] text-foreground outline-none focus:border-primary/50">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="surface-card p-6 text-center" data-testid="gc-no-results">
              <div className="text-[14px] font-medium text-foreground">{query ? <>No cards match “{query}”</> : "No cards expiring soon"}</div>
              <button onClick={() => { setQuery(""); setOnlyExpiring(false); }}
                className="tap-44 mt-3 h-11 px-4 rounded-full border border-border-strong text-[13px] font-medium hover:bg-secondary/40">
                Show all cards
              </button>
            </div>
          ) : wide ? (
            /* ── Desktop: tile grid + sticky detail panel ── */
            <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
              <div className="space-y-5 min-w-0">
                {prefs.group === "issuer" ? groups.map(g => (
                  <div key={g.key} className="space-y-3">
                    <IssuerHeader group={g} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)}
                      className="surface-card rounded-xl hover:bg-surface-hover/30" />
                    {!collapsed.has(g.key) && (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4 px-1">
                        {g.cards.map(c => <CardTileButton key={c.id} card={c} selected={selected?.id === c.id} actions={actions} onSelect={x => setSelectedId(x.id)} />)}
                      </div>
                    )}
                  </div>
                )) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4 px-1">
                    {flat.map(c => <CardTileButton key={c.id} card={c} selected={selected?.id === c.id} actions={actions} onSelect={x => setSelectedId(x.id)} />)}
                  </div>
                )}
              </div>
              {selected && (
                <aside aria-label={`${selected.brand_name} details`} className="surface-card p-4 space-y-4 sticky top-4" data-testid="gc-panel">
                  <div className="flex items-center gap-3">
                    <BrandLogo domain={selected.domain} logoUrl={selected.logo_url} name={selected.brand_name} size={36} />
                    <div className="min-w-0">
                      <div className="font-display text-[17px] text-foreground truncate">{selected.brand_name}</div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {selected.card_number_last4 ? `•••• ${selected.card_number_last4}` : "Gift card"}
                        {selected.archived_at ? " · Used & archived" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="max-w-[280px] mx-auto"><GiftCardTile card={selected} /></div>
                  <CardDetailBody card={selected} actions={actions} activity={activity[selected.id] ?? []} />
                </aside>
              )}
            </div>
          ) : (
            /* ── Mobile / tablet: grouped list ── */
            <div className="space-y-3">
              {prefs.group === "issuer" ? groups.map(g => (
                <div key={g.key} className="surface-card overflow-hidden">
                  <IssuerHeader group={g} collapsed={collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)} />
                  {!collapsed.has(g.key) && (
                    <div className="divide-y divide-border/15 border-t border-border/20">
                      {g.cards.map((c, i) => <CardListRow key={c.id} card={c} grouped index={i} actions={actions} />)}
                    </div>
                  )}
                </div>
              )) : (
                <div className="surface-card overflow-hidden divide-y divide-border/15">
                  {flat.map((c, i) => <CardListRow key={c.id} card={c} grouped={false} index={i} actions={actions} />)}
                </div>
              )}
              {isMobile && <p className="text-center text-[12px] text-muted-foreground/70 px-4">Swipe a card left for quick actions, or press and hold for more.</p>}
            </div>
          )}
        </>
      )}

      {/* ── Used & archived ── */}
      {archived.length > 0 && (
        <div className="surface-card overflow-hidden" data-testid="gc-archived">
          <button onClick={() => setArchiveOpen(v => !v)} aria-expanded={archiveOpen}
            className="tap-44 w-full min-h-11 flex items-center justify-between px-4 py-3 text-left">
            <span className="text-[13px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
              <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Used & archived ({archived.length})
            </span>
            <ChevronRight className={cn("h-4 w-4 text-muted-foreground/50 transition-transform", archiveOpen && "rotate-90")} aria-hidden="true" />
          </button>
          {archiveOpen && (
            <div className="divide-y divide-border/15 border-t border-border/20">
              {archived.map(card => (
                <div key={card.id} className="flex items-center gap-3 px-4 py-2">
                  <button onClick={() => actions.openDetail(card)} className="flex-1 min-w-0 min-h-11 flex items-center gap-3 text-left">
                    <span className="opacity-60"><MiniCardThumb card={card} /></span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-foreground truncate">{cardLabel(card)}</span>
                      <span className="block text-[12px] text-muted-foreground">
                        {fmtUSD(Number(card.balance))}{card.archived_at ? ` · archived ${fmtShortDate(card.archived_at)}` : ""}
                      </span>
                    </span>
                  </button>
                  <button onClick={() => actions.unarchive(card)}
                    className="tap-44 h-11 px-3 rounded-md border border-border-strong text-[12.5px] font-medium text-foreground hover:bg-secondary/40 transition-colors shrink-0">
                    Back to wallet
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Removed (soft-deleted) ── */}
      {trashCards.length > 0 && (
        <div className="surface-card overflow-hidden">
          <button onClick={() => setTrashOpen(v => !v)} aria-expanded={trashOpen}
            className="tap-44 w-full min-h-11 flex items-center justify-between px-4 py-3 text-left">
            <span className="text-[13px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Removed cards ({trashCards.length})
            </span>
            <ChevronRight className={cn("h-4 w-4 text-muted-foreground/50 transition-transform", trashOpen && "rotate-90")} aria-hidden="true" />
          </button>
          {trashOpen && (
            <div className="divide-y divide-border/15 border-t border-border/20">
              {trashCards.map(card => (
                <div key={card.id} className="flex items-center gap-3 px-4 py-3">
                  <MiniCardThumb card={card} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-foreground truncate">{card.brand_name}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {fmtUSD(Number(card.balance))}{card.deleted_at ? ` · removed ${fmtShortDate(card.deleted_at)}` : ""}
                    </div>
                  </div>
                  <button onClick={() => restoreCard(card)} disabled={restoringId === card.id}
                    className="tap-44 h-11 px-3 rounded-md border border-border-strong text-[12.5px] font-medium text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5">
                    {restoringId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AddGiftCardDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
      {balanceCard && (
        <BalanceDialog card={balanceCard} onClose={closeWith(() => setBalanceCard(null))} onSaved={load}
          onArchive={() => { void setArchived(balanceCard, true); }} />
      )}
      {editCard && <EditGiftCardDialog card={editCard} onClose={closeWith(() => setEditCard(null))} onSaved={load} />}
      {detailId && detailList.length > 0 && (
        <CardDetailDialog
          cards={detailList}
          index={Math.max(0, detailIndex)}
          onIndexChange={i => setDetailId(detailList[i]?.id ?? null)}
          onClose={closeWith(() => setDetailId(null))}
          actions={actions}
          activityByCard={activity}
        />
      )}
      {checkoutCard && (
        <CheckoutView card={checkoutCard} onClose={closeWith(() => setCheckoutCard(null))}
          onEdit={c => actions.openEdit(c)} onUpdateBalance={c => actions.openBalance(c)} />
      )}
      {sheetCard && <CardActionSheet card={sheetCard} onClose={closeWith(() => setSheetCard(null))} actions={actions} />}
      <AlertDialog open={!!removeTarget} onOpenChange={o => { if (!o) { setRemoveTarget(null); restoreFocus(); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this gift card?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget && <>This moves {removeTarget.brand_name}'s {fmtUSD(Number(removeTarget.balance))} balance
              {(removeTarget.card_number || removeTarget.card_number_last4 || removeTarget.pin) ? " and stored card number/PIN" : ""} to Removed cards. You can restore it anytime from there. If you've used it up, Mark used keeps it in your history instead.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (removeTarget) void removeCard(removeTarget); setRemoveTarget(null); }}
              className="bg-negative text-negative-foreground hover:bg-negative/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

/* ───────────────────────── Add dialog ───────────────────────── */

/** Logo specifically for search-result dropdowns — uses Google favicon as primary
 *  source (loads instantly, never blank) with the Clearbit/logo.dev logo as
 *  a higher-res fallback once it resolves. Falls back to a colored letter avatar. */
const SearchResultLogo = ({ name, domain, logo }: { name: string; domain: string; logo: string }) => {
  // Clearbit's logo from the search API is a direct CDN URL — use it first.
  // Logo.dev is the second choice. Letter avatar only if both fail.
  const fallbacks = [
    logo,                        // clearbit search result logo (direct CDN, CORS-friendly)
    logoUrlForDomain(domain),    // logo.dev
    `https://icons.duckduckgo.com/ip3/${domain}.ico`, // DDG favicon (CORS-friendly fallback)
  ].filter(Boolean);
  const [attempt, setAttempt] = useState(0);
  const src = fallbacks[attempt];

  if (!src) {
    return (
      <div className="h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center text-gold font-display shrink-0"
        style={{ fontSize: 15 }}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img src={src} alt={`${name} logo`}
      onError={() => setAttempt(a => a + 1 < fallbacks.length ? a + 1 : fallbacks.length)}
      className="h-9 w-9 rounded-lg object-contain bg-white p-[8%] shrink-0 border border-border/30" />
  );
};

const AddGiftCardDialog = ({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) => {
  const { user } = useAuth();

  // Step 1: brand selection
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [search, setSearch] = useState("");
  const [lookupResults, setLookupResults] = useState<BrandSuggestion[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  // The chosen brand — either a preset or a custom lookup result
  type ChosenBrand = { name: string; domain: string | null; logo_url: string | null; balanceCheckUrl?: string | null; buyUrl?: string | null };
  const [chosen, setChosen] = useState<ChosenBrand | null>(null);

  // Step 2: card details
  const [balance, setBalance] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [pin, setPin] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [format, setFormat] = useState<BarcodeFormat>(DEFAULT_BARCODE_FORMAT);
  const [saving, setSaving] = useState(false);

  const last4 = cardNumber.replace(/\D/g, "").slice(-4);

  const reset = () => {
    setStep("pick"); setSearch(""); setLookupResults([]); setChosen(null);
    setBalance(""); setCardNumber(""); setPin(""); setExpiryDate(""); setNotes(""); setFormat(DEFAULT_BARCODE_FORMAT);
  };
  useEffect(() => { if (!open) reset(); }, [open]);

  const filteredPresets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return GIFT_CARD_BRANDS;
    return GIFT_CARD_BRANDS.filter(b => b.name.toLowerCase().includes(q));
  }, [search]);

  // Debounced company search — only runs when no preset matches search
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setLookupResults([]); return; }
    const controller = new AbortController();
    setLookupLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchBrands(q, controller.signal);
        setLookupResults(results);
      } catch { /* ignore */ } finally { setLookupLoading(false); }
    }, 400);
    return () => { clearTimeout(t); controller.abort(); };
  }, [search]);

  const selectBrand = (brand: ChosenBrand) => {
    setChosen(brand);
    setStep("details");
  };

  const save = async () => {
    if (!user || !chosen || balance === "") return;
    setSaving(true);
    const bal = Number(balance) || 0;
    const { data: inserted, error } = await writeCard<{ id: string }>({
      user_id: user.id,
      brand_name: chosen.name,
      domain: chosen.domain ?? null,
      logo_url: chosen.logo_url ?? null,
      balance_check_url: chosen.balanceCheckUrl ?? (chosen.domain ? `https://${chosen.domain}` : null),
      buy_url: chosen.buyUrl ?? null,
      balance: bal,
      initial_balance: bal,
      card_number: cardNumber.replace(/\s/g, "") || null,
      card_number_last4: last4 || null,
      pin: pin || null,
      expiry_date: expiryDate || null,
      notes: notes.trim() || null,
      barcode_format: format,
    }, p => db.from("gift_cards").insert(p).select().single());
    setSaving(false);
    if (error) { toast.error("Couldn't add gift card", { description: error.message }); return; }
    if (inserted) {
      await logActivity({ gift_card_id: inserted.id, user_id: user.id, kind: "added", amount: null, balance_after: bal });
    }
    toast.success(`${chosen.name} gift card added`);
    onOpenChange(false);
    onAdded();
  };

  const preview = chosen
    ? { brand_name: chosen.name, domain: chosen.domain, logo_url: chosen.logo_url, balance: Number(balance) || 0, card_number_last4: last4 || null, expiry_date: expiryDate || null }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[88vh] flex flex-col">
        <DialogTitle className="sr-only">Add a gift card</DialogTitle>
        <DialogDescription className="sr-only">Choose a brand, then enter the card details.</DialogDescription>

        {/* Header with back button on step 2 */}
        <div className="px-4 pt-4 pb-3 border-b border-border/40 shrink-0 flex items-center gap-2">
          {step === "details" && (
            <button onClick={() => setStep("pick")} aria-label="Back to brand selection"
              className="tap-44 -ml-2 h-11 w-11 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-2.5 min-w-0">
            {step === "details" && chosen ? (
              <>
                <BrandLogo domain={chosen.domain} logoUrl={chosen.logo_url} name={chosen.name} size={32} />
                <div className="min-w-0">
                  <div className="font-display text-[15px] text-foreground truncate">{chosen.name}</div>
                  <div className="text-[12.5px] text-muted-foreground">Enter card details</div>
                </div>
              </>
            ) : (
              <>
                <div className="h-8 w-8 rounded-lg bg-gold grid place-items-center shrink-0">
                  <Gift className="h-4 w-4" />
                </div>
                <div className="font-display text-[15px] text-foreground">Add a gift card</div>
              </>
            )}
          </div>
          <button onClick={() => onOpenChange(false)} aria-label="Close" className="tap-44 ml-auto -mr-1.5 h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1: Brand picker */}
        {step === "pick" && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            {/* Brand grid — takes all available space, scrollable */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 min-h-0">
              {filteredPresets.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 pb-3">
                  {filteredPresets.map(b => (
                    <button key={b.name} onClick={() => selectBrand({ name: b.name, domain: b.domain, logo_url: null, balanceCheckUrl: b.balanceCheckUrl, buyUrl: b.buyUrl })}
                      className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border/40 hover:border-primary/50 hover:bg-primary/5 active:scale-95 transition-all">
                      <BrandLogo domain={b.domain} name={b.name} size={36} />
                      <span className="text-[12.5px] text-foreground leading-tight text-center line-clamp-2">{b.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                /* No preset matches — show company search results inline */
                <div className="py-2 space-y-1 pb-3">
                  {lookupLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {!lookupLoading && lookupResults.length > 0 && lookupResults.map(r => (
                    <button key={r.domain} onClick={() => selectBrand({ name: r.name, domain: r.domain, logo_url: r.logo })}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-border/40 hover:border-primary/50 hover:bg-primary/5 transition-colors text-left">
                      <SearchResultLogo name={r.name} domain={r.domain} logo={r.logo} />
                      <div className="min-w-0">
                        <div className="text-[14px] text-foreground font-medium truncate">{r.name}</div>
                        <div className="text-[12.5px] text-muted-foreground truncate">{r.domain}</div>
                      </div>
                    </button>
                  ))}
                  {!lookupLoading && search.trim().length >= 2 && lookupResults.length === 0 && (
                    <button onClick={() => selectBrand({ name: search.trim(), domain: null, logo_url: null })}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-border/40 border-dashed hover:border-primary/50 hover:bg-primary/5 transition-colors text-left">
                      <div className="h-9 w-9 rounded-lg bg-secondary/60 grid place-items-center shrink-0">
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="text-[14px] text-foreground font-medium">Add "{search.trim()}"</div>
                        <div className="text-[12.5px] text-muted-foreground">Save without a logo</div>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Search bar — pinned at the bottom */}
            <div className="shrink-0 px-4 pb-4 pt-2 border-t border-border/30 bg-background/80 backdrop-blur">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search brands or any company…" aria-label="Search brands"
                  className="w-full h-11 pl-10 pr-10 rounded-xl bg-surface/60 border border-border/60 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors"
                />
                {search && (
                  <button onClick={() => { setSearch(""); setLookupResults([]); }} aria-label="Clear search"
                    className="tap-44 absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {lookupLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Card details */}
        {step === "details" && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
              {/* Live card preview */}
              {preview && (
                <div className="max-w-[260px] mx-auto">
                  <GiftCardTile card={preview} />
                </div>
              )}

              {/* Balance — required, prominent */}
              <div>
                <label htmlFor="gc-add-balance" className="text-[13px] font-medium text-foreground">Current balance *</label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[15px]">$</span>
                  <input
                    id="gc-add-balance" type="number" inputMode="decimal" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
                    placeholder="0.00" autoFocus
                    className="w-full h-12 pl-7 pr-3 bg-surface/40 border border-border/60 rounded-xl text-[16px] text-foreground outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="gc-add-number" className="text-[13px] font-medium text-foreground">Card number</label>
                  <input id="gc-add-number" autoComplete="off" value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Optional"
                    className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div>
                  <label htmlFor="gc-add-pin" className="text-[13px] font-medium text-foreground">PIN</label>
                  <input id="gc-add-pin" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)} placeholder="Optional"
                    className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
              </div>

              <BarcodeFormatPicker value={format} onChange={setFormat} number={cardNumber} brand={chosen?.name ?? "gift card"} />

              <div>
                <label htmlFor="gc-add-expiry" className="text-[13px] font-medium text-foreground">Expiry date</label>
                <input id="gc-add-expiry" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                  className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>

              <div>
                <label htmlFor="gc-add-notes" className="text-[13px] font-medium text-foreground">Notes</label>
                <input id="gc-add-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Birthday gift from mom"
                  className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>
            </div>

            <div className="p-4 border-t border-border/40 shrink-0">
              <button onClick={save} disabled={balance === "" || saving}
                className="tap-44 w-full h-12 rounded-xl bg-gold text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Plus className="h-4 w-4" /> Add {chosen?.name ?? "gift card"}</>}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ───────────────────────── Barcode type picker ───────────────────────── */

const BarcodeFormatPicker = ({ value, onChange, number, brand }: { value: BarcodeFormat; onChange: (f: BarcodeFormat) => void; number: string; brand: string }) => {
  const fb = number.trim() ? barcodeValue(number, value).fellBack : false;
  return (
    <div>
      <div id="gc-format-label" className="text-[13px] font-medium text-foreground">Barcode type</div>
      <div role="group" aria-labelledby="gc-format-label" className="mt-1.5 grid grid-cols-2 gap-1.5">
        {BARCODE_FORMATS.map(f => (
          <button key={f.value} type="button" onClick={() => onChange(f.value)} aria-pressed={value === f.value}
            className={cn("tap-44 min-h-11 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
              value === f.value ? "border-primary bg-primary/10" : "border-border/60 hover:bg-secondary/40")}>
            <span className="block text-[13px] font-medium text-foreground">{f.label}</span>
            <span className="block text-[11px] text-muted-foreground leading-tight">{f.hint}</span>
          </button>
        ))}
      </div>
      {fb && <p className="mt-1.5 text-[12px] text-warning">EAN-13 needs 12 or 13 digits with a valid check digit. This number will show as Code 128.</p>}
      {number.trim() && (
        <div className="mt-2 rounded-lg bg-white p-2">
          <GiftCardBarcode number={number} format={value} brand={brand} className={value === "qrcode" ? "max-w-[120px] mx-auto" : "max-h-[72px]"} />
        </div>
      )}
    </div>
  );
};

/* ───────────────────────── Update balance dialog ───────────────────────── */

const BalanceDialog = ({ card, onClose, onSaved, onArchive }: { card: GiftCardRow; onClose: () => void; onSaved: () => void; onArchive: () => void }) => {
  const { user } = useAuth();
  const [mode, setMode] = useState<"spent" | "set">("spent");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [askArchive, setAskArchive] = useState(false);
  const prev = Number(card.balance);
  const n = Number(amount);
  const valid = amount !== "" && Number.isFinite(n) && n >= 0;
  const newBalance = Math.round((mode === "spent" ? Math.max(0, prev - (valid ? n : 0)) : (valid ? n : prev)) * 100) / 100;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const { error } = await db.from("gift_cards").update({
      balance: newBalance,
      last_balance_update: new Date().toISOString(),
      balance_verified: mode === "set",
    }).eq("id", card.id);
    setSaving(false);
    if (error) { toast.error("Couldn't update balance", { description: error.message }); return; }
    if (user) {
      await logActivity(mode === "spent"
        ? { gift_card_id: card.id, user_id: user.id, kind: "spend", amount: n, balance_after: newBalance, note: note.trim() || null }
        : { gift_card_id: card.id, user_id: user.id, kind: "adjustment", amount: newBalance - prev, balance_after: newBalance, note: note.trim() || null });
    }
    toast.success("Balance updated");
    onSaved();
    // Used it up? Offer to move it out of the wallet instead of closing silently.
    if (newBalance === 0 && prev > 0) { setAskArchive(true); return; }
    onClose();
  };

  if (askArchive) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-sm surface-elevated border-border p-5 gap-4">
          <DialogTitle className="font-display text-base text-foreground">{card.brand_name} is used up</DialogTitle>
          <DialogDescription className="text-[13.5px] text-muted-foreground">
            The balance is now $0. Mark it used to move it to Used & archived? You can bring it back anytime.
          </DialogDescription>
          <div className="flex gap-2">
            <button onClick={() => { onArchive(); onClose(); }}
              className="tap-44 flex-1 h-11 rounded-lg bg-gold text-[14px] font-semibold hover:opacity-90 inline-flex items-center justify-center gap-1.5">
              <Archive className="h-4 w-4" aria-hidden="true" /> Mark used
            </button>
            <button onClick={onClose} className="tap-44 h-11 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground">
              Keep it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const quick = mode === "spent" ? [5, 10, 20].filter(v => v < prev) : [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <div className="flex items-center gap-3 pl-5 pr-1 py-2 border-b border-border/40">
          <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={34} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-display text-base text-foreground truncate">Update {card.brand_name} balance</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted-foreground tabular">Now {fmtUSD(prev)}</DialogDescription>
          </div>
          <button onClick={onClose} aria-label="Close" className="tap-44 h-11 w-11 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-hover">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div role="group" aria-label="How to update" className="grid grid-cols-2 p-0.5 rounded-lg bg-secondary/60 border border-border/40">
            {(["spent", "set"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={cn("tap-44 h-11 min-h-11 rounded-[7px] text-[13px] font-medium", mode === m ? "bg-surface-elevated text-foreground shadow-sm" : "text-muted-foreground")}>
                {m === "spent" ? "I spent" : "New balance"}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="gc-balance-amount" className="text-[13px] font-medium text-foreground">{mode === "spent" ? "Amount spent" : "Balance on the card now"}</label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[15px]">$</span>
              <input id="gc-balance-amount" type="number" inputMode="decimal" step="0.01" min="0" autoFocus value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                className="w-full h-12 pl-7 pr-3 bg-surface/40 border border-border/60 rounded-xl text-[16px] text-foreground outline-none focus:border-primary/50" />
            </div>
          </div>
          {quick.length > 0 && (
            <div className="flex gap-1.5">
              {quick.map(v => (
                <button key={v} onClick={() => setAmount(String(v))} className="tap-44 h-11 px-3 rounded-full border border-border/60 text-[13px] text-foreground hover:bg-secondary/40">{fmtUSD(v)}</button>
              ))}
              <button onClick={() => setAmount(String(prev))} className="tap-44 h-11 px-3 rounded-full border border-border/60 text-[13px] text-foreground hover:bg-secondary/40">All of it</button>
            </div>
          )}
          <div className="text-[13px] text-muted-foreground">New balance: <span className="text-foreground font-semibold tabular" data-testid="gc-new-balance">{fmtUSD(newBalance)}</span></div>
          <div>
            <label htmlFor="gc-balance-note" className="text-[13px] font-medium text-foreground">Note (optional)</label>
            <input id="gc-balance-note" value={note} onChange={e => setNote(e.target.value)} placeholder={mode === "spent" ? "e.g. Coffee run" : "e.g. Checked on the receipt"}
              className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50" />
          </div>
        </div>
        <div className="p-4 pt-0 flex gap-2">
          <button onClick={save} disabled={saving || !valid}
            className="tap-44 flex-1 h-11 rounded-lg bg-gold text-[14px] font-semibold hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save balance"}
          </button>
          <button onClick={onClose} className="tap-44 h-11 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ───────────────────────── Edit dialog ───────────────────────── */

/* ───────────────────────── Edit dialog ───────────────────────── */

const EditGiftCardDialog = ({ card, onClose, onSaved }: { card: GiftCardRow; onClose: () => void; onSaved: () => void }) => {
  const { user } = useAuth();
  const [brandName, setBrandName] = useState(card.brand_name);
  const [format, setFormat] = useState<BarcodeFormat>(resolveFormat(card));
  const [balance, setBalance] = useState(String(card.balance));
  const [cardNumber, setCardNumber] = useState(card.card_number ?? "");
  const [pin, setPin] = useState(card.pin ?? "");
  const [expiryDate, setExpiryDate] = useState(card.expiry_date ?? "");
  const [notes, setNotes] = useState(card.notes ?? "");
  const [verified, setVerified] = useState(card.balance_verified);
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [saving, setSaving] = useState(false);

  const last4 = cardNumber.replace(/\D/g, "").slice(-4);

  const save = async () => {
    if (!brandName.trim()) { toast.error("Issuer name can't be empty"); return; }
    setSaving(true);
    const prevBal = Number(card.balance);
    const newBal = Number(balance) || 0;
    const { error } = await writeCard({
      brand_name: brandName.trim(),
      barcode_format: format,
      balance: newBal,
      card_number: cardNumber.replace(/\s/g, "") || null,
      card_number_last4: last4 || null,
      pin: pin || null,
      expiry_date: expiryDate || null,
      notes: notes.trim() || null,
      balance_verified: verified,
      last_balance_update: new Date().toISOString(),
    }, p => db.from("gift_cards").update(p).eq("id", card.id));
    setSaving(false);
    if (error) { toast.error("Couldn't save changes", { description: error.message }); return; }
    if (user && newBal !== prevBal) {
      await logActivity({
        gift_card_id: card.id, user_id: user.id, kind: "adjustment",
        amount: newBal - prevBal, balance_after: newBal,
      });
    }
    toast.success("Gift card updated");
    onSaved();
    onClose();
  };

  const status = expiryStatus(expiryDate || null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Edit {card.brand_name}</DialogTitle>
        <DialogDescription className="sr-only">Edit balance and details for this gift card.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40 shrink-0">
          <button onClick={onClose} aria-label="Close" className="tap-44 absolute top-2 right-2 h-11 w-11 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3 pr-10">
            <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={brandName || card.brand_name} size={36} />
            <div className="font-display text-base text-foreground truncate">Edit {card.brand_name}</div>
          </div>
        </div>
        <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div>
            <label htmlFor="gc-edit-issuer" className="text-[12px] uppercase tracking-wider text-muted-foreground">Issuer</label>
            <input id="gc-edit-issuer" value={brandName} onChange={e => setBrandName(e.target.value)}
              className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-lg px-3 text-[14px] text-foreground outline-none focus:border-foreground/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="gc-edit-balance" className="text-[12px] uppercase tracking-wider text-muted-foreground">Balance</label>
              <input id="gc-edit-balance" inputMode="decimal" type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
                className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label htmlFor="gc-edit-expiry" className="text-[12px] uppercase tracking-wider text-muted-foreground">Expiry date</label>
              <input id="gc-edit-expiry" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>
          {status && (
            <div className={cn("flex items-center gap-1.5 text-[12.5px] -mt-2", status === "expired" ? "text-negative" : "text-warning")}>
              <Clock className="h-3 w-3" /> {status === "expired" ? "This card has expired" : `Expires in ${daysUntil(expiryDate)} days`}
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Card details</label>
            <button onClick={() => setRevealSensitive(v => !v)} aria-label={revealSensitive ? "Hide card number and PIN" : "Reveal card number and PIN"} className="tap-44 min-h-11 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              {revealSensitive ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Reveal</>}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 -mt-2">
            <div className="relative">
              <input type={revealSensitive ? "text" : "password"} value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Card number" aria-label="Card number" autoComplete="off"
                className="w-full h-11 bg-surface/40 border border-border/60 rounded-lg px-3 py-2 pr-9 text-[14px] text-foreground outline-none focus:border-foreground/40" />
              {cardNumber && (
                <button onClick={() => copyToClipboard(cardNumber.replace(/\s/g, ""), "Card number")} aria-label="Copy card number"
                  className="tap-44 absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <input type={revealSensitive ? "text" : "password"} value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN" aria-label="PIN" autoComplete="off"
                className="w-full h-11 bg-surface/40 border border-border/60 rounded-lg px-3 py-2 pr-9 text-[14px] text-foreground outline-none focus:border-foreground/40" />
              {pin && (
                <button onClick={() => copyToClipboard(pin, "PIN")} aria-label="Copy PIN"
                  className="tap-44 absolute right-0 top-1/2 -translate-y-1/2 h-11 w-11 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <BarcodeFormatPicker value={format} onChange={setFormat} number={cardNumber} brand={brandName || card.brand_name} />

          <div>
            <label htmlFor="gc-edit-notes" className="text-[12px] uppercase tracking-wider text-muted-foreground">Notes</label>
            <input id="gc-edit-notes" value={notes} onChange={e => setNotes(e.target.value)}
              className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
          </div>

          <label className="min-h-11 flex items-center gap-2 text-[13px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="rounded" />
            I just confirmed this balance on {card.brand_name}'s site
          </label>
          {card.buy_url && (
            <a href={card.buy_url} target="_blank" rel="noopener noreferrer"
              className="min-h-11 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
              <ShoppingBag className="h-3 w-3" /> Buy another {card.brand_name} gift card
            </a>
          )}
        </div>
        <div className="p-4 pt-0 flex gap-2 shrink-0">
          <button onClick={save} disabled={saving}
            className="tap-44 flex-1 h-11 rounded-lg bg-gold text-[14px] font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose} className="tap-44 h-11 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

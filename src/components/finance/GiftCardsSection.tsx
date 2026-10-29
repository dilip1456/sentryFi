import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GIFT_CARD_BRANDS, logoUrlForDomain, clearbitLogoUrl, faviconUrlForDomain, brandGradient, searchBrands, type GiftCardBrand, type BrandSuggestion } from "@/lib/gift-card-brands";
import { toast } from "sonner";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import {
  Gift, Plus, X, ExternalLink, ShoppingBag, Pencil, Trash2, Search,
  CheckCircle2, AlertCircle, Loader2, MinusCircle, Clock, Eye, EyeOff,
  ChevronLeft, ChevronRight, Copy,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { fmtShortDate } from "@/lib/format-date";

const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
};

type GiftCardRow = Tables<"gift_cards">;

// gift_card_activity isn't in the generated Supabase types yet (same reason
// gift_cards itself already resolves loosely — see the pre-existing `never`
// errors on GiftCardRow field access below), so this is a hand-written
// mirror of the table shape defined in
// supabase/migrations/20260925120000_gift_cards_trash_and_activity.sql.
type GiftCardActivityKind = "added" | "spend" | "adjustment" | "removed" | "restored";
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

/** Append-only usage-trail insert. Fire-and-forget on purpose — a logging
 *  failure shouldn't block or roll back the balance change that triggered it. */
const logActivity = async (entry: {
  gift_card_id: string; user_id: string; kind: GiftCardActivityKind;
  amount: number | null; balance_after: number; note?: string | null;
}) => {
  if (activityTableMissing) return;
  const { error } = await supabase.from("gift_card_activity").insert({
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

const ACTIVITY_LABEL: Record<GiftCardActivityKind, string> = {
  added: "Card added", spend: "Spent", adjustment: "Balance adjusted", removed: "Removed", restored: "Restored",
};

/** Compact usage trail shown inside the card detail popup and the desktop
 *  preview panel — renders nothing when there's no history yet. */
const ActivityHistoryList = ({ entries }: { entries: GiftCardActivityRow[] }) => {
  if (!entries.length) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-[12px] uppercase tracking-wider text-muted-foreground block">Activity</span>
      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
        {entries.map(e => (
          <div key={e.id} className="flex items-center justify-between gap-2 text-[12.5px]">
            <div className="min-w-0 truncate">
              <span className="text-foreground">{ACTIVITY_LABEL[e.kind]}</span>
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

const EXPIRY_WARNING_DAYS = 30;

// Illustrative cards shown only in demo/guest mode — this screen otherwise
// renders nothing at all for a signed-out visitor since every real card is
// fetched per-user from Supabase.
const DEMO_GIFT_CARDS: GiftCardRow[] = [
  { id: "demo-1", user_id: "demo", brand_name: "Domino's", domain: "dominos.com", logo_url: null, balance: 5.00, card_number: null, card_number_last4: null, pin: null, expiry_date: "2026-12-31", notes: null, balance_check_url: "https://www.dominos.com/en/pages/giftcards/", balance_verified: true, created_at: new Date().toISOString() } as GiftCardRow,
  { id: "demo-2", user_id: "demo", brand_name: "IKEA", domain: "ikea.com", logo_url: null, balance: 42.41, card_number: null, card_number_last4: "4210", pin: null, expiry_date: "2026-12-31", notes: null, balance_check_url: "https://www.ikea.com/us/en/customer-service/gift-card/", balance_verified: true, created_at: new Date().toISOString() } as GiftCardRow,
  { id: "demo-3", user_id: "demo", brand_name: "Panera Bread", domain: "panerabread.com", logo_url: null, balance: 34.67, card_number: null, card_number_last4: "4608", pin: null, expiry_date: "2026-12-31", notes: null, balance_check_url: "https://www.panerabread.com/en-us/giftcards.html", balance_verified: true, created_at: new Date().toISOString() } as GiftCardRow,
  { id: "demo-4", user_id: "demo", brand_name: "Best Buy", domain: "bestbuy.com", logo_url: null, balance: 80.22, card_number: null, card_number_last4: "5130", pin: null, expiry_date: "2026-12-31", notes: null, balance_check_url: "https://www.bestbuy.com/giftcard/online/balancecheck", balance_verified: true, created_at: new Date().toISOString() } as GiftCardRow,
  { id: "demo-5", user_id: "demo", brand_name: "REI", domain: "rei.com", logo_url: null, balance: 14.17, card_number: null, card_number_last4: "4853", pin: null, expiry_date: "2026-12-31", notes: null, balance_check_url: "https://www.rei.com/gift-cards", balance_verified: false, created_at: new Date().toISOString() } as GiftCardRow,
];

const daysUntil = (dateStr: string): number =>
  Math.ceil((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86_400_000);

/** "1 Year, 5 Months, 2 Days" style countdown for the card preview panel. */
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

const expiryStatus = (expiry?: string | null): "expired" | "soon" | null => {
  if (!expiry) return null;
  const d = daysUntil(expiry);
  if (d < 0) return "expired";
  if (d <= EXPIRY_WARNING_DAYS) return "soon";
  return null;
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
  if (!src) {
    return (
      <div
        className="rounded-lg bg-secondary/60 border border-border/50 grid place-items-center text-gold font-display shrink-0"
        style={{ height: size, width: size, fontSize: size * 0.4 }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`${name} logo`}
      onError={() => setAttempt(a => a + 1)}
      className="rounded-lg border border-border/50 object-contain bg-white shrink-0 p-[10%]"
      style={{ height: size, width: size, imageRendering: "auto" }}
    />
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
              {status === "expired" ? "Expired" : `Expires in ${daysUntil(card.expiry_date!)}d`}
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

/** Click-to-view popup for a card — read-only quick view with shortcuts into edit/spend/remove.
 *  Supports swiping left/right to browse other cards without closing the popup. */
const CardDetailDialog = ({
  cards, index, onIndexChange, onClose, onEdit, onLogSpend, onRemove, removingId, activityByCard,
}: {
  cards: GiftCardRow[]; index: number; onIndexChange: (i: number) => void;
  onClose: () => void; onEdit: (card: GiftCardRow) => void; onLogSpend: (card: GiftCardRow) => void;
  onRemove: (card: GiftCardRow) => void; removingId: string | null;
  activityByCard: Record<string, GiftCardActivityRow[]>;
}) => {
  const [reveal, setReveal] = useState(false);
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const widthRef = useRef(1);

  const card = cards[index];
  if (!card) return null;
  const status = expiryStatus(card.expiry_date);

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
    if (dragX < -threshold && index < cards.length - 1) { onIndexChange(index + 1); setReveal(false); }
    else if (dragX > threshold && index > 0) { onIndexChange(index - 1); setReveal(false); }
    setDragX(0);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[90dvh] flex flex-col">
        <DialogTitle className="sr-only">{card.brand_name} details</DialogTitle>
        <DialogDescription className="sr-only">Full details for this gift card.</DialogDescription>

        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-white/80 hover:text-white hover:bg-black/20 transition-colors z-10">
          <X className="h-4 w-4" />
        </button>
        {cards.length > 1 && (
          <>
            <button onClick={() => { if (index > 0) { onIndexChange(index - 1); setReveal(false); } }} disabled={index === 0}
              aria-label="Previous card"
              className="absolute left-2 top-[4.5rem] -translate-y-1/2 h-7 w-7 grid place-items-center rounded-full bg-black/25 text-white disabled:opacity-30 transition-colors z-10">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => { if (index < cards.length - 1) { onIndexChange(index + 1); setReveal(false); } }} disabled={index === cards.length - 1}
              aria-label="Next card"
              className="absolute right-2 top-[4.5rem] -translate-y-1/2 h-7 w-7 grid place-items-center rounded-full bg-black/25 text-white disabled:opacity-30 transition-colors z-10">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Swipeable card visual - fixed height container prevents resize */}
        <div className="shrink-0 overflow-hidden" style={{ touchAction: "none" }}>
          <div className="p-4 select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
            style={{
              transform: `translateX(${dragX}px)`,
              transition: draggingRef.current ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)",
              cursor: cards.length > 1 ? "grab" : "default",
            }}>
            <GiftCardTile card={card} />
          </div>
        </div>
        {cards.length > 1 && (
          <div className="text-center text-[12px] text-muted-foreground pb-1 shrink-0">{index + 1} of {cards.length}</div>
        )}

        <div className="px-5 pb-5 space-y-4">
          {status && (
            <div className={cn("flex items-center gap-1.5 text-[13px]", status === "expired" ? "text-negative" : "text-warning")}>
              <Clock className="h-3.5 w-3.5" /> {status === "expired" ? "This card has expired" : `Expires in ${daysUntil(card.expiry_date!)} days`}
            </div>
          )}

          <div className="flex items-center gap-2 text-[13px]">
            {card.balance_verified ? (
              <span className="inline-flex items-center gap-1 text-positive"><CheckCircle2 className="h-3.5 w-3.5" /> Verified on vendor site</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5" /> Estimated · updated {fmtShortDate(card.last_balance_update)}
              </span>
            )}
          </div>

          {(card.card_number || card.card_number_last4 || card.pin) && (
            <div className="surface-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] uppercase tracking-wider text-muted-foreground">Card details</span>
                <button onClick={() => setReveal(v => !v)} aria-label={reveal ? "Hide card number and PIN" : "Reveal card number and PIN"} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                  {reveal ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Reveal</>}
                </button>
              </div>
              {(card.card_number || card.card_number_last4) && (
                <div className="flex items-center justify-between text-[14px]">
                  <span className="text-muted-foreground">Number</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tracking-wider text-foreground">
                      {reveal ? (card.card_number ?? `•••• ${card.card_number_last4}`) : `•••• ${card.card_number_last4 ?? "????"}`}
                    </span>
                    {card.card_number && (
                      <button onClick={() => copyToClipboard(card.card_number!, "Card number")} aria-label="Copy card number" className="h-9 w-9 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {card.pin && (
                <div className="flex items-center justify-between text-[14px]">
                  <span className="text-muted-foreground">PIN</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tracking-wider text-foreground">{reveal ? card.pin : "••••"}</span>
                    <button onClick={() => copyToClipboard(card.pin!, "PIN")} aria-label="Copy PIN" className="h-9 w-9 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {card.notes && (
            <div className="text-[13px] text-muted-foreground">
              <span className="text-[12px] uppercase tracking-wider block mb-1">Notes</span>
              {card.notes}
            </div>
          )}

          <ActivityHistoryList entries={activityByCard[card.id] ?? []} />

          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => onLogSpend(card)} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-border-strong text-[13px] text-muted-foreground hover:text-foreground transition-colors">
              <MinusCircle className="h-3.5 w-3.5" /> Log spend
            </button>
            <button onClick={() => onEdit(card)} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-border-strong text-[13px] text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            {card.balance_check_url && (
              <a href={card.balance_check_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-secondary/60 text-[13px] text-foreground hover:bg-secondary transition-colors">
                <ExternalLink className="h-3.5 w-3.5" /> Check balance
              </a>
            )}
            {card.buy_url && (
              <a href={card.buy_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-secondary/60 text-[13px] text-foreground hover:bg-secondary transition-colors">
                <ShoppingBag className="h-3.5 w-3.5" /> Buy more
              </a>
            )}
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button disabled={removingId === card.id}
                className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-[13px] text-negative hover:bg-negative/10 transition-colors disabled:opacity-50">
                {removingId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remove card
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove this gift card?</AlertDialogTitle>
                <AlertDialogDescription>
                  This moves {card.brand_name}'s {fmtUSD(Number(card.balance))} balance
                  {(card.card_number || card.card_number_last4 || card.pin) ? " and stored card number/PIN" : ""} to Removed cards. You can restore it anytime from there.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRemove(card)} className="bg-negative text-negative-foreground hover:bg-negative/90">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const GiftCardsSection = ({ demo = false }: { demo?: boolean }) => {
  const { user } = useAuth();
  const [cards, setCards] = useState<GiftCardRow[] | null>(null);
  const [trashCards, setTrashCards] = useState<GiftCardRow[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // True when the live DB predates the soft-delete migration (no deleted_at
  // column): cards still load, but remove/restore are unavailable.
  const [legacySchema, setLegacySchema] = useState(false);
  const [activity, setActivity] = useState<Record<string, GiftCardActivityRow[]>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [spendCard, setSpendCard] = useState<GiftCardRow | null>(null);
  const [editCard, setEditCard] = useState<GiftCardRow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);

  // Guest/demo mode never has a real user, so gift_cards can't be queried —
  // show illustrative sample cards instead and block every mutation with an
  // explanatory toast rather than silently failing against Supabase.
  const demoBlocked = () => toast("Create a free account to manage your gift cards", { description: "This is sample data in demo mode." });

  const load = useCallback(async () => {
    if (demo) { setCards(DEMO_GIFT_CARDS); setTrashCards([]); setActivity({}); setLoadError(null); return; }
    if (!user) return;
    try {
      const [{ data, error }, { data: trashData, error: trashError }, { data: activityData, error: activityError }] = await Promise.all([
        supabase.from("gift_cards").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
        supabase.from("gift_cards").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
        activityTableMissing
          ? Promise.resolve({ data: [], error: null })
          : supabase.from("gift_card_activity").select("*").order("created_at", { ascending: false }),
      ]);

      if (error && isMissingColumnError(error, "deleted_at")) {
        // DB is missing the soft-delete migration — show every card rather
        // than failing the whole page.
        const legacy = await supabase.from("gift_cards").select("*").order("created_at", { ascending: false });
        if (legacy.error) throw new Error(legacy.error.message);
        console.warn("[gift_cards] deleted_at column missing — apply supabase/migrations/20261020120000_repair_gift_cards_trash_and_activity.sql");
        setLegacySchema(true);
        setCards((legacy.data ?? []) as unknown as GiftCardRow[]);
        setTrashCards([]);
      } else if (error) {
        throw new Error(error.message);
      } else {
        setLegacySchema(false);
        setCards(data ?? []);
        if (trashError) console.error("[gift_cards] removed-cards load failed:", trashError.message);
        else setTrashCards(trashData ?? []);
      }
      setLoadError(null);

      if (activityError) {
        if (isMissingTableError(activityError)) activityTableMissing = true;
        console.error("[gift_card_activity] load failed:", activityError.message);
        setActivity({});
      } else {
        const grouped: Record<string, GiftCardActivityRow[]> = {};
        for (const row of (activityData ?? []) as unknown as GiftCardActivityRow[]) {
          (grouped[row.gift_card_id] ??= []).push(row);
        }
        setActivity(grouped);
      }
    } catch (e) {
      // Previously a failed query returned early with `cards` still null,
      // which rendered the spinner forever. Now an error panel with a retry
      // replaces the spinner whenever loadError is set and no cards loaded.
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [user, demo]);

  useEffect(() => { load(); }, [load]);

  const totalBalance = useMemo(() => (cards ?? []).reduce((s, c) => s + Number(c.balance), 0), [cards]);
  const expiringSoon = useMemo(
    () => (cards ?? []).filter(c => expiryStatus(c.expiry_date) === "soon"),
    [cards]
  );
  const expired = useMemo(
    () => (cards ?? []).filter(c => expiryStatus(c.expiry_date) === "expired"),
    [cards]
  );

  // Table view sorted by soonest-expiring first; cards with no expiry date sort last.
  // Keeps the original index so goTo()/detail popup still reference the right card.
  const sortedForTable = useMemo(() => {
    if (!cards) return [];
    return cards
      .map((card, originalIndex) => ({ card, originalIndex }))
      .sort((a, b) => {
        const ea = a.card.expiry_date, eb = b.card.expiry_date;
        if (!ea && !eb) return 0;
        if (!ea) return 1;
        if (!eb) return -1;
        return new Date(ea).getTime() - new Date(eb).getTime();
      });
  }, [cards]);

  useEffect(() => {
    if (!cards) return;
    setActiveIndex(i => Math.min(i, Math.max(0, cards.length - 1)));
  }, [cards]);

  const removeCard = async (id: string) => {
    if (demo) { demoBlocked(); return; }
    if (legacySchema) {
      toast.error("Removing cards isn't available yet", { description: "The gift card database update hasn't been applied. Your cards are safe." });
      return;
    }
    const card = (cards ?? []).find(c => c.id === id);
    setRemovingId(id);
    const { error } = await supabase.from("gift_cards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    setRemovingId(null);
    if (error) { toast.error("Couldn't remove card", { description: error.message }); return; }
    if (user && card) {
      await logActivity({ gift_card_id: id, user_id: user.id, kind: "removed", amount: null, balance_after: Number(card.balance) });
    }
    toast.success("Gift card removed", { description: "Restore it anytime from Removed cards below." });
    load();
  };

  const restoreCard = async (id: string) => {
    if (demo) { demoBlocked(); return; }
    const card = trashCards.find(c => c.id === id);
    setRestoringId(id);
    const { error } = await supabase.from("gift_cards")
      .update({ deleted_at: null })
      .eq("id", id);
    setRestoringId(null);
    if (error) { toast.error("Couldn't restore card", { description: error.message }); return; }
    if (user && card) {
      await logActivity({ gift_card_id: id, user_id: user.id, kind: "restored", amount: null, balance_after: Number(card.balance) });
    }
    toast.success("Gift card restored");
    load();
  };

  const goTo = (i: number) => { if (!cards) return; setActiveIndex(Math.max(0, Math.min(cards.length - 1, i))); };

  const openAdd = () => { if (demo) { demoBlocked(); return; } setAddOpen(true); };
  const openEdit = (c: GiftCardRow) => { if (demo) { demoBlocked(); return; } setEditCard(c); };
  const openSpend = (c: GiftCardRow) => { if (demo) { demoBlocked(); return; } setSpendCard(c); };

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
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
    if (dragX < -50) goTo(activeIndex + 1);
    else if (dragX > 50) goTo(activeIndex - 1);
    setDragX(0);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="font-display text-base md:text-lg text-primary">Gift cards</h2>
          {cards && cards.length > 0 && (
            <div className="text-[13px] text-muted-foreground mt-0.5">
              {cards.length} card{cards.length !== 1 ? "s" : ""} · {fmtUSD(totalBalance)} total balance
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Cards/Table toggle only matters on mobile — desktop always shows
              the table + detail-panel layout below, so the toggle is noise there. */}
          {cards && cards.length > 0 && (
            <div className="md:hidden inline-flex p-0.5 rounded-md bg-secondary/60 border border-border/40">
              <button onClick={() => setViewMode("cards")}
                className={cn("px-2.5 h-7 rounded-[5px] text-[13px] font-medium transition-colors", viewMode === "cards" ? "bg-surface-elevated text-foreground shadow-sm" : "text-muted-foreground")}>
                Cards
              </button>
              <button onClick={() => setViewMode("table")}
                className={cn("px-2.5 h-7 rounded-[5px] text-[13px] font-medium transition-colors", viewMode === "table" ? "bg-surface-elevated text-foreground shadow-sm" : "text-muted-foreground")}>
                Table
              </button>
            </div>
          )}
          <button
            onClick={openAdd}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-full bg-gold text-[13px] font-semibold hover:opacity-90 transition-opacity shrink-0"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" /> <span>Add</span>
          </button>
        </div>
      </div>

      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-[13px] text-foreground">
            {expired.length > 0 && (
              <div><span className="font-medium">{expired.length} card{expired.length !== 1 ? "s" : ""} expired:</span> {expired.map(c => c.brand_name).join(", ")}</div>
            )}
            {expiringSoon.length > 0 && (
              <div className={expired.length > 0 ? "mt-1" : ""}>
                <span className="font-medium">{expiringSoon.length} card{expiringSoon.length !== 1 ? "s" : ""} expiring within {EXPIRY_WARNING_DAYS} days:</span>{" "}
                {expiringSoon.map(c => `${c.brand_name} (${daysUntil(c.expiry_date!)}d)`).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {loadError && (
        <div className="surface-card p-6 text-center">
          <AlertCircle className="h-6 w-6 mx-auto text-negative/70 mb-2" />
          <div className="text-[14px] text-foreground font-medium">Couldn't load your gift cards</div>
          <div className="text-[12.5px] text-muted-foreground mt-1 break-words">{loadError}</div>
          <button
            onClick={() => { setCards(null); setLoadError(null); load(); }}
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-4 rounded-md border border-border-strong text-[13px] font-medium hover:bg-secondary/40 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {loadError && (cards ?? []).length === 0 ? null : cards === null ? (
        <div className="surface-card p-8 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : cards.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <Gift className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <div className="text-[14px] text-foreground font-medium">No gift cards yet</div>
          <div className="text-[13px] text-muted-foreground mt-1">Track balances for Amazon, Starbucks, Target, and 25+ other brands, or add any custom one.</div>
          <button
            onClick={openAdd}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-gold text-[13.5px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" /> Add your first gift card
          </button>
        </div>
      ) : (
        <div className="overflow-x-hidden space-y-3">
          {/* ── Desktop: side-by-side table + active card preview. Table gets
              all remaining width; the detail panel is a fixed 360px so the
              table doesn't leave a dead gap on wide screens. ── */}
          <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
            {/* Table */}
            <div className="surface-card overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-3.5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Card</th>
                    <th className="px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Card number</th>
                    <th className="px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Expiration</th>
                    <th className="px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/15">
                  {sortedForTable.map(({ card, originalIndex: i }) => {
                    const status = expiryStatus(card.expiry_date);
                    const isActive = i === activeIndex;
                    const statusLabel = status === "expired" ? "Expired" : status === "soon" ? "Expiring soon" : "Active";
                    const statusClasses = status === "expired" ? "bg-negative/10 text-negative"
                      : status === "soon" ? "bg-warning/10 text-warning" : "bg-positive/10 text-positive";
                    return (
                      <tr key={card.id}
                        onClick={() => { goTo(i); setDetailIndex(i); }}
                        className={cn("cursor-pointer transition-colors", isActive ? "bg-[hsl(var(--primary)/0.07)]" : "hover:bg-surface-hover/30")}>
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2.5">
                            {isActive && <div className="w-1 h-8 rounded-full bg-[hsl(var(--primary))] shrink-0 -ml-1" />}
                            <MiniCardThumb card={card} />
                            <div className="min-w-0 text-[13.5px] font-medium text-foreground truncate">{card.brand_name}</div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-[12.5px] text-muted-foreground tabular whitespace-nowrap">
                          {card.card_number_last4 ? `•••• ${card.card_number_last4}` : "-"}
                        </td>
                        <td className="px-3 py-3 text-[12.5px] text-muted-foreground whitespace-nowrap">
                          {card.expiry_date ? new Date(card.expiry_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "-"}
                        </td>
                        <td className="px-3 py-3">
                          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap", statusClasses)}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <span className={cn("text-[14px] tabular font-semibold", Number(card.balance) === 0 ? "text-muted-foreground" : "text-foreground")}>
                            {fmtUSD(Number(card.balance))}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Card preview panel — shows selected card details inline */}
            <div className="space-y-3">
              {cards[activeIndex] && (() => {
                const card = cards[activeIndex];
                const status = expiryStatus(card.expiry_date);
                return (
                  <div className="space-y-3">
                    {/* Primary actions toolbar — replaces the old floating
                        corner icons with a proper, discoverable action row */}
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openEdit(card)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-border-strong text-[12px] font-medium text-foreground hover:bg-secondary/40 transition-colors">
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      {card.balance_check_url && (
                        <a href={card.balance_check_url} target="_blank" rel="noopener noreferrer"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-border-strong text-[12px] font-medium text-foreground hover:bg-secondary/40 transition-colors">
                          <ExternalLink className="h-3.5 w-3.5" /> Check balance
                        </a>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button disabled={removingId === card.id}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-negative/30 text-[12px] font-medium text-negative hover:bg-negative/10 transition-colors disabled:opacity-50">
                            {removingId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove this gift card?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This moves {card.brand_name}'s {fmtUSD(Number(card.balance))} balance
                              {(card.card_number || card.card_number_last4 || card.pin) ? " and stored card number/PIN" : ""} to Removed cards. You can restore it anytime from there.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => removeCard(card.id)} className="bg-negative text-negative-foreground hover:bg-negative/90">
                              Remove
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    {/* Card graphic — scaled down so it doesn't dominate the panel */}
                    <div className="max-w-[260px] mx-auto">
                      <GiftCardTile card={card} />
                    </div>

                    <div className="surface-card p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[15px] font-semibold text-foreground truncate">
                          {card.brand_name}{card.card_number_last4 ? ` •••• ${card.card_number_last4}` : ""}
                        </div>
                        {card.balance_verified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-positive shrink-0"><CheckCircle2 className="h-3 w-3" /> Verified</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0"><AlertCircle className="h-3 w-3" /> Estimated</span>
                        )}
                      </div>
                      {(card.card_number_last4 || card.pin || card.expiry_date || card.notes) && (
                        <div className="space-y-2 text-[14px]">
                          {card.expiry_date && (
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Expires in</span>
                              <span className={cn("tabular text-[13px] font-medium", status === "expired" ? "text-negative" : status === "soon" ? "text-warning" : "text-foreground")}>
                                {humanizeCountdown(card.expiry_date)}
                              </span>
                            </div>
                          )}
                          {card.card_number_last4 && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Card number</span>
                              <div className="flex items-center gap-1.5">
                                <span className="tabular">···· {card.card_number_last4}</span>
                                {card.card_number && <button onClick={() => copyToClipboard(card.card_number!, "Card number")} aria-label="Copy card number" className="h-9 w-9 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground"><Copy className="h-4 w-4" /></button>}
                              </div>
                            </div>
                          )}
                          {card.pin && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">PIN</span>
                              <div className="flex items-center gap-1.5">
                                <span className="tabular">{card.pin}</span>
                                <button onClick={() => copyToClipboard(card.pin!, "PIN")} aria-label="Copy PIN" className="h-9 w-9 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground"><Copy className="h-4 w-4" /></button>
                              </div>
                            </div>
                          )}
                          {card.notes && <p className="text-muted-foreground text-[13px]">{card.notes}</p>}
                        </div>
                      )}
                      <ActivityHistoryList entries={activity[card.id] ?? []} />
                      <button onClick={() => openSpend(card)}
                        className="w-full h-10 rounded-lg bg-gold text-[13.5px] font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity">
                        <MinusCircle className="h-3.5 w-3.5" /> Log Spend
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Mobile: viewMode controls cards grid vs table list ── */}
          <div className="md:hidden">
            {viewMode === "cards" ? (
              /* Cards grid — 2 columns of visual cards */
              <div className="grid grid-cols-2 gap-3">
                {sortedForTable.map(({ card, originalIndex: i }) => {
                  const status = expiryStatus(card.expiry_date);
                  const bal = Number(card.balance);
                  return (
                    <button key={card.id} onClick={() => { goTo(i); setDetailIndex(i); }}
                      className="text-left space-y-2">
                      <GiftCardTile card={card} />
                      <div className="px-1">
                        <div className="font-display text-[13px] text-foreground truncate">{card.brand_name}</div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className={cn("text-[13px] tabular font-medium", bal === 0 ? "text-muted-foreground" : "text-foreground")}>{fmtUSD(bal)}</span>
                          {status && <span className={cn("text-[10px] font-semibold", status === "expired" ? "text-negative" : "text-warning")}>{status === "expired" ? "Expired" : `${daysUntil(card.expiry_date!)}d`}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Table list — compact rows */
              <div className="surface-card overflow-hidden">
                <div className="divide-y divide-border/15">
                  {sortedForTable.map(({ card, originalIndex: i }) => {
                    const status = expiryStatus(card.expiry_date);
                    const bal = Number(card.balance);
                    return (
                      <button key={card.id}
                        onClick={() => { goTo(i); setDetailIndex(i); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover/30 transition-colors active:bg-surface-hover/50">
                        <MiniCardThumb card={card} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-medium text-foreground truncate">{card.brand_name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {status && (
                              <span className={cn("text-[12px] font-medium shrink-0", status === "expired" ? "text-negative" : "text-warning")}>
                                {status === "expired" ? "Expired" : `${daysUntil(card.expiry_date!)}d left`}
                              </span>
                            )}
                            {card.card_number_last4 && <span className="text-[12px] text-muted-foreground">···· {card.card_number_last4}</span>}
                          </div>
                        </div>
                        <div className={cn("text-[15px] tabular font-semibold shrink-0", bal === 0 ? "text-muted-foreground" : "text-foreground")}>{fmtUSD(bal)}</div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {trashCards.length > 0 && (
        <div className="surface-card overflow-hidden">
          <button onClick={() => setTrashOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="text-[13px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Removed cards ({trashCards.length})
            </span>
            <ChevronRight className={cn("h-4 w-4 text-muted-foreground/50 transition-transform", trashOpen && "rotate-90")} />
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
                  <button onClick={() => restoreCard(card.id)} disabled={restoringId === card.id}
                    className="h-8 px-3 rounded-md border border-border-strong text-[12.5px] font-medium text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-50 shrink-0 inline-flex items-center gap-1.5">
                    {restoringId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Restore"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AddGiftCardDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
      {spendCard && <LogSpendDialog card={spendCard} onClose={() => setSpendCard(null)} onSaved={load} onRemoveCard={() => removeCard(spendCard.id)} />}
      {editCard && <EditGiftCardDialog card={editCard} onClose={() => setEditCard(null)} onSaved={load} onRemoveCard={() => removeCard(editCard.id)} />}
      {detailIndex !== null && cards && cards[detailIndex] && (
        <CardDetailDialog
          cards={cards}
          index={detailIndex}
          onIndexChange={(i) => { setDetailIndex(i); goTo(i); }}
          onClose={() => setDetailIndex(null)}
          onEdit={(c) => { openEdit(c); setDetailIndex(null); }}
          onLogSpend={(c) => { openSpend(c); setDetailIndex(null); }}
          onRemove={(c) => { removeCard(c.id); setDetailIndex(null); }}
          removingId={removingId}
          activityByCard={activity}
        />
      )}
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
  const [saving, setSaving] = useState(false);

  const last4 = cardNumber.replace(/\D/g, "").slice(-4);

  const reset = () => {
    setStep("pick"); setSearch(""); setLookupResults([]); setChosen(null);
    setBalance(""); setCardNumber(""); setPin(""); setExpiryDate(""); setNotes("");
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
    const { data: inserted, error } = await supabase.from("gift_cards").insert({
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
    }).select().single();
    setSaving(false);
    if (error) { toast.error("Couldn't add gift card", { description: error.message }); return; }
    if (inserted) {
      await logActivity({ gift_card_id: (inserted as { id: string }).id, user_id: user.id, kind: "added", amount: null, balance_after: bal });
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
              className="h-8 w-8 grid place-items-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0 no-min-h">
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
          <button onClick={() => onOpenChange(false)} aria-label="Close" className="ml-auto h-8 w-8 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0 no-min-h">
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
                  placeholder="Search brands or any company…"
                  className="w-full h-11 pl-10 pr-10 rounded-xl bg-surface/60 border border-border/60 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors"
                />
                {search && (
                  <button onClick={() => { setSearch(""); setLookupResults([]); }} aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 grid place-items-center text-muted-foreground hover:text-foreground no-min-h">
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
                <label className="text-[13px] font-medium text-foreground">Current balance *</label>
                <div className="relative mt-1.5">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[15px]">$</span>
                  <input
                    type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
                    placeholder="0.00" autoFocus
                    className="w-full h-12 pl-7 pr-3 bg-surface/40 border border-border/60 rounded-xl text-[16px] text-foreground outline-none focus:border-primary/50 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-medium text-foreground">Card number</label>
                  <input value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Optional"
                    className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div>
                  <label className="text-[13px] font-medium text-foreground">PIN</label>
                  <input value={pin} onChange={e => setPin(e.target.value)} placeholder="Optional"
                    className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
              </div>

              <div>
                <label className="text-[13px] font-medium text-foreground">Expiry date</label>
                <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                  className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>

              <div>
                <label className="text-[13px] font-medium text-foreground">Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Birthday gift from mom"
                  className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[15px] text-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>
            </div>

            <div className="p-4 border-t border-border/40 shrink-0">
              <button onClick={save} disabled={balance === "" || saving}
                className="w-full h-12 rounded-xl bg-gold text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2">
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Plus className="h-4 w-4" /> Add {chosen?.name ?? "gift card"}</>}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ───────────────────────── Log spend dialog ───────────────────────── */

const LogSpendDialog = ({ card, onClose, onSaved, onRemoveCard }: { card: GiftCardRow; onClose: () => void; onSaved: () => void; onRemoveCard: () => void }) => {
  const { user } = useAuth();
  const [spent, setSpent] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const newBalance = Math.max(0, Number(card.balance) - (Number(spent) || 0));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("gift_cards").update({
      balance: newBalance,
      last_balance_update: new Date().toISOString(),
      balance_verified: false,
    }).eq("id", card.id);
    setSaving(false);
    if (error) { toast.error("Couldn't update balance", { description: error.message }); return; }
    if (user) {
      await logActivity({
        gift_card_id: card.id, user_id: user.id, kind: "spend",
        amount: Number(spent) || 0, balance_after: newBalance, note: note.trim() || null,
      });
    }
    toast.success("Balance updated");
    onSaved();
    // Balance just hit zero — offer to remove the (now-empty) card instead of
    // silently closing, rather than making the user notice and act later.
    if (newBalance === 0 && Number(card.balance) > 0) { setConfirmRemove(true); return; }
    onClose();
  };

  if (confirmRemove) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-sm surface-elevated border-border p-5 gap-4">
          <DialogTitle className="font-display text-base text-foreground">{card.brand_name} is now empty</DialogTitle>
          <DialogDescription className="text-[13.5px] text-muted-foreground">
            This card's balance just hit $0. Remove it? You can still restore it later from Removed cards.
          </DialogDescription>
          <div className="flex gap-2">
            <button onClick={() => { onRemoveCard(); onClose(); }}
              className="flex-1 h-10 rounded-lg bg-negative text-negative-foreground text-[14px] font-medium hover:bg-negative/90 transition-colors">
              Remove card
            </button>
            <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground transition-colors">
              Keep it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Log spend on {card.brand_name}</DialogTitle>
        <DialogDescription className="sr-only">Record how much you spent to update the tracked balance.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40">
          <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={36} />
            <div>
              <div className="font-display text-base text-foreground">{card.brand_name}</div>
              <div className="text-[12.5px] text-muted-foreground">Current balance: {fmtUSD(Number(card.balance))}</div>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">How much did you spend?</label>
            <input type="number" step="0.01" autoFocus value={spent} onChange={e => setSpent(e.target.value)} placeholder="0.00"
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
          </div>
          {spent !== "" && (
            <div className="text-[13px] text-muted-foreground">New balance: <span className="text-foreground font-medium tabular">{fmtUSD(newBalance)}</span></div>
          )}
          <div>
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">What was it for? (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Coffee run"
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
          </div>
        </div>
        <div className="p-4 pt-0 flex gap-2">
          <button onClick={save} disabled={saving || spent === ""}
            className="flex-1 h-10 rounded-lg bg-gold text-[14px] font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Update balance"}
          </button>
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ───────────────────────── Edit dialog ───────────────────────── */

const EditGiftCardDialog = ({ card, onClose, onSaved, onRemoveCard }: { card: GiftCardRow; onClose: () => void; onSaved: () => void; onRemoveCard: () => void }) => {
  const { user } = useAuth();
  const [balance, setBalance] = useState(String(card.balance));
  const [cardNumber, setCardNumber] = useState(card.card_number ?? "");
  const [pin, setPin] = useState(card.pin ?? "");
  const [expiryDate, setExpiryDate] = useState(card.expiry_date ?? "");
  const [notes, setNotes] = useState(card.notes ?? "");
  const [verified, setVerified] = useState(card.balance_verified);
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const last4 = cardNumber.replace(/\D/g, "").slice(-4);

  const save = async () => {
    setSaving(true);
    const prevBal = Number(card.balance);
    const newBal = Number(balance) || 0;
    const { error } = await supabase.from("gift_cards").update({
      balance: newBal,
      card_number: cardNumber.replace(/\s/g, "") || null,
      card_number_last4: last4 || null,
      pin: pin || null,
      expiry_date: expiryDate || null,
      notes: notes.trim() || null,
      balance_verified: verified,
      last_balance_update: new Date().toISOString(),
    }).eq("id", card.id);
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
    if (newBal === 0 && prevBal !== 0) { setConfirmRemove(true); return; }
    onClose();
  };

  if (confirmRemove) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-sm surface-elevated border-border p-5 gap-4">
          <DialogTitle className="font-display text-base text-foreground">{card.brand_name} is now empty</DialogTitle>
          <DialogDescription className="text-[13.5px] text-muted-foreground">
            This card's balance is now $0. Remove it? You can still restore it later from Removed cards.
          </DialogDescription>
          <div className="flex gap-2">
            <button onClick={() => { onRemoveCard(); onClose(); }}
              className="flex-1 h-10 rounded-lg bg-negative text-negative-foreground text-[14px] font-medium hover:bg-negative/90 transition-colors">
              Remove card
            </button>
            <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground transition-colors">
              Keep it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const status = expiryStatus(expiryDate || null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showClose={false} className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Edit {card.brand_name}</DialogTitle>
        <DialogDescription className="sr-only">Edit balance and details for this gift card.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40 shrink-0">
          <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={36} />
            <div className="font-display text-base text-foreground">{card.brand_name}</div>
          </div>
        </div>
        <div className="p-5 space-y-4 flex-1 overflow-y-auto min-h-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Balance</label>
              <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Expiry date</label>
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>
          {status && (
            <div className={cn("flex items-center gap-1.5 text-[12.5px] -mt-2", status === "expired" ? "text-negative" : "text-warning")}>
              <Clock className="h-3 w-3" /> {status === "expired" ? "This card has expired" : `Expires in ${daysUntil(expiryDate)} days`}
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Card details</label>
            <button onClick={() => setRevealSensitive(v => !v)} aria-label={revealSensitive ? "Hide card number and PIN" : "Reveal card number and PIN"} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              {revealSensitive ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Reveal</>}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 -mt-2">
            <div className="relative">
              <input type={revealSensitive ? "text" : "password"} value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Card number"
                className="w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 pr-9 text-[14px] text-foreground outline-none focus:border-foreground/40" />
              {cardNumber && (
                <button onClick={() => copyToClipboard(cardNumber.replace(/\s/g, ""), "Card number")} aria-label="Copy card number"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <input type={revealSensitive ? "text" : "password"} value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN"
                className="w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 pr-9 text-[14px] text-foreground outline-none focus:border-foreground/40" />
              {pin && (
                <button onClick={() => copyToClipboard(pin, "PIN")} aria-label="Copy PIN"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-[12px] uppercase tracking-wider text-muted-foreground">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40" />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="rounded" />
            I just confirmed this balance on {card.brand_name}'s site
          </label>
          {card.buy_url && (
            <a href={card.buy_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground transition-colors">
              <ShoppingBag className="h-3 w-3" /> Buy another {card.brand_name} gift card
            </a>
          )}
        </div>
        <div className="p-4 pt-0 flex gap-2 shrink-0">
          <button onClick={save} disabled={saving}
            className="flex-1 h-10 rounded-lg bg-gold text-[14px] font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border-strong text-[13px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

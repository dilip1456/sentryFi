import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GIFT_CARD_BRANDS, logoUrlForDomain, faviconUrlForDomain, brandGradient, searchBrands, type GiftCardBrand, type BrandSuggestion } from "@/lib/gift-card-brands";
import { toast } from "sonner";
import {
  Gift, Plus, X, ExternalLink, ShoppingBag, Pencil, Trash2, Search,
  CheckCircle2, AlertCircle, Loader2, MinusCircle, Clock, Eye, EyeOff,
  ChevronLeft, ChevronRight, Copy,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Couldn't copy ${label.toLowerCase()}`);
  }
};

type GiftCardRow = Tables<"gift_cards">;

const EXPIRY_WARNING_DAYS = 30;

const daysUntil = (dateStr: string): number =>
  Math.ceil((new Date(dateStr + "T00:00:00").getTime() - Date.now()) / 86_400_000);

const expiryStatus = (expiry?: string | null): "expired" | "soon" | null => {
  if (!expiry) return null;
  const d = daysUntil(expiry);
  if (d < 0) return "expired";
  if (d <= EXPIRY_WARNING_DAYS) return "soon";
  return null;
};

const BrandLogo = ({ domain, logoUrl, name, size = 40 }: { domain?: string | null; logoUrl?: string | null; name: string; size?: number }) => {
  const [attempt, setAttempt] = useState(0);
  const sources = [
    logoUrl,
    domain ? logoUrlForDomain(domain) : null,
    domain ? faviconUrlForDomain(domain) : null,
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
      style={{ height: size, width: size }}
    />
  );
};

/** Large, faded brand mark used as a background watermark on the big card tile — falls back to a soft monogram if no image resolves. */
const BrandWatermark = ({ domain, logoUrl, name }: { domain?: string | null; logoUrl?: string | null; name: string }) => {
  const [attempt, setAttempt] = useState(0);
  const sources = [
    logoUrl,
    domain ? logoUrlForDomain(domain) : null,
    domain ? faviconUrlForDomain(domain) : null,
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
      className="relative rounded-2xl p-4 overflow-hidden flex flex-col justify-between aspect-[1.6/1] shadow-[var(--shadow-card)]"
      style={{ background: brandGradient(card.brand_name) }}
    >
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 85% 15%, white, transparent 60%)" }} />
      {/* Large faded brand watermark — makes the card visually identifiable at a glance, like a real branded gift card */}
      <BrandWatermark domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} />
      {/* Subtle magstripe-style accent near the top, evoking a physical card */}
      <div className="absolute left-0 right-0 top-[3.1rem] h-2 bg-black/15" />
      <div className="relative flex items-start justify-between">
        <div className="h-10 w-10 rounded-lg bg-white grid place-items-center overflow-hidden shrink-0 shadow-sm">
          <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={40} />
        </div>
        {children}
      </div>
      <div className="relative">
        {status && (
          <div className={cn(
            "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full mb-1.5",
            status === "expired" ? "bg-negative/90 text-white" : "bg-warning/90 text-warning-foreground"
          )}>
            <Clock className="h-2.5 w-2.5" />
            {status === "expired" ? "Expired" : `Expires in ${daysUntil(card.expiry_date!)}d`}
          </div>
        )}
        <div className="font-display text-2xl tabular text-white leading-none drop-shadow-sm">{fmtUSD(Number(card.balance))}</div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[12px] text-white/85 font-medium truncate">{card.brand_name}</span>
          {card.card_number_last4 && (
            <span className="text-[11px] text-white/60 font-mono tracking-wider">•••• {card.card_number_last4}</span>
          )}
        </div>
      </div>
    </div>
  );
};

/** Click-to-view popup for a card — read-only quick view with shortcuts into edit/spend/remove.
 *  Supports swiping left/right to browse other cards without closing the popup. */
const CardDetailDialog = ({
  cards, index, onIndexChange, onClose, onEdit, onLogSpend, onRemove, removingId,
}: {
  cards: GiftCardRow[]; index: number; onIndexChange: (i: number) => void;
  onClose: () => void; onEdit: (card: GiftCardRow) => void; onLogSpend: (card: GiftCardRow) => void;
  onRemove: (card: GiftCardRow) => void; removingId: string | null;
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
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">{card.brand_name} details</DialogTitle>
        <DialogDescription className="sr-only">Full details for this gift card. Swipe to browse other cards.</DialogDescription>

        <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-white/80 hover:text-white hover:bg-black/20 transition-colors z-10">
          <X className="h-4 w-4" />
        </button>
        {cards.length > 1 && (
          <>
            <button onClick={() => { if (index > 0) { onIndexChange(index - 1); setReveal(false); } }} disabled={index === 0}
              className="absolute left-2 top-[4.5rem] -translate-y-1/2 h-7 w-7 grid place-items-center rounded-full bg-black/25 text-white disabled:opacity-30 transition-colors z-10">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => { if (index < cards.length - 1) { onIndexChange(index + 1); setReveal(false); } }} disabled={index === cards.length - 1}
              className="absolute right-2 top-[4.5rem] -translate-y-1/2 h-7 w-7 grid place-items-center rounded-full bg-black/25 text-white disabled:opacity-30 transition-colors z-10">
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Swipeable card visual at top */}
        <div
          className="p-4 select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          style={{
            transform: `translateX(${dragX}px)`,
            transition: draggingRef.current ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)",
            cursor: cards.length > 1 ? "grab" : "default",
            touchAction: "none",
          }}
        >
          <GiftCardTile card={card} />
        </div>
        {cards.length > 1 && (
          <div className="text-center text-[10.5px] text-muted-foreground -mt-1 mb-1">{index + 1} of {cards.length} · swipe to browse</div>
        )}

        <div className="px-5 pb-5 space-y-4">
          {status && (
            <div className={cn("flex items-center gap-1.5 text-[12px]", status === "expired" ? "text-negative" : "text-warning")}>
              <Clock className="h-3.5 w-3.5" /> {status === "expired" ? "This card has expired" : `Expires in ${daysUntil(card.expiry_date!)} days`}
            </div>
          )}

          <div className="flex items-center gap-2 text-[12px]">
            {card.balance_verified ? (
              <span className="inline-flex items-center gap-1 text-positive"><CheckCircle2 className="h-3.5 w-3.5" /> Verified on vendor site</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5" /> Estimated · updated {new Date(card.last_balance_update).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>

          {(card.card_number || card.card_number_last4 || card.pin) && (
            <div className="surface-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Card details</span>
                <button onClick={() => setReveal(v => !v)} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                  {reveal ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Reveal</>}
                </button>
              </div>
              {(card.card_number || card.card_number_last4) && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">Number</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tracking-wider text-foreground">
                      {reveal ? (card.card_number ?? `•••• ${card.card_number_last4}`) : `•••• ${card.card_number_last4 ?? "????"}`}
                    </span>
                    {card.card_number && (
                      <button onClick={() => copyToClipboard(card.card_number!, "Card number")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {card.pin && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-foreground">PIN</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tracking-wider text-foreground">{reveal ? card.pin : "••••"}</span>
                    <button onClick={() => copyToClipboard(card.pin!, "PIN")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {card.notes && (
            <div className="text-[12px] text-muted-foreground">
              <span className="text-[10px] uppercase tracking-wider block mb-1">Notes</span>
              {card.notes}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => onLogSpend(card)} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              <MinusCircle className="h-3.5 w-3.5" /> Log spend
            </button>
            <button onClick={() => onEdit(card)} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            {card.balance_check_url && (
              <a href={card.balance_check_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-secondary/60 text-[12px] text-foreground hover:bg-secondary transition-colors">
                <ExternalLink className="h-3.5 w-3.5" /> Check balance
              </a>
            )}
            {card.buy_url && (
              <a href={card.buy_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md bg-secondary/60 text-[12px] text-foreground hover:bg-secondary transition-colors">
                <ShoppingBag className="h-3.5 w-3.5" /> Buy more
              </a>
            )}
          </div>

          <button onClick={() => onRemove(card)} disabled={removingId === card.id}
            className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md text-[12px] text-negative hover:bg-negative/10 transition-colors disabled:opacity-50">
            {removingId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Remove card
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const GiftCardsSection = () => {
  const { user } = useAuth();
  const [cards, setCards] = useState<GiftCardRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [spendCard, setSpendCard] = useState<GiftCardRow | null>(null);
  const [editCard, setEditCard] = useState<GiftCardRow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("gift_cards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { toast.error("Couldn't load gift cards", { description: error.message }); return; }
    setCards(data ?? []);
  }, [user]);

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
    setRemovingId(id);
    const { error } = await supabase.from("gift_cards").delete().eq("id", id);
    setRemovingId(null);
    if (error) { toast.error("Couldn't remove card", { description: error.message }); return; }
    toast.success("Gift card removed");
    setCards(c => (c ?? []).filter(x => x.id !== id));
  };

  const goTo = (i: number) => { if (!cards) return; setActiveIndex(Math.max(0, Math.min(cards.length - 1, i))); };

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
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {cards.length} card{cards.length !== 1 ? "s" : ""} · {fmtUSD(totalBalance)} total balance
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cards && cards.length > 0 && (
            <div className="inline-flex p-0.5 rounded-md bg-secondary/60 border border-border/40">
              <button onClick={() => setViewMode("cards")}
                className={cn("px-2.5 h-7 rounded-[5px] text-[11.5px] font-medium transition-colors", viewMode === "cards" ? "bg-surface-elevated text-foreground shadow-sm" : "text-muted-foreground")}>
                Cards
              </button>
              <button onClick={() => setViewMode("table")}
                className={cn("px-2.5 h-7 rounded-[5px] text-[11.5px] font-medium transition-colors", viewMode === "table" ? "bg-surface-elevated text-foreground shadow-sm" : "text-muted-foreground")}>
                Table
              </button>
            </div>
          )}
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gold text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" /> Add gift card
          </button>
        </div>
      </div>

      {(expired.length > 0 || expiringSoon.length > 0) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="text-[12px] text-foreground">
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

      {cards === null ? (
        <div className="surface-card p-8 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : cards.length === 0 ? (
        <div className="surface-card p-8 text-center">
          <Gift className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <div className="text-[13px] text-foreground font-medium">No gift cards yet</div>
          <div className="text-[12px] text-muted-foreground mt-1">Track balances for Amazon, Starbucks, Target, and 25+ other brands, or add any custom one.</div>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-gold text-[12.5px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" /> Add your first gift card
          </button>
        </div>
      ) : (
        <div className="overflow-x-hidden space-y-3">
          {/* ── Desktop: side-by-side table + active card preview ── */}
          <div className="hidden md:grid md:grid-cols-5 gap-4 items-start">
            {/* Table — takes most of the width */}
            <div className="md:col-span-3 surface-card overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Brand</th>
                    <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground text-right">Balance</th>
                    <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Expires</th>
                    <th className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Card #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/15">
                  {sortedForTable.map(({ card, originalIndex: i }) => {
                    const status = expiryStatus(card.expiry_date);
                    const isActive = i === activeIndex;
                    return (
                      <tr key={card.id}
                        onClick={() => { goTo(i); setDetailIndex(i); }}
                        className={cn("cursor-pointer transition-colors", isActive ? "bg-[hsl(var(--primary)/0.07)]" : "hover:bg-surface-hover/30")}>
                        <td className="px-4 py-3 flex items-center gap-2.5">
                          {isActive && <div className="w-1 h-6 rounded-full bg-[hsl(var(--primary))] shrink-0 -ml-1" />}
                          <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={28} />
                          <span className="text-[13px] font-medium text-foreground truncate">{card.brand_name}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={cn("text-[13.5px] tabular font-semibold", Number(card.balance) === 0 ? "text-muted-foreground" : "text-foreground")}>
                            {fmtUSD(Number(card.balance))}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {card.expiry_date ? (
                            <span className={cn("text-[12px] tabular", status === "expired" ? "text-negative font-medium" : status === "expiring-soon" ? "text-warning" : "text-muted-foreground")}>
                              {new Date(card.expiry_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                            </span>
                          ) : <span className="text-[12px] text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] text-muted-foreground tabular">
                            {card.card_number_last4 ? `···· ${card.card_number_last4}` : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Card preview panel — shows selected card details inline */}
            <div className="md:col-span-2 space-y-3">
              {cards[activeIndex] && (() => {
                const card = cards[activeIndex];
                const status = expiryStatus(card.expiry_date);
                return (
                  <div className="space-y-3">
                    <GiftCardTile card={card}>
                      <div className="flex items-center gap-1">
                        {card.balance_verified
                          ? <span className="text-positive"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                          : <span className="text-white/60"><AlertCircle className="h-3.5 w-3.5" /></span>}
                        <button onClick={() => removeCard(card.id)} disabled={removingId === card.id}
                          className="h-6 w-6 grid place-items-center rounded text-white/60 hover:text-white hover:bg-black/20 transition-colors disabled:opacity-40">
                          {removingId === card.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </button>
                      </div>
                    </GiftCardTile>
                    <div className="surface-card p-4 space-y-3">
                      {(card.card_number_last4 || card.pin || card.expiry_date || card.notes) && (
                        <div className="space-y-2 text-[13px]">
                          {card.card_number_last4 && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Card number</span>
                              <div className="flex items-center gap-1.5">
                                <span className="tabular">···· {card.card_number_last4}</span>
                                {card.card_number && <button onClick={() => copyToClipboard(card.card_number!, "Card number")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground"><Copy className="h-3 w-3" /></button>}
                              </div>
                            </div>
                          )}
                          {card.pin && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">PIN</span>
                              <div className="flex items-center gap-1.5">
                                <span className="tabular">{card.pin}</span>
                                <button onClick={() => copyToClipboard(card.pin!, "PIN")} className="h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground"><Copy className="h-3 w-3" /></button>
                              </div>
                            </div>
                          )}
                          {card.expiry_date && (
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Expires</span>
                              <span className={cn("tabular", status === "expired" ? "text-negative font-medium" : status === "expiring-soon" ? "text-warning" : "")}>
                                {new Date(card.expiry_date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                              </span>
                            </div>
                          )}
                          {card.notes && <p className="text-muted-foreground text-[12px]">{card.notes}</p>}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setSpendCard(card)}
                          className="h-9 rounded-lg border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5">
                          <MinusCircle className="h-3.5 w-3.5" /> Log spend
                        </button>
                        <button onClick={() => setEditCard(card)}
                          className="h-9 rounded-lg border border-border-strong text-[12px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1.5">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                        {card.balance_check_url && (
                          <a href={card.balance_check_url} target="_blank" rel="noopener noreferrer"
                            className="col-span-2 h-9 rounded-lg bg-secondary/50 text-[12px] text-foreground hover:bg-secondary transition-colors flex items-center justify-center gap-1.5">
                            <ExternalLink className="h-3.5 w-3.5" /> Check balance on {card.brand_name}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Mobile: clean list, tap row to open detail sheet ── */}
          <div className="md:hidden surface-card overflow-hidden">
            <div className="divide-y divide-border/15">
              {sortedForTable.map(({ card, originalIndex: i }) => {
                const status = expiryStatus(card.expiry_date);
                const bal = Number(card.balance);
                return (
                  <button key={card.id}
                    onClick={() => { goTo(i); setDetailIndex(i); }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-hover/30 transition-colors active:bg-surface-hover/50">
                    <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-foreground truncate">{card.brand_name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {status && (
                          <span className={cn("text-[11px] font-medium", status === "expired" ? "text-negative" : "text-warning")}>
                            {status === "expired" ? "Expired" : `${daysUntil(card.expiry_date!)}d left`}
                          </span>
                        )}
                        {card.card_number_last4 && <span className="text-[11px] text-muted-foreground">···· {card.card_number_last4}</span>}
                        {!status && !card.card_number_last4 && <span className="text-[11px] text-muted-foreground">Tap for details</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn("text-[15px] tabular font-semibold", bal === 0 ? "text-muted-foreground" : "text-foreground")}>{fmtUSD(bal)}</div>
                      <div className="text-[10.5px] text-muted-foreground mt-0.5">balance</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <AddGiftCardDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
      {spendCard && <LogSpendDialog card={spendCard} onClose={() => setSpendCard(null)} onSaved={load} />}
      {editCard && <EditGiftCardDialog card={editCard} onClose={() => setEditCard(null)} onSaved={load} />}
      {detailIndex !== null && cards && cards[detailIndex] && (
        <CardDetailDialog
          cards={cards}
          index={detailIndex}
          onIndexChange={(i) => { setDetailIndex(i); goTo(i); }}
          onClose={() => setDetailIndex(null)}
          onEdit={(c) => { setEditCard(c); setDetailIndex(null); }}
          onLogSpend={(c) => { setSpendCard(c); setDetailIndex(null); }}
          onRemove={(c) => { removeCard(c.id); setDetailIndex(null); }}
          removingId={removingId}
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
    const { error } = await supabase.from("gift_cards").insert({
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
    });
    setSaving(false);
    if (error) { toast.error("Couldn't add gift card", { description: error.message }); return; }
    toast.success(`${chosen.name} gift card added`);
    onOpenChange(false);
    onAdded();
  };

  const preview = chosen
    ? { brand_name: chosen.name, domain: chosen.domain, logo_url: chosen.logo_url, balance: Number(balance) || 0, card_number_last4: last4 || null, expiry_date: expiryDate || null }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[88vh] flex flex-col">
        <DialogTitle className="sr-only">Add a gift card</DialogTitle>
        <DialogDescription className="sr-only">Choose a brand, then enter the card details.</DialogDescription>

        {/* Header with back button on step 2 */}
        <div className="px-4 pt-4 pb-3 border-b border-border/40 shrink-0 flex items-center gap-2">
          {step === "details" && (
            <button onClick={() => setStep("pick")}
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
                  <div className="text-[11px] text-muted-foreground">Enter card details</div>
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
          <button onClick={() => onOpenChange(false)} className="ml-auto h-8 w-8 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0 no-min-h">
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
                      <span className="text-[11px] text-foreground leading-tight text-center line-clamp-2">{b.name}</span>
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
                        <div className="text-[13px] text-foreground font-medium truncate">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{r.domain}</div>
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
                        <div className="text-[13px] text-foreground font-medium">Add "{search.trim()}"</div>
                        <div className="text-[11px] text-muted-foreground">Save without a logo</div>
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
                  className="w-full h-11 pl-10 pr-10 rounded-xl bg-surface/60 border border-border/60 text-[14px] text-foreground outline-none focus:border-primary/50 transition-colors"
                />
                {search && (
                  <button onClick={() => { setSearch(""); setLookupResults([]); }}
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
                <label className="text-[12px] font-medium text-foreground">Current balance *</label>
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
                  <label className="text-[12px] font-medium text-foreground">Card number</label>
                  <input value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Optional"
                    className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[14px] text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-foreground">PIN</label>
                  <input value={pin} onChange={e => setPin(e.target.value)} placeholder="Optional"
                    className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[14px] text-foreground outline-none focus:border-primary/50 transition-colors" />
                </div>
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground">Expiry date</label>
                <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                  className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[14px] text-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>

              <div>
                <label className="text-[12px] font-medium text-foreground">Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Birthday gift from mom"
                  className="mt-1.5 w-full h-11 bg-surface/40 border border-border/60 rounded-xl px-3 text-[14px] text-foreground outline-none focus:border-primary/50 transition-colors" />
              </div>
            </div>

            <div className="p-4 border-t border-border/40 shrink-0">
              <button onClick={save} disabled={balance === "" || saving}
                className="w-full h-12 rounded-xl bg-gold text-[14px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center justify-center gap-2">
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

const LogSpendDialog = ({ card, onClose, onSaved }: { card: GiftCardRow; onClose: () => void; onSaved: () => void }) => {
  const [spent, setSpent] = useState("");
  const [saving, setSaving] = useState(false);
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
    toast.success("Balance updated");
    onClose();
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Log spend on {card.brand_name}</DialogTitle>
        <DialogDescription className="sr-only">Record how much you spent to update the tracked balance.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={36} />
            <div>
              <div className="font-display text-base text-foreground">{card.brand_name}</div>
              <div className="text-[11px] text-muted-foreground">Current balance: {fmtUSD(Number(card.balance))}</div>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">How much did you spend?</label>
            <input type="number" step="0.01" autoFocus value={spent} onChange={e => setSpent(e.target.value)} placeholder="0.00"
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
          </div>
          {spent !== "" && (
            <div className="text-[12px] text-muted-foreground">New balance: <span className="text-foreground font-medium tabular">{fmtUSD(newBalance)}</span></div>
          )}
        </div>
        <div className="p-4 pt-0 flex gap-2">
          <button onClick={save} disabled={saving || spent === ""}
            className="flex-1 h-10 rounded-lg bg-gold text-[13px] font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Update balance"}
          </button>
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border-strong text-[12px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ───────────────────────── Edit dialog ───────────────────────── */

const EditGiftCardDialog = ({ card, onClose, onSaved }: { card: GiftCardRow; onClose: () => void; onSaved: () => void }) => {
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
    setSaving(true);
    const { error } = await supabase.from("gift_cards").update({
      balance: Number(balance) || 0,
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
    toast.success("Gift card updated");
    onClose();
    onSaved();
  };

  const status = expiryStatus(expiryDate || null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Edit {card.brand_name}</DialogTitle>
        <DialogDescription className="sr-only">Edit balance and details for this gift card.</DialogDescription>
        <div className="relative p-5 pb-4 border-b border-border/40 shrink-0">
          <button onClick={onClose} className="absolute top-4 right-4 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors">
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
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</label>
              <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Expiry date</label>
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>
          {status && (
            <div className={cn("flex items-center gap-1.5 text-[11px] -mt-2", status === "expired" ? "text-negative" : "text-warning")}>
              <Clock className="h-3 w-3" /> {status === "expired" ? "This card has expired" : `Expires in ${daysUntil(expiryDate)} days`}
            </div>
          )}

          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Card details</label>
            <button onClick={() => setRevealSensitive(v => !v)} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              {revealSensitive ? <><EyeOff className="h-3 w-3" /> Hide</> : <><Eye className="h-3 w-3" /> Reveal</>}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 -mt-2">
            <div className="relative">
              <input type={revealSensitive ? "text" : "password"} value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Card number"
                className="w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 pr-9 text-[13px] text-foreground outline-none focus:border-foreground/40" />
              {cardNumber && (
                <button onClick={() => copyToClipboard(cardNumber.replace(/\s/g, ""), "Card number")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="relative">
              <input type={revealSensitive ? "text" : "password"} value={pin} onChange={e => setPin(e.target.value)} placeholder="PIN"
                className="w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 pr-9 text-[13px] text-foreground outline-none focus:border-foreground/40" />
              {pin && (
                <button onClick={() => copyToClipboard(pin, "PIN")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors">
                  <Copy className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
          </div>

          <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} className="rounded" />
            I just confirmed this balance on {card.brand_name}'s site
          </label>
          {card.buy_url && (
            <a href={card.buy_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <ShoppingBag className="h-3 w-3" /> Buy another {card.brand_name} gift card
            </a>
          )}
        </div>
        <div className="p-4 pt-0 flex gap-2 shrink-0">
          <button onClick={save} disabled={saving}
            className="flex-1 h-10 rounded-lg bg-gold text-[13px] font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose} className="h-10 px-4 rounded-lg border border-border-strong text-[12px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

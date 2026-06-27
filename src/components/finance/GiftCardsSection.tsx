import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GIFT_CARD_BRANDS, logoUrlForDomain, brandGradient, searchBrands, type GiftCardBrand, type BrandSuggestion } from "@/lib/gift-card-brands";
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
  const [failed, setFailed] = useState(false);
  const src = logoUrl ?? (domain ? logoUrlForDomain(domain) : null);
  if (!src || failed) {
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
      onError={() => setFailed(true)}
      className="rounded-lg border border-border/50 object-contain bg-white shrink-0"
      style={{ height: size, width: size }}
    />
  );
};

/** Renders an actual gift-card-shaped tile: brand-tinted gradient, logo, balance, masked number. */
const GiftCardTile = ({ card, children }: { card: { brand_name: string; domain?: string | null; logo_url?: string | null; balance: number; card_number_last4?: string | null; expiry_date?: string | null }; children?: React.ReactNode }) => {
  const status = expiryStatus(card.expiry_date);
  return (
    <div
      className="relative rounded-2xl p-4 overflow-hidden flex flex-col justify-between aspect-[1.6/1] shadow-[var(--shadow-card)]"
      style={{ background: brandGradient(card.brand_name) }}
    >
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 85% 15%, white, transparent 60%)" }} />
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

export const GiftCardsSection = () => {
  const { user } = useAuth();
  const [cards, setCards] = useState<GiftCardRow[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [spendCard, setSpendCard] = useState<GiftCardRow | null>(null);
  const [editCard, setEditCard] = useState<GiftCardRow | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
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

  const onPointerDown = (e: React.PointerEvent) => { draggingRef.current = true; startXRef.current = e.clientX; };
  const onPointerMove = (e: React.PointerEvent) => { if (draggingRef.current) setDragX(e.clientX - startXRef.current); };
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
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gold text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" /> Add gift card
        </button>
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
          <div className="text-[12px] text-muted-foreground mt-1">Track balances for Amazon, Starbucks, Target, and 25+ other brands — or add any custom one.</div>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-gold text-[12.5px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" /> Add your first gift card
          </button>
        </div>
      ) : (
        <>
          {/* Swipeable card stack */}
          <div
            className="relative h-44 sm:h-48 select-none touch-pan-y"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {cards.map((card, i) => {
              const offset = i - activeIndex;
              if (Math.abs(offset) > 2) return null;
              const isActive = offset === 0;
              const liveDrag = isActive ? dragX : 0;
              const translate = offset * 28 + liveDrag / 3;
              const scale = 1 - Math.min(Math.abs(offset), 2) * 0.08;
              const opacity = 1 - Math.min(Math.abs(offset), 2) * 0.35;
              return (
                <div
                  key={card.id}
                  className="absolute inset-x-0 top-0 max-w-sm mx-auto cursor-grab active:cursor-grabbing"
                  style={{
                    transform: `translateX(${translate}%) scale(${scale})`,
                    opacity,
                    zIndex: 10 - Math.abs(offset),
                    transition: draggingRef.current && isActive ? "none" : "transform 280ms cubic-bezier(0.22,1,0.36,1), opacity 280ms",
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                  onClick={() => !isActive && goTo(i)}
                >
                  <GiftCardTile card={card}>
                    <div className="relative flex items-center gap-1">
                      {card.balance_verified ? (
                        <span title="Verified on vendor site" className="text-positive"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                      ) : (
                        <span title={`Estimated · updated ${new Date(card.last_balance_update).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`} className="text-white/60"><AlertCircle className="h-3.5 w-3.5" /></span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); removeCard(card.id); }} disabled={removingId === card.id}
                        className="h-6 w-6 grid place-items-center rounded text-white/60 hover:text-white hover:bg-black/20 transition-colors shrink-0 disabled:opacity-40">
                        {removingId === card.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </GiftCardTile>
                </div>
              );
            })}

            {cards.length > 1 && (
              <>
                <button onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-full bg-surface-elevated border border-border/60 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors z-20">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === cards.length - 1}
                  className="absolute right-0 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-full bg-surface-elevated border border-border/60 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors z-20">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {/* Dot indicators */}
          {cards.length > 1 && (
            <div className="flex items-center justify-center gap-1.5">
              {cards.map((c, i) => (
                <button key={c.id} onClick={() => goTo(i)} aria-label={`Go to ${c.brand_name}`}
                  className={cn("h-1.5 rounded-full transition-all", i === activeIndex ? "w-5 bg-primary" : "w-1.5 bg-border-strong hover:bg-muted-foreground")} />
              ))}
            </div>
          )}

          {/* Actions for the active card */}
          {cards[activeIndex] && (
            <div className="grid grid-cols-2 gap-1.5 max-w-sm mx-auto">
              <button onClick={() => setSpendCard(cards[activeIndex])}
                className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border-strong text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <MinusCircle className="h-3 w-3" /> Log spend
              </button>
              <button onClick={() => setEditCard(cards[activeIndex])}
                className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border-strong text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <Pencil className="h-3 w-3" /> Edit
              </button>
              {cards[activeIndex].card_number_last4 && (
                <button onClick={() => copyToClipboard(cards[activeIndex].card_number ?? cards[activeIndex].card_number_last4!, "Card number")}
                  className="inline-flex items-center justify-center gap-1.5 h-8 rounded-md border border-border-strong text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  <Copy className="h-3 w-3" /> Copy number
                </button>
              )}
              {cards[activeIndex].balance_check_url && (
                <a href={cards[activeIndex].balance_check_url!} target="_blank" rel="noopener noreferrer"
                  className={cn("inline-flex items-center justify-center gap-1.5 h-8 rounded-md bg-secondary/60 text-[11px] text-foreground hover:bg-secondary transition-colors",
                    !cards[activeIndex].card_number_last4 && "col-span-2")}>
                  <ExternalLink className="h-3 w-3" /> Check balance
                </a>
              )}
            </div>
          )}

          {/* Compact table — full list at a glance */}
          <div className="surface-card overflow-hidden">
            <div className="divide-y divide-border/20">
              {cards.map((card, i) => {
                const status = expiryStatus(card.expiry_date);
                return (
                  <button key={card.id} onClick={() => goTo(i)}
                    className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors", i === activeIndex ? "bg-surface-hover/50" : "hover:bg-surface-hover/30")}>
                    <BrandLogo domain={card.domain} logoUrl={card.logo_url} name={card.brand_name} size={24} />
                    <span className="text-[12px] text-foreground font-medium truncate flex-1 min-w-0">{card.brand_name}</span>
                    {status && (
                      <span className={cn("text-[9.5px] px-1.5 py-0.5 rounded-full font-medium shrink-0", status === "expired" ? "bg-negative/10 text-negative" : "bg-warning/10 text-warning")}>
                        {status === "expired" ? "Expired" : `${daysUntil(card.expiry_date!)}d left`}
                      </span>
                    )}
                    <span className="text-[12.5px] tabular font-semibold text-foreground shrink-0">{fmtUSD(Number(card.balance))}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <AddGiftCardDialog open={addOpen} onOpenChange={setAddOpen} onAdded={load} />
      {spendCard && <LogSpendDialog card={spendCard} onClose={() => setSpendCard(null)} onSaved={load} />}
      {editCard && <EditGiftCardDialog card={editCard} onClose={() => setEditCard(null)} onSaved={load} />}
    </section>
  );
};

/* ───────────────────────── Add dialog ───────────────────────── */

const AddGiftCardDialog = ({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) => {
  const { user } = useAuth();
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GiftCardBrand | null>(null);

  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<BrandSuggestion[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [customPick, setCustomPick] = useState<BrandSuggestion | null>(null);

  const [balance, setBalance] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [pin, setPin] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const last4 = cardNumber.replace(/\D/g, "").slice(-4);

  const reset = () => {
    setMode("preset"); setSearch(""); setSelected(null);
    setLookupQuery(""); setLookupResults([]); setCustomPick(null);
    setBalance(""); setCardNumber(""); setPin(""); setExpiryDate(""); setNotes("");
  };
  useEffect(() => { if (!open) reset(); }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return GIFT_CARD_BRANDS;
    return GIFT_CARD_BRANDS.filter(b => b.name.toLowerCase().includes(q));
  }, [search]);

  // Debounced "search any company" lookup — backs the Custom brand tab.
  useEffect(() => {
    if (mode !== "custom" || lookupQuery.trim().length < 2) { setLookupResults([]); return; }
    const controller = new AbortController();
    setLookupLoading(true);
    const t = setTimeout(async () => {
      try {
        const results = await searchBrands(lookupQuery, controller.signal);
        setLookupResults(results);
      } catch {
        // ignore — network hiccup or aborted, user can keep typing
      } finally {
        setLookupLoading(false);
      }
    }, 350);
    return () => { clearTimeout(t); controller.abort(); };
  }, [lookupQuery, mode]);

  const preview = mode === "preset"
    ? selected
      ? { brand_name: selected.name, domain: selected.domain, logo_url: null as string | null, balance: Number(balance) || 0, card_number_last4: last4 || null, expiry_date: expiryDate || null }
      : null
    : customPick
      ? { brand_name: customPick.name, domain: customPick.domain, logo_url: customPick.logo, balance: Number(balance) || 0, card_number_last4: last4 || null, expiry_date: expiryDate || null }
      : lookupQuery.trim()
        ? { brand_name: lookupQuery.trim(), domain: null, logo_url: null as string | null, balance: Number(balance) || 0, card_number_last4: last4 || null, expiry_date: expiryDate || null }
        : null;

  const canSave = mode === "preset" ? !!selected && balance !== "" : (customPick || lookupQuery.trim() !== "") && balance !== "";

  const save = async () => {
    if (!user || !canSave) return;
    setSaving(true);
    const bal = Number(balance) || 0;
    const shared = {
      balance: bal,
      initial_balance: bal,
      card_number: cardNumber.replace(/\s/g, "") || null,
      card_number_last4: last4 || null,
      pin: pin || null,
      expiry_date: expiryDate || null,
      notes: notes.trim() || null,
    };
    const payload = mode === "preset" && selected
      ? {
          user_id: user.id,
          brand_name: selected.name,
          domain: selected.domain,
          logo_url: null,
          balance_check_url: selected.balanceCheckUrl,
          buy_url: selected.buyUrl,
          ...shared,
        }
      : {
          user_id: user.id,
          brand_name: customPick ? customPick.name : lookupQuery.trim(),
          domain: customPick?.domain ?? null,
          logo_url: customPick?.logo ?? null,
          balance_check_url: customPick ? `https://${customPick.domain}` : null,
          buy_url: null,
          ...shared,
        };
    const { error } = await supabase.from("gift_cards").insert(payload);
    setSaving(false);
    if (error) { toast.error("Couldn't add gift card", { description: error.message }); return; }
    toast.success(`${payload.brand_name} gift card added`);
    onOpenChange(false);
    onAdded();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg surface-elevated border-border p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogTitle className="sr-only">Add a gift card</DialogTitle>
        <DialogDescription className="sr-only">Track the balance of a gift card from a preset brand or a custom one.</DialogDescription>

        <div className="px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-gold grid place-items-center shrink-0">
              <Gift className="h-4 w-4" />
            </div>
            <div className="font-display text-lg text-foreground">Add a gift card</div>
          </div>
          <div className="mt-3 inline-flex p-1 rounded-full border border-border bg-surface/60">
            <button onClick={() => setMode("preset")}
              className={cn("px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors", mode === "preset" ? "bg-foreground text-background" : "text-muted-foreground")}>
              Choose a brand
            </button>
            <button onClick={() => setMode("custom")}
              className={cn("px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors", mode === "custom" ? "bg-foreground text-background" : "text-muted-foreground")}>
              Search any company
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto min-h-0">
          {preview && (
            <div className="max-w-[260px]">
              <GiftCardTile card={preview} />
            </div>
          )}

          {mode === "preset" ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search brands…"
                  className="w-full h-9 pl-9 pr-3 rounded-lg bg-surface/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-foreground/40"
                />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                {filtered.map(b => (
                  <button key={b.name} onClick={() => setSelected(b)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 p-2.5 rounded-lg border transition-colors text-center",
                      selected?.name === b.name ? "border-primary bg-primary/10" : "border-border/40 hover:border-border-strong"
                    )}>
                    <BrandLogo domain={b.domain} name={b.name} size={32} />
                    <span className="text-[10px] text-foreground leading-tight line-clamp-2">{b.name}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="col-span-full text-center text-[12px] text-muted-foreground py-6">
                    No matches — try "Search any company" instead.
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <input
                  value={lookupQuery}
                  onChange={e => { setLookupQuery(e.target.value); setCustomPick(null); }}
                  placeholder="Type a company name…"
                  className="w-full h-9 pl-9 pr-9 rounded-lg bg-surface/40 border border-border/60 text-[13px] text-foreground outline-none focus:border-foreground/40"
                />
                {lookupLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground/50" />}
              </div>
              {lookupResults.length > 0 && !customPick && (
                <div className="rounded-lg border border-border/40 divide-y divide-border/20 overflow-hidden">
                  {lookupResults.map(r => (
                    <button key={r.domain} onClick={() => { setCustomPick(r); setLookupQuery(r.name); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover/40 transition-colors text-left">
                      <BrandLogo domain={r.domain} logoUrl={r.logo} name={r.name} size={28} />
                      <div className="min-w-0">
                        <div className="text-[12.5px] text-foreground truncate">{r.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{r.domain}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {customPick && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-positive" /> Found {customPick.name} ({customPick.domain})
                  <button onClick={() => { setCustomPick(null); setLookupResults([]); }} className="ml-auto text-muted-foreground/60 hover:text-foreground underline">change</button>
                </div>
              )}
              {!customPick && lookupQuery.trim() !== "" && !lookupLoading && lookupResults.length === 0 && (
                <div className="text-[11px] text-muted-foreground">
                  No match found — we'll save it as "{lookupQuery.trim()}" without a logo. You can add one later from Edit.
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Current balance</label>
              <input type="number" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Expiry date (optional)</label>
              <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Card number (optional)</label>
              <input value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="e.g. 6006 1234 5678 9012"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">PIN (optional)</label>
              <input value={pin} onChange={e => setPin(e.target.value)} placeholder="e.g. 1234"
                className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Birthday gift from mom"
              className="mt-1.5 w-full bg-surface/40 border border-border/60 rounded-lg px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40" />
          </div>

          {mode === "preset" && selected && (
            <div className="rounded-md bg-secondary/30 border border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
              We can't read balances directly from {selected.name}'s site (it's protected against automated access). After saving, use "Check balance on {selected.name}" to verify it there, and "Log spend" each time you use the card to keep the balance here up to date.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border/40 shrink-0">
          <button onClick={save} disabled={!canSave || saving}
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-md bg-gold text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Plus className="h-4 w-4" /> Add gift card</>}
          </button>
        </div>
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

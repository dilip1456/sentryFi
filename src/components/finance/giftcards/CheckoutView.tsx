import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtUSD } from "@/lib/format";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Pencil, Sun, Wallet, X } from "lucide-react";
import { GiftCardBarcode } from "./GiftCardBarcode";
import { useWakeLock } from "@/hooks/useWakeLock";
import { BARCODE_FORMATS, barcodeValue, groupDigits, resolveFormat, type BarcodeFormat, type GiftCard } from "@/lib/gift-cards";

const copy = async (text: string, label: string) => {
  try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); }
  catch { toast.error(`Couldn't copy ${label.toLowerCase()}`); }
};

/**
 * Full-screen "Show at checkout" view: white, high-contrast, the barcode as
 * large as the screen allows, the number in big type, PIN behind a tap.
 */
export const CheckoutView = ({ card, onClose, onEdit, onUpdateBalance }: {
  card: GiftCard; onClose: () => void; onEdit: (c: GiftCard) => void; onUpdateBalance: (c: GiftCard) => void;
}) => {
  const [format, setFormat] = useState<BarcodeFormat>(() => resolveFormat(card));
  const [showPin, setShowPin] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wakeHeld = useWakeLock(true);
  const number = card.card_number?.trim() ?? "";
  const fellBack = number ? barcodeValue(number, format).fellBack : false;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent
        showClose={false}
        data-testid="gc-checkout"
        onOpenAutoFocus={e => { e.preventDefault(); closeRef.current?.focus(); }}
        className={cn(
          "left-0 top-0 translate-x-0 translate-y-0 w-screen max-w-none h-[100dvh] max-h-[100dvh] rounded-none sm:rounded-none border-0 p-0 gap-0",
          "bg-white text-neutral-900 flex flex-col z-[70]",
          "data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0",
        )}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-neutral-200 shrink-0">
          <button ref={closeRef} onClick={onClose} aria-label="Close"
            className="tap-44 h-11 w-11 grid place-items-center rounded-full text-neutral-700 hover:bg-neutral-100">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[17px] font-semibold leading-tight truncate text-neutral-900">{card.brand_name}</DialogTitle>
            <DialogDescription className="text-[13px] text-neutral-600 tabular">
              Balance {fmtUSD(Number(card.balance))}{card.card_number_last4 ? ` · •••• ${card.card_number_last4}` : ""}
            </DialogDescription>
          </div>
          <button onClick={() => onUpdateBalance(card)} aria-label="Update balance"
            className="tap-44 h-11 px-3 inline-flex items-center gap-1.5 rounded-full border border-neutral-300 text-[13px] font-medium text-neutral-800 hover:bg-neutral-100 shrink-0">
            <Wallet className="h-4 w-4" aria-hidden="true" /> <span className="hidden min-[380px]:inline">Update balance</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <div className="m-auto w-full max-w-[560px] px-5 py-6 flex flex-col items-center gap-5">
            {number ? (
              <>
                <GiftCardBarcode number={number} format={format} brand={card.brand_name}
                  className={cn(format === "qrcode" ? "max-w-[280px]" : "max-w-[520px]", "p-2 max-h-[42dvh] [&>div]:max-h-[42dvh] [&>div>svg]:object-contain")} />

                <div className="w-full flex items-center justify-center gap-2">
                  <div className="font-mono text-[20px] min-[380px]:text-[24px] sm:text-[28px] tracking-[0.06em] font-semibold text-neutral-900 text-center break-all tabular"
                    data-testid="gc-checkout-number">
                    {groupDigits(number)}
                  </div>
                  <button onClick={() => copy(number.replace(/\s+/g, ""), "Card number")} aria-label="Copy card number"
                    className="tap-44 h-11 w-11 grid place-items-center rounded-full text-neutral-600 hover:bg-neutral-100 shrink-0">
                    <Copy className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                {card.pin && (
                  <div className="w-full flex items-center justify-center gap-2">
                    <button onClick={() => setShowPin(v => !v)} aria-pressed={showPin}
                      aria-label={showPin ? "Hide PIN" : "Tap to reveal PIN"}
                      className="tap-44 min-h-11 px-4 inline-flex items-center gap-2 rounded-full bg-neutral-100 text-[15px] font-medium text-neutral-800 hover:bg-neutral-200">
                      {showPin ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      {showPin ? <span>PIN <span className="font-mono tracking-[0.2em] text-[18px]" data-testid="gc-checkout-pin">{card.pin}</span></span> : "Tap to reveal PIN"}
                    </button>
                    {showPin && (
                      <button onClick={() => copy(card.pin!, "PIN")} aria-label="Copy PIN"
                        className="tap-44 h-11 w-11 grid place-items-center rounded-full text-neutral-600 hover:bg-neutral-100">
                        <Copy className="h-5 w-5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}

                <div role="group" aria-label="Barcode type" className="flex flex-wrap justify-center gap-1.5 pt-1">
                  {BARCODE_FORMATS.map(f => (
                    <button key={f.value} onClick={() => setFormat(f.value)} aria-pressed={format === f.value}
                      className={cn("tap-44 min-h-11 px-3 rounded-full text-[13px] font-medium border transition-colors",
                        format === f.value ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100")}>
                      {f.label}
                    </button>
                  ))}
                </div>

                {fellBack && (
                  <p className="text-[12.5px] text-amber-700 text-center" data-testid="gc-checkout-fallback">
                    This number isn't a valid EAN-13 code, so it's shown as Code 128.
                  </p>
                )}
                <p className="text-[12.5px] text-neutral-500 text-center inline-flex items-center gap-1.5">
                  <Sun className="h-3.5 w-3.5" aria-hidden="true" />
                  Turn your brightness up for the scanner.{wakeHeld ? " Screen stays on while this is open." : ""}
                </p>
              </>
            ) : (
              <div className="text-center space-y-3 py-10">
                <p className="text-[16px] font-medium text-neutral-900">No card number saved</p>
                <p className="text-[14px] text-neutral-600">Add the number from the back of the card to show a scannable barcode here.</p>
                <button onClick={() => onEdit(card)}
                  className="tap-44 min-h-11 px-5 inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white text-[14px] font-semibold">
                  <Pencil className="h-4 w-4" aria-hidden="true" /> Add card number
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

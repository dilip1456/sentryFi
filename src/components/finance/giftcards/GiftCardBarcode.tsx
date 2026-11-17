import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { barcodeValue, barcodeFormatLabel, groupDigits, type BarcodeFormat } from "@/lib/gift-cards";

type Bwip = typeof import("bwip-js/browser");

// bwip-js is ~200 KB, so it's only fetched the first time a barcode is shown.
let bwipPromise: Promise<Bwip> | null = null;
const loadBwip = (): Promise<Bwip> => {
  bwipPromise ??= import("bwip-js/browser").then(m => ((m as unknown as { default?: Bwip }).default?.toSVG ? (m as unknown as { default: Bwip }).default : m));
  return bwipPromise;
};

const OPTIONS: Record<BarcodeFormat, Record<string, unknown>> = {
  code128: { bcid: "code128", scale: 3, height: 22, paddingwidth: 0 },
  ean13:   { bcid: "ean13", scale: 3, height: 22, includetext: true, guardwhitespace: true },
  qrcode:  { bcid: "qrcode", scale: 6, eclevel: "M" },
  pdf417:  { bcid: "pdf417", scale: 3, columns: 4 },
};

/**
 * Renders a card number as a scannable barcode (black on white, SVG so it
 * stays crisp at any size). The wrapper carries an accessible label with the
 * number; the drawing itself is decorative to assistive tech.
 */
export const GiftCardBarcode = ({ number, format, brand, className }: {
  number: string; format: BarcodeFormat; brand: string; className?: string;
}) => {
  const { value, format: used, fellBack } = barcodeValue(number, format);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSvg(null); setError(null);
    loadBwip()
      .then(b => {
        const out = b.toSVG({ ...OPTIONS[used], text: value } as Parameters<Bwip["toSVG"]>[0]);
        if (alive) setSvg(out);
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [value, used]);

  const square = used === "qrcode";
  return (
    <div
      role="img"
      aria-label={`${barcodeFormatLabel(used)} barcode for ${brand} card number ${groupDigits(value)}`}
      data-testid="gc-barcode"
      data-format={used}
      data-fallback={fellBack ? "true" : undefined}
      className={cn(
        "relative grid place-items-center bg-white",
        square ? "aspect-square w-full max-w-[260px]" : used === "pdf417" ? "w-full aspect-[3/1]" : "w-full aspect-[2.6/1]",
        className,
      )}
    >
      {svg ? (
        <div aria-hidden="true" className="h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : error ? (
        <div className="px-3 text-center text-[13px] text-neutral-600">Couldn't draw this barcode. Read the number below to the cashier.</div>
      ) : (
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-neutral-400" />
      )}
    </div>
  );
};

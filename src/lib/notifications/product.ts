/**
 * Product / promo notices that used to be page banners: the Android-app
 * download, the demo-data note, and the Picture history hint. They live in
 * the inbox (product stack) and are dismissed via localStorage — no migration.
 */
import { isNative } from "@/lib/app-version";
import type { CompactItem } from "./compact";
import { APK_BANNER_KEY, DEMO_NOTICE_KEY, isKeySet } from "./local-state";

const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3600000).toISOString();

export const PRODUCT_APK_ID = "promo:apk";
export const PRODUCT_DEMO_ID = "promo:demo";
export const PRODUCT_HISTORY_ID = "promo:history";

export interface HistoryHintNotice {
  text: string;
  banks: string[];
}

/** Notices that belong in the inbox right now (not yet dismissed as banners). */
export function productNotices(opts: {
  demo: boolean;
  /** History hint, when Picture has published one. */
  history?: HistoryHintNotice | null;
  now?: Date;
  native?: boolean;
}): CompactItem[] {
  const now = opts.now ?? new Date();
  const native = opts.native ?? (typeof isNative === "function" ? isNative() : false);
  const out: CompactItem[] = [];
  if (!native && !isKeySet(APK_BANNER_KEY)) {
    out.push({
      id: PRODUCT_APK_ID,
      type: "promo",
      priority: "info",
      title: "Get the Android app",
      body: "Install Sentry Finance for the best experience on your phone.",
      amount: null,
      at: hoursAgo(now, 1),
      account: null,
      source: "Product",
      status: "Optional",
      stack: "product",
      read: false,
    });
  }
  if (opts.demo && !isKeySet(DEMO_NOTICE_KEY)) {
    out.push({
      id: PRODUCT_DEMO_ID,
      type: "promo",
      priority: "info",
      title: "You're viewing demo data",
      body: "Create a free account to use Sentry Finance with your own banks.",
      amount: null,
      at: hoursAgo(now, 1),
      account: null,
      source: "Product",
      status: "Optional",
      stack: "product",
      read: false,
    });
  }
  if (opts.history) {
    out.push({
      id: PRODUCT_HISTORY_ID,
      type: "promo",
      priority: "soon",
      title: "Extend bank history",
      body: `${opts.history.text} Re-link to detect yearly bills.`,
      amount: null,
      at: hoursAgo(now, 6),
      account: null,
      source: "Financial Picture",
      status: "Recommended",
      stack: null,
      read: false,
      payload: { banks: opts.history.banks },
    });
  }
  return out;
}

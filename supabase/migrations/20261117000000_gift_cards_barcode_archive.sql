-- Gift Cards redesign: scannable barcodes, "mark used / archive", and a
-- per-card usage history.
--
-- gift_cards.barcode_format: how card_number is rendered at checkout.
--   NULL means the app default (Code 128), so existing rows need no backfill.
-- gift_cards.archived_at: set when the user marks a card used/archived.
--   Archived cards leave the active list and totals but stay restorable;
--   separate from deleted_at (Removed cards).
--
-- Usage history lives in the existing append-only public.gift_card_activity
-- table (20260925120000 / repaired by 20261020120000), which already has
-- RLS by user_id (select/insert own rows only, no update/delete) and
-- cascades with its card. Rather than start a second ledger next to it, this
-- extends it:
--   * merchant: where a use / top-up happened ("Used $4.50 at Starbucks").
--   * kinds: + 'topup', 'archived', 'unarchived'.
--   amount = positive for spend/topup, signed delta for adjustment;
--   balance_after = the card balance after the event.
--
-- Idempotent (IF NOT EXISTS / guarded constraints) so it is safe to re-run.

ALTER TABLE public.gift_cards
  ADD COLUMN IF NOT EXISTS barcode_format TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gift_cards_barcode_format_check'
      AND conrelid = 'public.gift_cards'::regclass
  ) THEN
    ALTER TABLE public.gift_cards
      ADD CONSTRAINT gift_cards_barcode_format_check
      CHECK (barcode_format IS NULL OR barcode_format IN ('code128', 'qrcode', 'ean13', 'pdf417'));
  END IF;
END $$;

ALTER TABLE public.gift_card_activity
  ADD COLUMN IF NOT EXISTS merchant TEXT;

ALTER TABLE public.gift_card_activity
  DROP CONSTRAINT IF EXISTS gift_card_activity_kind_check;
ALTER TABLE public.gift_card_activity
  ADD CONSTRAINT gift_card_activity_kind_check
  CHECK (kind IN ('added', 'spend', 'topup', 'adjustment', 'removed', 'restored', 'archived', 'unarchived'));

ALTER TABLE public.gift_card_activity
  DROP CONSTRAINT IF EXISTS gift_card_activity_merchant_len;
ALTER TABLE public.gift_card_activity
  ADD CONSTRAINT gift_card_activity_merchant_len CHECK (merchant IS NULL OR char_length(merchant) <= 120);

-- Timeline reads are per user, newest first.
CREATE INDEX IF NOT EXISTS idx_gift_card_activity_user
  ON public.gift_card_activity(user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

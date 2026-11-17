-- Gift Cards redesign: scannable barcodes + "mark used / archive".
--
-- barcode_format: how the stored card_number is rendered at checkout.
--   NULL means the app default (Code 128), so existing rows need no backfill.
-- archived_at: set when the user marks a card used/archived. Archived cards
--   leave the active list and totals but stay restorable; this is separate
--   from deleted_at (Removed cards).
--
-- Idempotent (IF NOT EXISTS / guarded constraint) so it is safe to re-run.
-- Existing RLS on public.gift_cards (own rows only) already covers both
-- columns; no policy changes.

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

-- Archive is a usage-trail event too.
ALTER TABLE public.gift_card_activity
  DROP CONSTRAINT IF EXISTS gift_card_activity_kind_check;
ALTER TABLE public.gift_card_activity
  ADD CONSTRAINT gift_card_activity_kind_check
  CHECK (kind IN ('added', 'spend', 'adjustment', 'removed', 'restored', 'archived', 'unarchived'));

NOTIFY pgrst, 'reload schema';

-- Production drift repair: public.update_updated_at_column().
--
-- Defined in 20260601172002_*.sql, but missing on the live project. It was
-- created there by hand on 2026-10-20 (same definition) before
-- 20261020130000 / 20261020130200 / 20261020140100, whose updated_at triggers
-- depend on it. This migration records it. Idempotent (CREATE OR REPLACE).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Card 04: storno invoice number per ticket (additive).
-- rk_tickets.tacito_storno_number stores the number of the issued storno
-- (cancellation) invoice created when an order is refunded, so the cron never
-- stornos the same ticket twice and the dashboard can show it.
--
-- NOTE: this ALTER could NOT be applied to the live Supabase from this
-- workstation (no DB password / management token available); the cron code
-- detects the missing column and degrades gracefully (see lib/tacito-cron.ts:
-- the TACITo-side `related` check is the authoritative storno state).
-- Run once against the live project when applying migrations.

alter table public.rk_tickets
  add column if not exists tacito_storno_number text;

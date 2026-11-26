-- Kedvezménykódok (card 12, 2026-11-25) — Stripe Promotion Codes as the engine.
-- Same rules as the other rk_* tables: RLS on, NO policies (service role only).
--
-- One row = one Stripe coupon + promotion code pair. `concert_id` null means
-- the code is valid for every concert. The buyer-facing `code` is stored
-- uppercase, unique. `times_redeemed` is incremented by the fulfilment when a
-- paid session redeems the code (our own counter; Stripe tracks its own too).
-- Codes are immutable once created — deactivation flips `active` on both the
-- Stripe objects and this row; rows are never deleted (history stays).

create table if not exists public.rk_discount_codes (
  id uuid primary key default gen_random_uuid(),
  concert_id text references public.rk_concerts(concert_id) on delete cascade, -- null = minden koncertre
  code text not null,                 -- what the buyer types, stored uppercase
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null,
  percent_off integer,                -- exactly one of percent_off / amount_off_huf is set
  amount_off_huf integer,
  max_redemptions integer,            -- null = unlimited
  times_redeemed integer not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code)
);
alter table public.rk_discount_codes enable row level security;
create index if not exists rk_discount_codes_concert_idx on public.rk_discount_codes (concert_id);

alter table public.rk_orders add column if not exists discount_code text;
alter table public.rk_orders add column if not exists discount_huf integer not null default 0;

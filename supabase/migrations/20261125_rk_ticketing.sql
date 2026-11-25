-- Réz körút ticketing schema (2026-11-25)
-- All tables are service-role only: RLS on, no policies. Never expose via anon key.

create table if not exists public.rk_concerts (
  concert_id      text primary key,
  title           text not null,
  event_date      date,
  event_time      text,
  location        text,
  venue           text,
  status          text not null default 'draft'
                  check (status in ('draft','on_sale','sold_out','closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.rk_ticket_types (
  id                uuid primary key default gen_random_uuid(),
  concert_id        text not null references public.rk_concerts(concert_id) on delete cascade,
  name              text not null,
  kind              text not null default 'standard' check (kind in ('standard','early_bird')),
  price_huf         integer not null check (price_huf >= 0),
  capacity          integer check (capacity is null or capacity >= 0),
  sold              integer not null default 0,
  stripe_price_id   text,
  stripe_lookup_key text unique,
  sales_start       timestamptz,
  sales_end         timestamptz,
  active            boolean not null default true,
  sort              integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists rk_ticket_types_concert_idx on public.rk_ticket_types (concert_id, sort);

create table if not exists public.rk_orders (
  id                    uuid primary key default gen_random_uuid(),
  concert_id            text not null references public.rk_concerts(concert_id),
  buyer_name            text,
  buyer_email           text,
  buyer_phone           text,
  buyer_company         text,
  buyer_tax_number      text,
  address_country       text default 'HU',
  address_postal        text,
  address_city          text,
  address_street        text,
  amount_huf            integer not null,
  currency              text not null default 'HUF',
  stripe_session_id     text unique,
  stripe_payment_intent text,
  status                text not null default 'pending'
                        check (status in ('pending','paid','refunded','expired','failed')),
  paid_at               timestamptz,
  refunded_at           timestamptz,
  tacito_error          text,
  created_at            timestamptz not null default now()
);
create index if not exists rk_orders_concert_idx on public.rk_orders (concert_id, created_at desc);

create table if not exists public.rk_tickets (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.rk_orders(id) on delete cascade,
  concert_id            text not null references public.rk_concerts(concert_id),
  ticket_type_id        uuid references public.rk_ticket_types(id),
  ticket_type_name      text,
  price_huf             integer not null,
  code                  text not null unique,
  status                text not null default 'valid' check (status in ('valid','used','void')),
  used_at               timestamptz,
  tacito_invoice_id     text,
  tacito_invoice_number text,
  tacito_nav_outcome    text,
  tacito_error          text,
  emailed_at            timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists rk_tickets_order_idx on public.rk_tickets (order_id);
create index if not exists rk_tickets_concert_idx on public.rk_tickets (concert_id, status);

create table if not exists public.rk_tacito_cursor (
  id          integer primary key default 1 check (id = 1),
  next_cursor text,
  updated_at  timestamptz not null default now()
);
insert into public.rk_tacito_cursor (id, next_cursor) values (1, null)
  on conflict (id) do nothing;

alter table public.rk_concerts      enable row level security;
alter table public.rk_ticket_types  enable row level security;
alter table public.rk_orders        enable row level security;
alter table public.rk_tickets       enable row level security;
alter table public.rk_tacito_cursor enable row level security;
-- deliberately NO policies: anon/authenticated cannot read or write. service_role bypasses RLS.

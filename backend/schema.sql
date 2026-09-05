-- Supabase schema for the hosted tier (spec §8.2–8.4).
-- Apply with: supabase db push (or paste into the SQL editor).

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  created_at timestamptz not null default now()
);

-- Device-code sign-in (§8.1b). Codes are short-lived and single-use.
create table if not exists device_codes (
  device_code uuid primary key default gen_random_uuid(),
  user_code text unique not null,
  user_id uuid references users(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'consumed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Credit balances. One row per user; the ONLY writer is the atomic debit
-- below or an explicit top-up — never check-then-act (§8.3).
create table if not exists balances (
  user_id uuid primary key references users(id),
  balance integer not null default 0 check (balance >= 0),
  plan text not null default 'trial',
  updated_at timestamptz not null default now()
);

-- Metadata-only usage ledger (§8.4): never prompt content, never page text.
create table if not exists usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id),
  ts timestamptz not null default now(),
  model text not null,
  prompt_tokens integer not null,
  cached_tokens integer not null default 0,
  completion_tokens integer not null,
  credits integer not null,
  latency_ms integer,
  step_number integer,
  fingerprint text
);

create index if not exists usage_ledger_user_ts on usage_ledger (user_id, ts desc);

-- Refresh tokens: 30 days, rotating (§8.1b). Stored hashed.
create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Atomic conditional debit (§8.3). Returns the new balance, or -1 when the
-- balance is insufficient — one statement, no race, no reservation records.
create or replace function debit(p_user_id uuid, p_cost integer)
returns integer
language sql
as $$
  update balances
     set balance = balance - p_cost,
         updated_at = now()
   where user_id = p_user_id
     and balance >= p_cost
  returning balance;
$$;

-- Top-up: additive, idempotent per payment reference.
create or replace function top_up(p_user_id uuid, p_amount integer, p_reference text)
returns integer
language sql
as $$
  insert into usage_ledger (user_id, model, prompt_tokens, completion_tokens, credits, fingerprint)
  values (p_user_id, 'topup:' || p_reference, 0, 0, -p_amount, null)
  on conflict do nothing;
  update balances
     set balance = balance + p_amount,
         updated_at = now()
   where user_id = p_user_id
  returning balance;
$$;

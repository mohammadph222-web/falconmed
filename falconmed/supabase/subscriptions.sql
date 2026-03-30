create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('starter', 'professional', 'enterprise')),
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists subscriptions_user_id_created_at_idx
  on public.subscriptions (user_id, created_at desc);

alter table public.subscriptions enable row level security;

create policy "users can view own subscription"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

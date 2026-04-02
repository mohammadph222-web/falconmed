-- FalconMed Stock Movement Ledger (V1)
-- Run this in Supabase SQL editor if stock_movements does not exist yet.

create extension if not exists pgcrypto;

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null,
  drug_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  from_pharmacy text,
  to_pharmacy text,
  batch_no text,
  expiry_date date,
  reference_no text,
  notes text,
  created_by text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists stock_movements_created_at_idx
  on public.stock_movements (created_at desc);

create index if not exists stock_movements_drug_name_idx
  on public.stock_movements (drug_name);

create index if not exists stock_movements_reference_no_idx
  on public.stock_movements (reference_no);

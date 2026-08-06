-- General Ledger chart of accounts (admin settings)
-- Safe to re-run. Seed rows use ON CONFLICT DO NOTHING on account_code.

create table if not exists public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name text not null,
  account_type text not null
    check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance text not null default 'debit'
    check (normal_balance in ('debit', 'credit')),
  description text,
  is_active boolean not null default true,
  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gl_accounts_type_idx on public.gl_accounts (account_type);
create index if not exists gl_accounts_active_idx on public.gl_accounts (is_active);
create index if not exists gl_accounts_sort_idx on public.gl_accounts (sort_order, account_code);

-- Default posting map: operational purpose → GL account used by batch export / reports
create table if not exists public.gl_posting_defaults (
  id uuid primary key default gen_random_uuid(),
  purpose text not null unique,
  gl_account_id uuid references public.gl_accounts (id) on delete set null,
  label text not null,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.gl_accounts enable row level security;
alter table public.gl_posting_defaults enable row level security;

drop policy if exists "auth all gl_accounts" on public.gl_accounts;
create policy "auth all gl_accounts"
  on public.gl_accounts for all to authenticated
  using (true) with check (true);

drop policy if exists "auth all gl_posting_defaults" on public.gl_posting_defaults;
create policy "auth all gl_posting_defaults"
  on public.gl_posting_defaults for all to authenticated
  using (true) with check (true);

comment on table public.gl_accounts is
  'Chart of accounts for EquipmentIQ GL export and reporting mappings.';
comment on table public.gl_posting_defaults is
  'Maps operational posting purposes (AR, cash, revenue, tax, COGS) to GL accounts.';

-- Seed standard service-company accounts
insert into public.gl_accounts (account_code, account_name, account_type, normal_balance, description, is_system, sort_order)
values
  ('1000', 'Cash', 'asset', 'debit', 'Operating cash', true, 10),
  ('1050', 'Undeposited Funds', 'asset', 'debit', 'Collections pending bank deposit', true, 15),
  ('1200', 'Accounts Receivable', 'asset', 'debit', 'Customer balances', true, 20),
  ('1210', 'Allowance for Credit Losses', 'asset', 'credit', 'Contra AR (CECL proxy)', true, 25),
  ('1300', 'Inventory — Parts', 'asset', 'debit', 'Parts at cost', true, 30),
  ('1400', 'Contract Assets / Unbilled AR', 'asset', 'debit', 'Completed unbilled work', true, 40),
  ('1500', 'Equipment (soft register)', 'asset', 'debit', 'Soft capital estimate from equipment register', true, 50),
  ('2000', 'Sales Tax Payable', 'liability', 'credit', 'Collected sales tax due to tax authority', true, 60),
  ('2100', 'Accounts Payable', 'liability', 'credit', 'Vendor payables (if used)', true, 70),
  ('3000', 'Owner Equity', 'equity', 'credit', 'Residual equity plug', true, 80),
  ('4000', 'Service Revenue', 'revenue', 'credit', 'Recognized service sales (ex-tax)', true, 90),
  ('4100', 'Parts Revenue', 'revenue', 'credit', 'Parts billed on invoices (if split)', true, 95),
  ('5000', 'Cost of Services — Labor', 'expense', 'debit', 'Technician labor cost matched to jobs', true, 100),
  ('5100', 'Cost of Services — Parts', 'expense', 'debit', 'Parts cost matched to jobs', true, 110),
  ('5200', 'Bad Debt Expense', 'expense', 'debit', 'Credit loss provision', true, 120),
  ('6000', 'Operating Expenses', 'expense', 'debit', 'Other operating costs (placeholder)', true, 130)
on conflict (account_code) do nothing;

-- Wire posting defaults when empty
insert into public.gl_posting_defaults (purpose, label, description, gl_account_id)
select v.purpose, v.label, v.description, a.id
from (
  values
    ('cash', 'Cash', 'Bank cash balance presentation'),
    ('undeposited_funds', 'Undeposited Funds', 'Customer collections before deposit batching'),
    ('accounts_receivable', 'Accounts Receivable', 'Invoice AR balance'),
    ('allowance_credit_losses', 'Allowance for Credit Losses', 'Contra AR allowance'),
    ('inventory', 'Inventory', 'Parts inventory asset'),
    ('contract_assets', 'Contract Assets', 'Unbilled completed work'),
    ('sales_tax_payable', 'Sales Tax Payable', 'Tax liability on invoices'),
    ('accounts_payable', 'Accounts Payable', 'Vendor AP when used'),
    ('equity', 'Equity', 'Residual equity on balance sheet'),
    ('service_revenue', 'Service Revenue', 'Recognized invoice revenue ex-tax'),
    ('parts_revenue', 'Parts Revenue', 'Parts component of sales (optional)'),
    ('cogs_labor', 'COGS — Labor', 'Labor cost matched to revenue'),
    ('cogs_parts', 'COGS — Parts', 'Parts cost matched to revenue'),
    ('bad_debt_expense', 'Bad Debt Expense', 'Credit loss expense')
) as v(purpose, label, description)
left join public.gl_accounts a on a.account_code = case v.purpose
  when 'cash' then '1000'
  when 'undeposited_funds' then '1050'
  when 'accounts_receivable' then '1200'
  when 'allowance_credit_losses' then '1210'
  when 'inventory' then '1300'
  when 'contract_assets' then '1400'
  when 'sales_tax_payable' then '2000'
  when 'accounts_payable' then '2100'
  when 'equity' then '3000'
  when 'service_revenue' then '4000'
  when 'parts_revenue' then '4100'
  when 'cogs_labor' then '5000'
  when 'cogs_parts' then '5100'
  when 'bad_debt_expense' then '5200'
end
where not exists (
  select 1 from public.gl_posting_defaults d where d.purpose = v.purpose
);

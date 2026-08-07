/**
 * Chart of accounts helpers (admin Settings → GL Accounts).
 * Falls back to browser localStorage when Supabase tables are not installed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GlAccount, GlAccountType, GlNormalBalance, GlPostingDefault } from "@/lib/types";

const KEY_ACCOUNTS = "equipmentiq_gl_accounts_v1";
const KEY_DEFAULTS = "equipmentiq_gl_posting_defaults_v1";

export const GL_ACCOUNT_TYPES: GlAccountType[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];

export const GL_POSTING_PURPOSES: { purpose: string; label: string; description: string }[] = [
  { purpose: "cash", label: "Cash", description: "Bank / operating cash" },
  { purpose: "undeposited_funds", label: "Undeposited Funds", description: "Collections before deposit" },
  { purpose: "accounts_receivable", label: "Accounts Receivable", description: "Open customer balances" },
  {
    purpose: "allowance_credit_losses",
    label: "Allowance for Credit Losses",
    description: "Contra AR allowance",
  },
  { purpose: "inventory", label: "Inventory", description: "Parts on hand" },
  { purpose: "contract_assets", label: "Contract Assets", description: "Unbilled completed work" },
  { purpose: "sales_tax_payable", label: "Sales Tax Payable", description: "Tax liability" },
  { purpose: "accounts_payable", label: "Accounts Payable", description: "Vendor AP" },
  { purpose: "equity", label: "Equity", description: "Owner equity residual" },
  { purpose: "service_revenue", label: "Service Revenue", description: "Recognized service sales" },
  { purpose: "parts_revenue", label: "Parts Revenue", description: "Parts billed (optional split)" },
  { purpose: "cogs_labor", label: "COGS — Labor Cost", description: "Technician hours at cost rates" },
  { purpose: "cogs_parts", label: "COGS — Parts Expense", description: "Parts cost of services" },
  { purpose: "bad_debt_expense", label: "Bad Debt Expense", description: "Credit loss expense" },
];

const SEED_ACCOUNTS: Omit<GlAccount, "id" | "created_at" | "updated_at">[] = [
  {
    account_code: "1000",
    account_name: "Cash",
    account_type: "asset",
    normal_balance: "debit",
    description: "Operating cash",
    is_active: true,
    is_system: true,
    sort_order: 10,
  },
  {
    account_code: "1050",
    account_name: "Undeposited Funds",
    account_type: "asset",
    normal_balance: "debit",
    description: "Collections pending bank deposit",
    is_active: true,
    is_system: true,
    sort_order: 15,
  },
  {
    account_code: "1200",
    account_name: "Accounts Receivable",
    account_type: "asset",
    normal_balance: "debit",
    description: "Customer balances",
    is_active: true,
    is_system: true,
    sort_order: 20,
  },
  {
    account_code: "1210",
    account_name: "Allowance for Credit Losses",
    account_type: "asset",
    normal_balance: "credit",
    description: "Contra AR (CECL proxy)",
    is_active: true,
    is_system: true,
    sort_order: 25,
  },
  {
    account_code: "1300",
    account_name: "Inventory — Parts",
    account_type: "asset",
    normal_balance: "debit",
    description: "Parts at cost",
    is_active: true,
    is_system: true,
    sort_order: 30,
  },
  {
    account_code: "1400",
    account_name: "Contract Assets / Unbilled AR",
    account_type: "asset",
    normal_balance: "debit",
    description: "Completed unbilled work",
    is_active: true,
    is_system: true,
    sort_order: 40,
  },
  {
    account_code: "1500",
    account_name: "Equipment (soft register)",
    account_type: "asset",
    normal_balance: "debit",
    description: "Soft capital estimate",
    is_active: true,
    is_system: true,
    sort_order: 50,
  },
  {
    account_code: "2000",
    account_name: "Sales Tax Payable",
    account_type: "liability",
    normal_balance: "credit",
    description: "Collected sales tax",
    is_active: true,
    is_system: true,
    sort_order: 60,
  },
  {
    account_code: "2100",
    account_name: "Accounts Payable",
    account_type: "liability",
    normal_balance: "credit",
    description: "Vendor payables",
    is_active: true,
    is_system: true,
    sort_order: 70,
  },
  {
    account_code: "3000",
    account_name: "Owner Equity",
    account_type: "equity",
    normal_balance: "credit",
    description: "Residual equity",
    is_active: true,
    is_system: true,
    sort_order: 80,
  },
  {
    account_code: "4000",
    account_name: "Service Revenue",
    account_type: "revenue",
    normal_balance: "credit",
    description: "Recognized service sales (ex-tax)",
    is_active: true,
    is_system: true,
    sort_order: 90,
  },
  {
    account_code: "4100",
    account_name: "Parts Revenue",
    account_type: "revenue",
    normal_balance: "credit",
    description: "Parts billed on invoices",
    is_active: true,
    is_system: true,
    sort_order: 95,
  },
  {
    account_code: "5000",
    account_name: "COGS — Labor Cost",
    account_type: "expense",
    normal_balance: "debit",
    description: "Technician hours at cost rates matched to jobs",
    is_active: true,
    is_system: true,
    sort_order: 100,
  },
  {
    account_code: "5100",
    account_name: "COGS — Parts Expense",
    account_type: "expense",
    normal_balance: "debit",
    description: "Parts unit cost × quantity used on jobs",
    is_active: true,
    is_system: true,
    sort_order: 110,
  },
  {
    account_code: "5200",
    account_name: "Bad Debt Expense",
    account_type: "expense",
    normal_balance: "debit",
    description: "Credit loss provision",
    is_active: true,
    is_system: true,
    sort_order: 120,
  },
  {
    account_code: "6000",
    account_name: "Operating Expenses",
    account_type: "expense",
    normal_balance: "debit",
    description: "Other operating costs",
    is_active: true,
    is_system: true,
    sort_order: 130,
  },
];

const PURPOSE_TO_CODE: Record<string, string> = {
  cash: "1000",
  undeposited_funds: "1050",
  accounts_receivable: "1200",
  allowance_credit_losses: "1210",
  inventory: "1300",
  contract_assets: "1400",
  sales_tax_payable: "2000",
  accounts_payable: "2100",
  equity: "3000",
  service_revenue: "4000",
  parts_revenue: "4100",
  cogs_labor: "5000",
  cogs_parts: "5100",
  bad_debt_expense: "5200",
};

export function isGlSchemaError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find the table") ||
    m.includes("pgrst205") ||
    m.includes("42p01") ||
    (m.includes("gl_accounts") && m.includes("not find"))
  );
}

export function defaultNormalBalance(type: GlAccountType): GlNormalBalance {
  if (type === "asset" || type === "expense") return "debit";
  return "credit";
}

export function formatGlAccountLabel(a: Pick<GlAccount, "account_code" | "account_name">): string {
  return `${a.account_code} · ${a.account_name}`;
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `gl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureLocalSeed() {
  let accounts = readJson<GlAccount[]>(KEY_ACCOUNTS, []);
  if (accounts.length === 0) {
    const now = new Date().toISOString();
    accounts = SEED_ACCOUNTS.map((row) => ({
      ...row,
      id: uid(),
      created_at: now,
      updated_at: now,
    }));
    writeJson(KEY_ACCOUNTS, accounts);
  }

  let defaults = readJson<GlPostingDefault[]>(KEY_DEFAULTS, []);
  if (defaults.length === 0) {
    const byCode = new Map(accounts.map((a) => [a.account_code, a]));
    const now = new Date().toISOString();
    defaults = GL_POSTING_PURPOSES.map((p) => {
      const code = PURPOSE_TO_CODE[p.purpose];
      const acc = code ? byCode.get(code) : undefined;
      return {
        id: uid(),
        purpose: p.purpose,
        gl_account_id: acc?.id ?? null,
        label: p.label,
        description: p.description,
        updated_at: now,
      };
    });
    writeJson(KEY_DEFAULTS, defaults);
  }
  return { accounts, defaults };
}

let storageMode: "unknown" | "remote" | "local" = "unknown";

export function isUsingLocalGlStore(): boolean {
  return storageMode === "local";
}

export async function detectGlStorageMode(supabase: SupabaseClient): Promise<"remote" | "local"> {
  if (storageMode === "remote" || storageMode === "local") return storageMode;
  const { error } = await supabase.from("gl_accounts").select("id").limit(1);
  if (error && isGlSchemaError(error.message)) {
    storageMode = "local";
    ensureLocalSeed();
    return "local";
  }
  storageMode = "remote";
  return "remote";
}

export async function listGlAccounts(
  supabase: SupabaseClient,
): Promise<{ data: GlAccount[]; error: string | null; local: boolean }> {
  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    const { accounts } = ensureLocalSeed();
    return {
      data: [...accounts].sort((a, b) => a.sort_order - b.sort_order || a.account_code.localeCompare(b.account_code)),
      error: null,
      local: true,
    };
  }
  const { data, error } = await supabase
    .from("gl_accounts")
    .select("*")
    .order("sort_order")
    .order("account_code");
  if (error) {
    if (isGlSchemaError(error.message)) {
      storageMode = "local";
      return listGlAccounts(supabase);
    }
    return { data: [], error: error.message, local: false };
  }
  return { data: (data as GlAccount[]) ?? [], error: null, local: false };
}

export async function listGlPostingDefaults(
  supabase: SupabaseClient,
): Promise<{ data: GlPostingDefault[]; error: string | null }> {
  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    const { defaults } = ensureLocalSeed();
    return { data: defaults, error: null };
  }
  const { data, error } = await supabase.from("gl_posting_defaults").select("*").order("purpose");
  if (error) {
    if (isGlSchemaError(error.message)) {
      storageMode = "local";
      return listGlPostingDefaults(supabase);
    }
    return { data: [], error: error.message };
  }
  return { data: (data as GlPostingDefault[]) ?? [], error: null };
}

export type CreateGlAccountInput = {
  account_code: string;
  account_name: string;
  account_type: GlAccountType;
  normal_balance?: GlNormalBalance;
  description?: string | null;
  sort_order?: number;
};

export async function createGlAccount(
  supabase: SupabaseClient,
  input: CreateGlAccountInput,
): Promise<{ data: GlAccount | null; error: string | null }> {
  const code = input.account_code.trim();
  const name = input.account_name.trim();
  if (!code || !name) return { data: null, error: "Account code and name are required." };

  const row = {
    account_code: code,
    account_name: name,
    account_type: input.account_type,
    normal_balance: input.normal_balance ?? defaultNormalBalance(input.account_type),
    description: input.description?.trim() || null,
    is_active: true,
    is_system: false,
    sort_order: input.sort_order ?? 200,
    updated_at: new Date().toISOString(),
  };

  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    const { accounts } = ensureLocalSeed();
    if (accounts.some((a) => a.account_code === code)) {
      return { data: null, error: "Account code already exists." };
    }
    const now = new Date().toISOString();
    const created: GlAccount = { ...row, id: uid(), created_at: now, updated_at: now };
    writeJson(KEY_ACCOUNTS, [...accounts, created]);
    return { data: created, error: null };
  }

  const { data, error } = await supabase.from("gl_accounts").insert(row).select("*").single();
  if (error) {
    if (isGlSchemaError(error.message)) {
      storageMode = "local";
      return createGlAccount(supabase, input);
    }
    return { data: null, error: error.message };
  }
  return { data: data as GlAccount, error: null };
}

export async function updateGlAccount(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<
    Pick<
      GlAccount,
      | "account_code"
      | "account_name"
      | "account_type"
      | "normal_balance"
      | "description"
      | "is_active"
      | "sort_order"
    >
  >,
): Promise<{ error: string | null }> {
  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    const { accounts } = ensureLocalSeed();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx < 0) return { error: "Account not found." };
    if (patch.account_code != null) {
      const code = patch.account_code.trim();
      const clash = accounts.some((a) => a.id !== id && a.account_code === code);
      if (clash) return { error: "Account code already exists." };
    }
    accounts[idx] = {
      ...accounts[idx],
      ...patch,
      account_code: patch.account_code?.trim() ?? accounts[idx].account_code,
      account_name: patch.account_name?.trim() ?? accounts[idx].account_name,
      description:
        patch.description === undefined ? accounts[idx].description : patch.description?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    writeJson(KEY_ACCOUNTS, accounts);
    return { error: null };
  }

  const { error } = await supabase
    .from("gl_accounts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    if (isGlSchemaError(error.message)) {
      storageMode = "local";
      return updateGlAccount(supabase, id, patch);
    }
    return { error: error.message };
  }
  return { error: null };
}

export async function deleteGlAccount(
  supabase: SupabaseClient,
  id: string,
): Promise<{ error: string | null }> {
  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    const { accounts, defaults } = ensureLocalSeed();
    const acc = accounts.find((a) => a.id === id);
    if (!acc) return { error: "Account not found." };
    if (acc.is_system) return { error: "System accounts cannot be deleted. Deactivate instead." };
    writeJson(
      KEY_ACCOUNTS,
      accounts.filter((a) => a.id !== id),
    );
    writeJson(
      KEY_DEFAULTS,
      defaults.map((d) => (d.gl_account_id === id ? { ...d, gl_account_id: null } : d)),
    );
    return { error: null };
  }

  const { data: acc } = await supabase.from("gl_accounts").select("is_system").eq("id", id).maybeSingle();
  if (acc?.is_system) return { error: "System accounts cannot be deleted. Deactivate instead." };

  const { error } = await supabase.from("gl_accounts").delete().eq("id", id);
  if (error) {
    if (isGlSchemaError(error.message)) {
      storageMode = "local";
      return deleteGlAccount(supabase, id);
    }
    return { error: error.message };
  }
  return { error: null };
}

export async function setPostingDefaultAccount(
  supabase: SupabaseClient,
  purpose: string,
  glAccountId: string | null,
): Promise<{ error: string | null }> {
  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    const { defaults } = ensureLocalSeed();
    const idx = defaults.findIndex((d) => d.purpose === purpose);
    if (idx < 0) return { error: "Unknown posting purpose." };
    defaults[idx] = {
      ...defaults[idx],
      gl_account_id: glAccountId,
      updated_at: new Date().toISOString(),
    };
    writeJson(KEY_DEFAULTS, defaults);
    return { error: null };
  }

  const { error } = await supabase
    .from("gl_posting_defaults")
    .update({ gl_account_id: glAccountId, updated_at: new Date().toISOString() })
    .eq("purpose", purpose);
  if (error) {
    if (isGlSchemaError(error.message)) {
      storageMode = "local";
      return setPostingDefaultAccount(supabase, purpose, glAccountId);
    }
    return { error: error.message };
  }
  return { error: null };
}

export async function ensureGlSeed(
  supabase: SupabaseClient,
): Promise<{ error: string | null; local: boolean }> {
  const mode = await detectGlStorageMode(supabase);
  if (mode === "local") {
    ensureLocalSeed();
    return { error: null, local: true };
  }

  const { count } = await supabase.from("gl_accounts").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return { error: null, local: false };

  // Insert seeds if table empty (migration may have only created schema)
  for (const row of SEED_ACCOUNTS) {
    const { error } = await supabase.from("gl_accounts").upsert(
      {
        account_code: row.account_code,
        account_name: row.account_name,
        account_type: row.account_type,
        normal_balance: row.normal_balance,
        description: row.description,
        is_active: true,
        is_system: true,
        sort_order: row.sort_order,
      },
      { onConflict: "account_code" },
    );
    if (error && !isGlSchemaError(error.message)) {
      return { error: error.message, local: false };
    }
  }

  const { data: accounts } = await supabase.from("gl_accounts").select("id, account_code");
  const byCode = new Map((accounts ?? []).map((a: { id: string; account_code: string }) => [a.account_code, a.id]));

  for (const p of GL_POSTING_PURPOSES) {
    const code = PURPOSE_TO_CODE[p.purpose];
    const glId = code ? byCode.get(code) ?? null : null;
    await supabase.from("gl_posting_defaults").upsert(
      {
        purpose: p.purpose,
        label: p.label,
        description: p.description,
        gl_account_id: glId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "purpose" },
    );
  }

  return { error: null, local: false };
}

/**
 * Browser-local general ledger: periods, journal entries, lines.
 * Mirrors batches-local — persists per-origin until a cloud GL exists.
 */

import { accountName, ACCOUNT_BY_CODE } from "@/lib/accounting/coa";

const KEY_PERIODS = "ridley_accounting_periods_v1";
const KEY_JOURNALS = "ridley_accounting_journals_v1";
const KEY_LINES = "ridley_accounting_journal_lines_v1";
const KEY_META = "ridley_accounting_meta_v1";

export type PeriodStatus = "Open" | "Soft Closed" | "Closed";

export type AccountingPeriod = {
  id: string;
  period: string; // YYYY-MM
  status: PeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalSource =
  | "batch"
  | "deferred"
  | "tax_remittance"
  | "allowance"
  | "credit_memo"
  | "write_off"
  | "payroll_accrual"
  | "ap_bill"
  | "ap_payment"
  | "deposit"
  | "manual"
  | "cogs";

export type JournalEntry = {
  id: string;
  entry_number: string;
  entry_date: string;
  period: string;
  source: JournalSource;
  source_id: string | null;
  memo: string;
  status: "Posted" | "Void";
  created_by: string | null;
  created_at: string;
  voided_at: string | null;
};

export type JournalLine = {
  id: string;
  journal_id: string;
  account_code: string;
  memo: string | null;
  debit: number;
  credit: number;
};

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `gl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

export function periodKeyFromDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function listPeriods(): AccountingPeriod[] {
  return readJson<AccountingPeriod[]>(KEY_PERIODS, []).sort((a, b) => b.period.localeCompare(a.period));
}

export function getPeriod(period: string): AccountingPeriod | null {
  return listPeriods().find((p) => p.period === period) ?? null;
}

export function ensurePeriod(period: string): AccountingPeriod {
  const existing = getPeriod(period);
  if (existing) return existing;
  const now = new Date().toISOString();
  const row: AccountingPeriod = {
    id: uid(),
    period,
    status: "Open",
    closed_at: null,
    closed_by: null,
    notes: null,
    created_at: now,
    updated_at: now,
  };
  writeJson(KEY_PERIODS, [row, ...listPeriods()]);
  return row;
}

export function isPeriodClosed(period: string): boolean {
  return getPeriod(period)?.status === "Closed";
}

export function setPeriodStatus(
  period: string,
  status: PeriodStatus,
  userId: string | null,
  notes?: string | null,
): { ok: true; period: AccountingPeriod } | { ok: false; error: string } {
  ensurePeriod(period);
  const rows = listPeriods();
  const idx = rows.findIndex((p) => p.period === period);
  if (idx < 0) return { ok: false, error: "Period not found." };
  const now = new Date().toISOString();
  rows[idx] = {
    ...rows[idx],
    status,
    closed_at: status === "Closed" ? now : status === "Open" ? null : rows[idx].closed_at,
    closed_by: status === "Closed" ? userId : status === "Open" ? null : rows[idx].closed_by,
    notes: notes ?? rows[idx].notes,
    updated_at: now,
  };
  writeJson(KEY_PERIODS, rows);
  return { ok: true, period: rows[idx] };
}

export function listJournals(): JournalEntry[] {
  return readJson<JournalEntry[]>(KEY_JOURNALS, []).sort((a, b) => {
    const d = (b.entry_date || "").localeCompare(a.entry_date || "");
    if (d !== 0) return d;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export function listJournalLines(journalId?: string): JournalLine[] {
  const all = readJson<JournalLine[]>(KEY_LINES, []);
  return journalId ? all.filter((l) => l.journal_id === journalId) : all;
}

export function getJournal(id: string): JournalEntry | null {
  return listJournals().find((j) => j.id === id) ?? null;
}

function nextEntryNumber(source: JournalSource): string {
  const prefix =
    source === "batch"
      ? "JE-B"
      : source === "deferred"
        ? "JE-D"
        : source === "tax_remittance"
          ? "JE-T"
          : source === "allowance"
            ? "JE-A"
            : source === "credit_memo"
              ? "JE-C"
              : source === "write_off"
                ? "JE-W"
                : source === "payroll_accrual"
                  ? "JE-P"
                  : source === "ap_bill"
                    ? "JE-V"
                    : source === "ap_payment"
                      ? "JE-VP"
                      : source === "deposit"
                        ? "JE-U"
                        : "JE";
  const meta = readJson<{ seq: number }>(KEY_META, { seq: 1000 });
  meta.seq += 1;
  writeJson(KEY_META, meta);
  return `${prefix}-${meta.seq}`;
}

export type PostJournalInput = {
  entryDate: string;
  source: JournalSource;
  sourceId?: string | null;
  memo: string;
  lines: { accountCode: string; debit?: number; credit?: number; memo?: string | null }[];
  userId: string | null;
  allowClosedPeriod?: boolean;
};

export function postJournal(
  input: PostJournalInput,
): { ok: true; journal: JournalEntry } | { ok: false; error: string } {
  const period = periodKeyFromDate(input.entryDate);
  ensurePeriod(period);
  if (!input.allowClosedPeriod && isPeriodClosed(period)) {
    return { ok: false, error: `Period ${period} is closed. Re-open it before posting.` };
  }

  const normalized = input.lines
    .map((l) => ({
      accountCode: l.accountCode,
      debit: Math.round((Number(l.debit) || 0) * 100) / 100,
      credit: Math.round((Number(l.credit) || 0) * 100) / 100,
      memo: l.memo ?? null,
    }))
    .filter((l) => l.debit > 0.0001 || l.credit > 0.0001);

  if (normalized.length < 2) return { ok: false, error: "Journal needs at least two lines." };
  for (const l of normalized) {
    if (!ACCOUNT_BY_CODE[l.accountCode]) {
      return { ok: false, error: `Unknown account ${l.accountCode}.` };
    }
    if (l.debit > 0 && l.credit > 0) {
      return { ok: false, error: "A line cannot have both debit and credit." };
    }
  }
  const debits = normalized.reduce((s, l) => s + l.debit, 0);
  const credits = normalized.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(debits - credits) > 0.02) {
    return {
      ok: false,
      error: `Journal out of balance (DR ${debits.toFixed(2)} vs CR ${credits.toFixed(2)}).`,
    };
  }

  if (input.sourceId) {
    const dup = listJournals().find(
      (j) => j.status === "Posted" && j.source === input.source && j.source_id === input.sourceId,
    );
    if (dup) return { ok: false, error: `Already posted as ${dup.entry_number}.` };
  }

  const now = new Date().toISOString();
  const journal: JournalEntry = {
    id: uid(),
    entry_number: nextEntryNumber(input.source),
    entry_date: input.entryDate.slice(0, 10),
    period,
    source: input.source,
    source_id: input.sourceId ?? null,
    memo: input.memo.trim() || "Journal entry",
    status: "Posted",
    created_by: input.userId,
    created_at: now,
    voided_at: null,
  };

  writeJson(KEY_JOURNALS, [journal, ...listJournals()]);
  writeJson(KEY_LINES, [
    ...listJournalLines(),
    ...normalized.map((l) => ({
      id: uid(),
      journal_id: journal.id,
      account_code: l.accountCode,
      memo: l.memo,
      debit: l.debit,
      credit: l.credit,
    })),
  ]);

  return { ok: true, journal };
}

export function voidJournal(
  journalId: string,
  userId: string | null,
): { ok: true } | { ok: false; error: string } {
  const journals = listJournals();
  const idx = journals.findIndex((j) => j.id === journalId);
  if (idx < 0) return { ok: false, error: "Journal not found." };
  const je = journals[idx];
  if (je.status === "Void") return { ok: false, error: "Already voided." };
  if (isPeriodClosed(je.period)) {
    return { ok: false, error: `Period ${je.period} is closed.` };
  }
  // Reverse entry
  const lines = listJournalLines(journalId);
  const rev = postJournal({
    entryDate: je.entry_date,
    source: "manual",
    sourceId: `void:${journalId}`,
    memo: `Void ${je.entry_number}: ${je.memo}`,
    userId,
    lines: lines.map((l) => ({
      accountCode: l.account_code,
      debit: l.credit,
      credit: l.debit,
      memo: `Reversal of ${je.entry_number}`,
    })),
  });
  if (!rev.ok) return rev;
  journals[idx] = { ...je, status: "Void", voided_at: new Date().toISOString() };
  writeJson(KEY_JOURNALS, journals);
  return { ok: true };
}

export type TrialBalanceRow = {
  accountCode: string;
  accountName: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};

/** Trial balance from posted journals through asOf (inclusive). */
export function trialBalance(asOf: string): {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
} {
  const journals = listJournals().filter(
    (j) => j.status === "Posted" && j.entry_date.slice(0, 10) <= asOf.slice(0, 10),
  );
  const ids = new Set(journals.map((j) => j.id));
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of listJournalLines()) {
    if (!ids.has(line.journal_id)) continue;
    const cur = totals.get(line.account_code) ?? { debit: 0, credit: 0 };
    cur.debit += line.debit;
    cur.credit += line.credit;
    totals.set(line.account_code, cur);
  }

  const rows: TrialBalanceRow[] = [];
  for (const [code, t] of totals) {
    const acct = ACCOUNT_BY_CODE[code];
    const balance =
      (acct?.normal ?? "debit") === "debit" ? t.debit - t.credit : t.credit - t.debit;
    rows.push({
      accountCode: code,
      accountName: accountName(code),
      type: acct?.type ?? "unknown",
      debit: Math.round(t.debit * 100) / 100,
      credit: Math.round(t.credit * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    });
  }
  rows.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return {
    rows,
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    balanced: Math.abs(totalDebit - totalCredit) < 0.05,
  };
}

export function journalsForSource(source: JournalSource, sourceId: string): JournalEntry | null {
  return (
    listJournals().find((j) => j.status === "Posted" && j.source === source && j.source_id === sourceId) ??
    null
  );
}

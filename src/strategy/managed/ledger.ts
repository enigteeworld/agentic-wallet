import fs from "fs";
import path from "path";

export const LEDGER_VERSION = 1;

const STATE_DIR = path.resolve(process.cwd(), "state/strategy");
const LEDGER_PATH = path.join(STATE_DIR, "ledger.json");

// =============================
// TYPES
// =============================

export interface StrategyUserLedgerEntry {
  wallet: string;
  shares: number;
  totalDeposited: number;
  totalWithdrawn: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyLedgerTotals {
  totalShares: number;
  totalDeposited: number;
  totalWithdrawn: number;
  updatedAt: string;
}

export interface StrategyLedgerState {
  version: number;
  users: Record<string, StrategyUserLedgerEntry>;
  totals: StrategyLedgerTotals;
}

export interface CreditDepositInput {
  wallet: string;
  amount: number;
  shares: number;
}

export interface DebitWithdrawalInput {
  wallet: string;
  amount: number;
  shares: number;
}

// =============================
// HELPERS
// =============================

function nowIso(): string {
  return new Date().toISOString();
}

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeWallet(wallet: string): string {
  return wallet.trim();
}

// =============================
// VALIDATION
// =============================

function isValidUserLedgerEntry(value: unknown): value is StrategyUserLedgerEntry {
  if (!value || typeof value !== "object") return false;

  const entry = value as StrategyUserLedgerEntry;

  return (
    typeof entry.wallet === "string" &&
    entry.wallet.length > 0 &&
    isFiniteNonNegativeNumber(entry.shares) &&
    isFiniteNonNegativeNumber(entry.totalDeposited) &&
    isFiniteNonNegativeNumber(entry.totalWithdrawn) &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

function isValidLedgerState(value: unknown): value is StrategyLedgerState {
  if (!value || typeof value !== "object") return false;

  const state = value as StrategyLedgerState;

  if (state.version !== LEDGER_VERSION) return false;
  if (!state.users || typeof state.users !== "object") return false;
  if (!state.totals || typeof state.totals !== "object") return false;

  const totalsValid =
    isFiniteNonNegativeNumber(state.totals.totalShares) &&
    isFiniteNonNegativeNumber(state.totals.totalDeposited) &&
    isFiniteNonNegativeNumber(state.totals.totalWithdrawn) &&
    typeof state.totals.updatedAt === "string";

  if (!totalsValid) return false;

  for (const entry of Object.values(state.users)) {
    if (!isValidUserLedgerEntry(entry)) {
      return false;
    }
  }

  return true;
}

// =============================
// FILE IO
// =============================

function createEmptyLedger(): StrategyLedgerState {
  const timestamp = nowIso();

  return {
    version: LEDGER_VERSION,
    users: {},
    totals: {
      totalShares: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      updatedAt: timestamp,
    },
  };
}

function writeJsonFile(filePath: string, data: StrategyLedgerState): void {
  ensureStateDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// =============================
// MAIN CLASS
// =============================

export class ManagedStrategyLedger {
  private filePath: string;

  constructor(filePath: string = LEDGER_PATH) {
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    ensureStateDir();

    if (!fs.existsSync(this.filePath)) {
      writeJsonFile(this.filePath, createEmptyLedger());
    }
  }

  load(): StrategyLedgerState {
    this.ensureFile();

    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!isValidLedgerState(parsed)) {
      throw new Error(`Invalid ledger state at ${this.filePath}`);
    }

    return parsed;
  }

  save(state: StrategyLedgerState): void {
    state.totals.updatedAt = nowIso();
    writeJsonFile(this.filePath, state);
  }

  // =============================
  // USER MANAGEMENT
  // =============================

  ensureUser(wallet: string): StrategyUserLedgerEntry {
    const normalizedWallet = normalizeWallet(wallet);

    if (!normalizedWallet) {
      throw new Error("Wallet is required");
    }

    const state = this.load();
    const existing = state.users[normalizedWallet];

    if (existing) {
      return existing;
    }

    const timestamp = nowIso();

    const created: StrategyUserLedgerEntry = {
      wallet: normalizedWallet,
      shares: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    state.users[normalizedWallet] = created;
    this.save(state);

    return created;
  }

  getUser(wallet: string): StrategyUserLedgerEntry | null {
    const state = this.load();
    return state.users[normalizeWallet(wallet)] ?? null;
  }

  listUsers(): StrategyUserLedgerEntry[] {
    const state = this.load();
    return Object.values(state.users);
  }

  // =============================
  // DEPOSIT
  // =============================

  creditDeposit(input: CreditDepositInput): StrategyLedgerState {
    const wallet = normalizeWallet(input.wallet);

    if (!wallet) {
      throw new Error("Wallet is required");
    }

    if (!isFinitePositiveNumber(input.amount)) {
      throw new Error("Deposit amount must be > 0");
    }

    if (!isFinitePositiveNumber(input.shares)) {
      throw new Error("Deposit shares must be > 0");
    }

    const state = this.load();
    const timestamp = nowIso();

    const user =
      state.users[wallet] ??
      ({
        wallet,
        shares: 0,
        totalDeposited: 0,
        totalWithdrawn: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies StrategyUserLedgerEntry);

    user.shares += input.shares;
    user.totalDeposited += input.amount;
    user.updatedAt = timestamp;

    state.users[wallet] = user;

    state.totals.totalShares += input.shares;
    state.totals.totalDeposited += input.amount;
    state.totals.updatedAt = timestamp;

    this.save(state);
    return state;
  }

  // =============================
  // WITHDRAWAL
  // =============================

  debitWithdrawal(input: DebitWithdrawalInput): StrategyLedgerState {
    const wallet = normalizeWallet(input.wallet);

    if (!wallet) {
      throw new Error("Wallet is required");
    }

    if (!isFinitePositiveNumber(input.amount)) {
      throw new Error("Withdrawal amount must be > 0");
    }

    if (!isFinitePositiveNumber(input.shares)) {
      throw new Error("Withdrawal shares must be > 0");
    }

    const state = this.load();
    const user = state.users[wallet];

    if (!user) {
      throw new Error(`User not found: ${wallet}`);
    }

    if (user.shares < input.shares) {
      throw new Error(
        `Insufficient shares. Requested=${input.shares}, Available=${user.shares}`
      );
    }

    user.shares -= input.shares;
    user.totalWithdrawn += input.amount;
    user.updatedAt = nowIso();

    state.totals.totalShares -= input.shares;
    state.totals.totalWithdrawn += input.amount;
    state.totals.updatedAt = nowIso();

    if (state.totals.totalShares < 0) {
      throw new Error("Ledger corrupted: negative totalShares");
    }

    this.save(state);
    return state;
  }

  // =============================
  // TOTALS
  // =============================

  getTotalShares(): number {
    return this.load().totals.totalShares;
  }

  getTotalDeposited(): number {
    return this.load().totals.totalDeposited;
  }

  getTotalWithdrawn(): number {
    return this.load().totals.totalWithdrawn;
  }
}

// =============================
// FACTORY
// =============================

export function createManagedStrategyLedger(
  filePath?: string
): ManagedStrategyLedger {
  return new ManagedStrategyLedger(filePath);
}
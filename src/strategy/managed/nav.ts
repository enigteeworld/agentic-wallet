import fs from "fs";
import path from "path";
import { ManagedStrategyLedger } from "./ledger";

export const NAV_VERSION = 1;
export const DEFAULT_INITIAL_SHARE_PRICE = 1;

const STATE_DIR = path.resolve(process.cwd(), "state/strategy");
const NAV_PATH = path.join(STATE_DIR, "nav.json");

// =============================
// TYPES
// =============================

export interface StrategyNavState {
  version: number;
  totalValue: number;
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals: number;
  sharePrice: number;
  updatedAt: string;
}

export interface UpdateNavInput {
  totalValue: number;
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals?: number;
}

export interface StrategyValuationSnapshot {
  totalShares: number;
  totalValue: number;
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals: number;
  sharePrice: number;
  updatedAt: string;
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

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// =============================
// VALIDATION
// =============================

function isValidNavState(value: unknown): value is StrategyNavState {
  if (!value || typeof value !== 'object') return false;

  const state = value as StrategyNavState;

  return (
    state.version === NAV_VERSION &&
    isFiniteNonNegativeNumber(state.totalValue) &&
    isFiniteNonNegativeNumber(state.liquidValue) &&
    isFiniteNonNegativeNumber(state.investedValue) &&
    isFiniteNonNegativeNumber(state.reservedForWithdrawals) &&
    isFiniteNonNegativeNumber(state.sharePrice) &&
    typeof state.updatedAt === "string"
  );
}

// =============================
// FILE IO
// =============================

function createEmptyNavState(): StrategyNavState {
  return {
    version: NAV_VERSION,
    totalValue: 0,
    liquidValue: 0,
    investedValue: 0,
    reservedForWithdrawals: 0,
    sharePrice: DEFAULT_INITIAL_SHARE_PRICE,
    updatedAt: nowIso(),
  };
}

function writeJsonFile(filePath: string, data: StrategyNavState): void {
  ensureStateDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// =============================
// MAIN CLASS
// =============================

export class ManagedStrategyNav {
  private filePath: string;
  private ledger: ManagedStrategyLedger;

  constructor(
    ledger: ManagedStrategyLedger,
    filePath: string = NAV_PATH
  ) {
    this.ledger = ledger;
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    ensureStateDir();

    if (!fs.existsSync(this.filePath)) {
      writeJsonFile(this.filePath, createEmptyNavState());
    }
  }

  load(): StrategyNavState {
    this.ensureFile();

    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!isValidNavState(parsed)) {
      throw new Error(`Invalid NAV state at ${this.filePath}`);
    }

    return parsed;
  }

  save(state: StrategyNavState): void {
    state.updatedAt = nowIso();
    writeJsonFile(this.filePath, state);
  }

  getState(): StrategyNavState {
    return this.load();
  }

  updateNav(input: UpdateNavInput): StrategyNavState {
    if (!isFiniteNonNegativeNumber(input.totalValue)) {
      throw new Error("totalValue must be a non-negative number");
    }

    if (!isFiniteNonNegativeNumber(input.liquidValue)) {
      throw new Error("liquidValue must be a non-negative number");
    }

    if (!isFiniteNonNegativeNumber(input.investedValue)) {
      throw new Error("investedValue must be a non-negative number");
    }

    const reservedForWithdrawals = input.reservedForWithdrawals ?? 0;

    if (!isFiniteNonNegativeNumber(reservedForWithdrawals)) {
      throw new Error("reservedForWithdrawals must be a non-negative number");
    }

    const recomputedTotal = input.liquidValue + input.investedValue;

    if (Math.abs(recomputedTotal - input.totalValue) > 0.000001) {
      throw new Error(
        `NAV mismatch: totalValue=${input.totalValue}, but liquidValue + investedValue=${recomputedTotal}`
      );
    }

    const totalShares = this.ledger.getTotalShares();
    const sharePrice =
      totalShares > 0
        ? input.totalValue / totalShares
        : DEFAULT_INITIAL_SHARE_PRICE;

    const nextState: StrategyNavState = {
      version: NAV_VERSION,
      totalValue: input.totalValue,
      liquidValue: input.liquidValue,
      investedValue: input.investedValue,
      reservedForWithdrawals,
      sharePrice,
      updatedAt: nowIso(),
    };

    this.save(nextState);
    return nextState;
  }

  getTotalValue(): number {
    return this.load().totalValue;
  }

  getLiquidValue(): number {
    return this.load().liquidValue;
  }

  getInvestedValue(): number {
    return this.load().investedValue;
  }

  getReservedForWithdrawals(): number {
    return this.load().reservedForWithdrawals;
  }

  getSharePrice(): number {
    const state = this.load();
    const totalShares = this.ledger.getTotalShares();

    if (totalShares <= 0) {
      return DEFAULT_INITIAL_SHARE_PRICE;
    }

    return state.totalValue / totalShares;
  }

  getValuationSnapshot(): StrategyValuationSnapshot {
    const state = this.load();
    const totalShares = this.ledger.getTotalShares();

    return {
      totalShares,
      totalValue: state.totalValue,
      liquidValue: state.liquidValue,
      investedValue: state.investedValue,
      reservedForWithdrawals: state.reservedForWithdrawals,
      sharePrice:
        totalShares > 0
          ? state.totalValue / totalShares
          : DEFAULT_INITIAL_SHARE_PRICE,
      updatedAt: state.updatedAt,
    };
  }

  estimateSharesForDeposit(amount: number): number {
    if (!isFiniteNonNegativeNumber(amount) || amount <= 0) {
      throw new Error("Deposit amount must be greater than zero");
    }

    const sharePrice = this.getSharePrice();

    if (sharePrice <= 0) {
      throw new Error("Invalid share price");
    }

    return amount / sharePrice;
  }

  estimateValueForShares(shares: number): number {
    if (!isFiniteNonNegativeNumber(shares) || shares <= 0) {
      throw new Error("Shares must be greater than zero");
    }

    return shares * this.getSharePrice();
  }
}

// =============================
// FACTORY
// =============================

export function createManagedStrategyNav(
  ledger: ManagedStrategyLedger,
  filePath?: string
): ManagedStrategyNav {
  return new ManagedStrategyNav(ledger, filePath);
}
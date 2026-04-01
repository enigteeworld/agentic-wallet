import fs from "fs";
import path from "path";
import { ManagedStrategyLedger } from "./ledger";
import { ManagedStrategyNav } from "./nav";
import { ManagedStrategyShares } from "./shares";

export const WITHDRAWALS_VERSION = 1;

const STATE_DIR = path.resolve(process.cwd(), "state/strategy");
const WITHDRAWALS_PATH = path.join(STATE_DIR, "withdrawals.json");

export type WithdrawalStatus =
  | "pending"
  | "queued"
  | "ready"
  | "completed"
  | "rejected";

export interface WithdrawalRequestRecord {
  id: string;
  wallet: string;
  requestedAmount?: number;
  requestedShares?: number;
  reservedAmount: number;
  reservedShares: number;
  destinationWallet: string;
  status: WithdrawalStatus;
  txHash?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalState {
  version: number;
  requests: WithdrawalRequestRecord[];
  updatedAt: string;
}

export interface RequestWithdrawalByAmountInput {
  wallet: string;
  amount: number;
  destinationWallet?: string;
}

export interface RequestWithdrawalBySharesInput {
  wallet: string;
  shares: number;
  destinationWallet?: string;
}

export interface RequestWithdrawalResult {
  request: WithdrawalRequestRecord;
  userRemainingShares: number;
  totalStrategyShares: number;
  totalStrategyValue: number;
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals: number;
}

export interface CompleteWithdrawalInput {
  requestId: string;
  txHash?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function normalizeWallet(wallet: string): string {
  return wallet.trim();
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function createRequestId(): string {
  return `wd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isValidWithdrawalStatus(value: unknown): value is WithdrawalStatus {
  return (
    value === "pending" ||
    value === "queued" ||
    value === "ready" ||
    value === "completed" ||
    value === "rejected"
  );
}

function isValidWithdrawalRecord(value: unknown): value is WithdrawalRequestRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as WithdrawalRequestRecord;

  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.wallet === "string" &&
    record.wallet.length > 0 &&
    (record.requestedAmount === undefined ||
      (typeof record.requestedAmount === "number" &&
        Number.isFinite(record.requestedAmount) &&
        record.requestedAmount > 0)) &&
    (record.requestedShares === undefined ||
      (typeof record.requestedShares === "number" &&
        Number.isFinite(record.requestedShares) &&
        record.requestedShares > 0)) &&
    typeof record.reservedAmount === "number" &&
    Number.isFinite(record.reservedAmount) &&
    record.reservedAmount > 0 &&
    typeof record.reservedShares === "number" &&
    Number.isFinite(record.reservedShares) &&
    record.reservedShares > 0 &&
    typeof record.destinationWallet === "string" &&
    record.destinationWallet.length > 0 &&
    isValidWithdrawalStatus(record.status) &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

function isValidWithdrawalState(value: unknown): value is WithdrawalState {
  if (!value || typeof value !== "object") return false;

  const state = value as WithdrawalState;

  if (state.version !== WITHDRAWALS_VERSION) return false;
  if (!Array.isArray(state.requests)) return false;
  if (typeof state.updatedAt !== "string") return false;

  for (const request of state.requests) {
    if (!isValidWithdrawalRecord(request)) {
      return false;
    }
  }

  return true;
}

function createEmptyWithdrawalState(): WithdrawalState {
  return {
    version: WITHDRAWALS_VERSION,
    requests: [],
    updatedAt: nowIso(),
  };
}

function writeJsonFile(filePath: string, data: WithdrawalState): void {
  ensureStateDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export class ManagedStrategyWithdrawals {
  private ledger: ManagedStrategyLedger;
  private nav: ManagedStrategyNav;
  private shares: ManagedStrategyShares;
  private filePath: string;

  constructor(
    ledger: ManagedStrategyLedger,
    nav: ManagedStrategyNav,
    shares: ManagedStrategyShares,
    filePath: string = WITHDRAWALS_PATH
  ) {
    this.ledger = ledger;
    this.nav = nav;
    this.shares = shares;
    this.filePath = filePath;
    this.ensureFile();
  }

  private ensureFile(): void {
    ensureStateDir();

    if (!fs.existsSync(this.filePath)) {
      writeJsonFile(this.filePath, createEmptyWithdrawalState());
    }
  }

  load(): WithdrawalState {
    this.ensureFile();

    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!isValidWithdrawalState(parsed)) {
      throw new Error(`Invalid withdrawal state at ${this.filePath}`);
    }

    return parsed;
  }

  save(state: WithdrawalState): void {
    state.updatedAt = nowIso();
    writeJsonFile(this.filePath, state);
  }

  listRequests(): WithdrawalRequestRecord[] {
    return this.load().requests;
  }

  getRequestById(requestId: string): WithdrawalRequestRecord | null {
    const state = this.load();
    return state.requests.find((request) => request.id === requestId) ?? null;
  }

  requestByAmount(
    input: RequestWithdrawalByAmountInput
  ): RequestWithdrawalResult {
    const wallet = normalizeWallet(input.wallet);
    const destinationWallet = normalizeWallet(
      input.destinationWallet ?? input.wallet
    );

    if (!wallet) {
      throw new Error("Wallet is required");
    }

    if (!destinationWallet) {
      throw new Error("Destination wallet is required");
    }

    if (!isFinitePositiveNumber(input.amount)) {
      throw new Error("Withdrawal amount must be greater than zero");
    }

    const user = this.ledger.getUser(wallet);

    if (!user) {
      throw new Error(`User not found: ${wallet}`);
    }

    const amountQuote = this.shares.quoteRedemptionByAmount(input.amount);

    if (!this.shares.canRedeemShares(amountQuote.shares, user.shares)) {
      throw new Error(
        `Insufficient shares for wallet ${wallet}. Requested=${amountQuote.shares}, Available=${user.shares}`
      );
    }

    return this.createRequest({
      wallet,
      destinationWallet,
      requestedAmount: amountQuote.amount,
      requestedShares: undefined,
      reservedAmount: amountQuote.amount,
      reservedShares: amountQuote.shares,
    });
  }

  requestByShares(
    input: RequestWithdrawalBySharesInput
  ): RequestWithdrawalResult {
    const wallet = normalizeWallet(input.wallet);
    const destinationWallet = normalizeWallet(
      input.destinationWallet ?? input.wallet
    );

    if (!wallet) {
      throw new Error("Wallet is required");
    }

    if (!destinationWallet) {
      throw new Error("Destination wallet is required");
    }

    if (!isFinitePositiveNumber(input.shares)) {
      throw new Error("Withdrawal shares must be greater than zero");
    }

    const user = this.ledger.getUser(wallet);

    if (!user) {
      throw new Error(`User not found: ${wallet}`);
    }

    const redemptionQuote = this.shares.quoteRedemptionByShares(input.shares);

    if (!this.shares.canRedeemShares(redemptionQuote.shares, user.shares)) {
      throw new Error(
        `Insufficient shares for wallet ${wallet}. Requested=${redemptionQuote.shares}, Available=${user.shares}`
      );
    }

    return this.createRequest({
      wallet,
      destinationWallet,
      requestedAmount: undefined,
      requestedShares: redemptionQuote.shares,
      reservedAmount: redemptionQuote.value,
      reservedShares: redemptionQuote.shares,
    });
  }

  private createRequest(input: {
    wallet: string;
    destinationWallet: string;
    requestedAmount?: number;
    requestedShares?: number;
    reservedAmount: number;
    reservedShares: number;
  }): RequestWithdrawalResult {
    const state = this.load();
    const navBefore = this.nav.getState();

    const liquidityStatus: WithdrawalStatus =
      navBefore.liquidValue >= input.reservedAmount ? "ready" : "queued";

    const timestamp = nowIso();

    const request: WithdrawalRequestRecord = {
      id: createRequestId(),
      wallet: input.wallet,
      requestedAmount: input.requestedAmount,
      requestedShares: input.requestedShares,
      reservedAmount: input.reservedAmount,
      reservedShares: input.reservedShares,
      destinationWallet: input.destinationWallet,
      status: liquidityStatus,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    state.requests.push(request);
    this.save(state);

    const navAfter = this.nav.updateNav({
      totalValue: navBefore.totalValue,
      liquidValue: navBefore.liquidValue,
      investedValue: navBefore.investedValue,
      reservedForWithdrawals:
        navBefore.reservedForWithdrawals + input.reservedAmount,
    });

    const user = this.ledger.getUser(input.wallet);

    if (!user) {
      throw new Error(`User missing after withdrawal request: ${input.wallet}`);
    }

    return {
      request,
      userRemainingShares: user.shares,
      totalStrategyShares: this.ledger.getTotalShares(),
      totalStrategyValue: navAfter.totalValue,
      liquidValue: navAfter.liquidValue,
      investedValue: navAfter.investedValue,
      reservedForWithdrawals: navAfter.reservedForWithdrawals,
    };
  }

  completeWithdrawal(
    input: CompleteWithdrawalInput
  ): WithdrawalRequestRecord {
    const state = this.load();
    const index = state.requests.findIndex(
      (request) => request.id === input.requestId
    );

    if (index === -1) {
      throw new Error(`Withdrawal request not found: ${input.requestId}`);
    }

    const request = state.requests[index];

    if (request.status === "completed") {
      return request;
    }

    if (request.status === "rejected") {
      throw new Error(`Cannot complete rejected request: ${request.id}`);
    }

    this.ledger.debitWithdrawal({
      wallet: request.wallet,
      amount: request.reservedAmount,
      shares: request.reservedShares,
    });

    const navBefore = this.nav.getState();
    const nextLiquidValue = navBefore.liquidValue - request.reservedAmount;
    const nextInvestedValue = navBefore.investedValue;
    const nextTotalValue = nextLiquidValue + nextInvestedValue;
    const nextReserved = Math.max(
      0,
      navBefore.reservedForWithdrawals - request.reservedAmount
    );

    if (nextLiquidValue < 0) {
      throw new Error(
        `Insufficient liquid value to complete withdrawal ${request.id}`
      );
    }

    this.nav.updateNav({
      totalValue: nextTotalValue,
      liquidValue: nextLiquidValue,
      investedValue: nextInvestedValue,
      reservedForWithdrawals: nextReserved,
    });

    const completed: WithdrawalRequestRecord = {
      ...request,
      status: "completed",
      txHash: input.txHash,
      updatedAt: nowIso(),
    };

    state.requests[index] = completed;
    this.save(state);

    return completed;
  }

  rejectWithdrawal(requestId: string, reason: string): WithdrawalRequestRecord {
    const state = this.load();
    const index = state.requests.findIndex((request) => request.id === requestId);

    if (index === -1) {
      throw new Error(`Withdrawal request not found: ${requestId}`);
    }

    const request = state.requests[index];

    if (request.status === "completed") {
      throw new Error(`Cannot reject completed request: ${request.id}`);
    }

    const navBefore = this.nav.getState();
    const nextReserved = Math.max(
      0,
      navBefore.reservedForWithdrawals - request.reservedAmount
    );

    this.nav.updateNav({
      totalValue: navBefore.totalValue,
      liquidValue: navBefore.liquidValue,
      investedValue: navBefore.investedValue,
      reservedForWithdrawals: nextReserved,
    });

    const rejected: WithdrawalRequestRecord = {
      ...request,
      status: "rejected",
      reason,
      updatedAt: nowIso(),
    };

    state.requests[index] = rejected;
    this.save(state);

    return rejected;
  }
}

export function createManagedStrategyWithdrawals(
  ledger: ManagedStrategyLedger,
  nav: ManagedStrategyNav,
  shares: ManagedStrategyShares,
  filePath?: string
): ManagedStrategyWithdrawals {
  return new ManagedStrategyWithdrawals(ledger, nav, shares, filePath);
}
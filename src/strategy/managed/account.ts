import { ManagedStrategyLedger, StrategyUserLedgerEntry } from "./ledger";
import {
  ManagedStrategyNav,
  StrategyValuationSnapshot,
} from "./nav";
import { ManagedStrategyShares } from "./shares";
import {
  ManagedStrategyWithdrawals,
  WithdrawalRequestRecord,
} from "./withdrawals";

export interface ManagedStrategyUserPosition {
  wallet: string;
  shares: number;
  sharePrice: number;
  currentValue: number;
  totalDeposited: number;
  totalWithdrawn: number;
  netDeposited: number;
  pnlAbsolute: number;
  pnlPercent: number;
  pendingWithdrawalAmount: number;
  pendingWithdrawalShares: number;
  pendingWithdrawals: WithdrawalRequestRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagedStrategyOverview {
  valuation: StrategyValuationSnapshot;
  totalDeposited: number;
  totalWithdrawn: number;
  totalUsers: number;
  pendingWithdrawalAmount: number;
  pendingWithdrawalCount: number;
}

function normalizeWallet(wallet: string): string {
  return wallet.trim();
}

function roundToDecimals(value: number, decimals = 9): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function sumPendingWithdrawalAmount(
  requests: WithdrawalRequestRecord[]
): number {
  return requests.reduce((sum, request) => sum + request.reservedAmount, 0);
}

function sumPendingWithdrawalShares(
  requests: WithdrawalRequestRecord[]
): number {
  return requests.reduce((sum, request) => sum + request.reservedShares, 0);
}

function isPendingWithdrawal(request: WithdrawalRequestRecord): boolean {
  return request.status === "pending" || request.status === "queued" || request.status === "ready";
}

export class ManagedStrategyAccountService {
  private ledger: ManagedStrategyLedger;
  private nav: ManagedStrategyNav;
  private shares: ManagedStrategyShares;
  private withdrawals: ManagedStrategyWithdrawals;

  constructor(
    ledger: ManagedStrategyLedger,
    nav: ManagedStrategyNav,
    shares: ManagedStrategyShares,
    withdrawals: ManagedStrategyWithdrawals
  ) {
    this.ledger = ledger;
    this.nav = nav;
    this.shares = shares;
    this.withdrawals = withdrawals;
  }

  getUserPosition(wallet: string): ManagedStrategyUserPosition | null {
    const normalizedWallet = normalizeWallet(wallet);

    if (!normalizedWallet) {
      throw new Error("Wallet is required");
    }

    const user = this.ledger.getUser(normalizedWallet);

    if (!user) {
      return null;
    }

    return this.buildUserPosition(user);
  }

  listUserPositions(): ManagedStrategyUserPosition[] {
    return this.ledger
      .listUsers()
      .map((user) => this.buildUserPosition(user));
  }

  getOverview(): ManagedStrategyOverview {
    const valuation = this.nav.getValuationSnapshot();
    const users = this.ledger.listUsers();
    const pendingRequests = this.withdrawals
      .listRequests()
      .filter(isPendingWithdrawal);

    return {
      valuation,
      totalDeposited: this.ledger.getTotalDeposited(),
      totalWithdrawn: this.ledger.getTotalWithdrawn(),
      totalUsers: users.length,
      pendingWithdrawalAmount: roundToDecimals(
        sumPendingWithdrawalAmount(pendingRequests)
      ),
      pendingWithdrawalCount: pendingRequests.length,
    };
  }

  getPendingWithdrawalsForWallet(wallet: string): WithdrawalRequestRecord[] {
    const normalizedWallet = normalizeWallet(wallet);

    if (!normalizedWallet) {
      throw new Error("Wallet is required");
    }

    return this.withdrawals
      .listRequests()
      .filter(
        (request) =>
          request.wallet === normalizedWallet && isPendingWithdrawal(request)
      );
  }

  private buildUserPosition(
    user: StrategyUserLedgerEntry
  ): ManagedStrategyUserPosition {
    const sharePrice = this.shares.getSharePrice();
    const currentValue = roundToDecimals(user.shares * sharePrice);
    const netDeposited = roundToDecimals(
      user.totalDeposited - user.totalWithdrawn
    );
    const pnlAbsolute = roundToDecimals(currentValue - netDeposited);

    const pnlPercent =
      netDeposited > 0
        ? roundToDecimals((pnlAbsolute / netDeposited) * 100)
        : 0;

    const pendingWithdrawals = this.getPendingWithdrawalsForWallet(user.wallet);
    const pendingWithdrawalAmount = roundToDecimals(
      sumPendingWithdrawalAmount(pendingWithdrawals)
    );
    const pendingWithdrawalShares = roundToDecimals(
      sumPendingWithdrawalShares(pendingWithdrawals)
    );

    return {
      wallet: user.wallet,
      shares: roundToDecimals(user.shares),
      sharePrice: roundToDecimals(sharePrice),
      currentValue,
      totalDeposited: roundToDecimals(user.totalDeposited),
      totalWithdrawn: roundToDecimals(user.totalWithdrawn),
      netDeposited,
      pnlAbsolute,
      pnlPercent,
      pendingWithdrawalAmount,
      pendingWithdrawalShares,
      pendingWithdrawals,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export function createManagedStrategyAccountService(
  ledger: ManagedStrategyLedger,
  nav: ManagedStrategyNav,
  shares: ManagedStrategyShares,
  withdrawals: ManagedStrategyWithdrawals
): ManagedStrategyAccountService {
  return new ManagedStrategyAccountService(
    ledger,
    nav,
    shares,
    withdrawals
  );
}
import { ManagedStrategyLedger } from "./ledger";
import { ManagedStrategyNav } from "./nav";
import { ManagedStrategyShares } from "./shares";

export interface RegisterDepositInput {
  wallet: string;
  amount: number;
  txHash?: string;
  notes?: string;
}

export interface RegisterDepositResult {
  wallet: string;
  amount: number;
  mintedShares: number;
  sharePrice: number;
  txHash?: string;
  notes?: string;
  totalUserShares: number;
  totalStrategyShares: number;
  totalStrategyValue: number;
  liquidValue: number;
  investedValue: number;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeWallet(wallet: string): string {
  return wallet.trim();
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class ManagedStrategyDeposits {
  private ledger: ManagedStrategyLedger;
  private nav: ManagedStrategyNav;
  private shares: ManagedStrategyShares;

  constructor(
    ledger: ManagedStrategyLedger,
    nav: ManagedStrategyNav,
    shares: ManagedStrategyShares
  ) {
    this.ledger = ledger;
    this.nav = nav;
    this.shares = shares;
  }

  registerDeposit(input: RegisterDepositInput): RegisterDepositResult {
    const wallet = normalizeWallet(input.wallet);

    if (!wallet) {
      throw new Error("Wallet is required");
    }

    if (!isFinitePositiveNumber(input.amount)) {
      throw new Error("Deposit amount must be greater than zero");
    }

    const timestamp = nowIso();
    const navBefore = this.nav.getState();
    const depositQuote = this.shares.quoteDeposit(input.amount);

    this.ledger.creditDeposit({
      wallet,
      amount: depositQuote.amount,
      shares: depositQuote.shares,
    });

    const nextLiquidValue = navBefore.liquidValue + depositQuote.amount;
    const nextInvestedValue = navBefore.investedValue;
    const nextTotalValue = nextLiquidValue + nextInvestedValue;

    const navAfter = this.nav.updateNav({
      totalValue: nextTotalValue,
      liquidValue: nextLiquidValue,
      investedValue: nextInvestedValue,
      reservedForWithdrawals: navBefore.reservedForWithdrawals,
    });

    const user = this.ledger.getUser(wallet);

    if (!user) {
      throw new Error(`User missing after deposit credit: ${wallet}`);
    }

    return {
      wallet,
      amount: depositQuote.amount,
      mintedShares: depositQuote.shares,
      sharePrice: depositQuote.sharePrice,
      txHash: input.txHash,
      notes: input.notes,
      totalUserShares: user.shares,
      totalStrategyShares: this.ledger.getTotalShares(),
      totalStrategyValue: navAfter.totalValue,
      liquidValue: navAfter.liquidValue,
      investedValue: navAfter.investedValue,
      createdAt: timestamp,
    };
  }
}

export function createManagedStrategyDeposits(
  ledger: ManagedStrategyLedger,
  nav: ManagedStrategyNav,
  shares: ManagedStrategyShares
): ManagedStrategyDeposits {
  return new ManagedStrategyDeposits(ledger, nav, shares);
}
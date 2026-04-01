import { ManagedStrategyNav } from "./nav";

export interface DeployCapitalInput {
  amount: number;
  reason?: string;
}

export interface ReturnCapitalInput {
  amount: number;
  reason?: string;
}

export interface CapitalOperationResult {
  totalValue: number;
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals: number;
  sharePrice: number;
  reason?: string;
  updatedAt: string;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class ManagedStrategyCapital {
  private nav: ManagedStrategyNav;

  constructor(nav: ManagedStrategyNav) {
    this.nav = nav;
  }

  deployCapital(input: DeployCapitalInput): CapitalOperationResult {
    if (!isFinitePositiveNumber(input.amount)) {
      throw new Error("Deploy amount must be greater than zero");
    }

    const current = this.nav.getState();
    const availableLiquid = current.liquidValue - current.reservedForWithdrawals;

    if (availableLiquid < input.amount) {
      throw new Error(
        `Insufficient available liquid capital. Requested=${input.amount}, Available=${availableLiquid}`
      );
    }

    const nextLiquidValue = current.liquidValue - input.amount;
    const nextInvestedValue = current.investedValue + input.amount;
    const nextTotalValue = nextLiquidValue + nextInvestedValue;

    const updated = this.nav.updateNav({
      totalValue: nextTotalValue,
      liquidValue: nextLiquidValue,
      investedValue: nextInvestedValue,
      reservedForWithdrawals: current.reservedForWithdrawals,
    });

    return {
      totalValue: updated.totalValue,
      liquidValue: updated.liquidValue,
      investedValue: updated.investedValue,
      reservedForWithdrawals: updated.reservedForWithdrawals,
      sharePrice: updated.sharePrice,
      reason: input.reason,
      updatedAt: updated.updatedAt,
    };
  }

  returnCapital(input: ReturnCapitalInput): CapitalOperationResult {
    if (!isFinitePositiveNumber(input.amount)) {
      throw new Error("Return amount must be greater than zero");
    }

    const current = this.nav.getState();

    if (current.investedValue < input.amount) {
      throw new Error(
        `Insufficient invested capital. Requested=${input.amount}, Invested=${current.investedValue}`
      );
    }

    const nextLiquidValue = current.liquidValue + input.amount;
    const nextInvestedValue = current.investedValue - input.amount;
    const nextTotalValue = nextLiquidValue + nextInvestedValue;

    const updated = this.nav.updateNav({
      totalValue: nextTotalValue,
      liquidValue: nextLiquidValue,
      investedValue: nextInvestedValue,
      reservedForWithdrawals: current.reservedForWithdrawals,
    });

    return {
      totalValue: updated.totalValue,
      liquidValue: updated.liquidValue,
      investedValue: updated.investedValue,
      reservedForWithdrawals: updated.reservedForWithdrawals,
      sharePrice: updated.sharePrice,
      reason: input.reason,
      updatedAt: updated.updatedAt,
    };
  }
}

export function createManagedStrategyCapital(
  nav: ManagedStrategyNav
): ManagedStrategyCapital {
  return new ManagedStrategyCapital(nav);
}
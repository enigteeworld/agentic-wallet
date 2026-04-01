import { ManagedStrategyNav } from "./nav";

export interface ReconcileNavInput {
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals?: number;
  source?: string;
  notes?: string;
}

export interface ReconcileNavResult {
  previousTotalValue: number;
  nextTotalValue: number;
  previousLiquidValue: number;
  nextLiquidValue: number;
  previousInvestedValue: number;
  nextInvestedValue: number;
  previousReservedForWithdrawals: number;
  nextReservedForWithdrawals: number;
  pnlDelta: number;
  sharePrice: number;
  source?: string;
  notes?: string;
  updatedAt: string;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export class ManagedStrategyReconciliation {
  private nav: ManagedStrategyNav;

  constructor(nav: ManagedStrategyNav) {
    this.nav = nav;
  }

  reconcileNav(input: ReconcileNavInput): ReconcileNavResult {
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

    const previous = this.nav.getState();
    const nextTotalValue = input.liquidValue + input.investedValue;

    const updated = this.nav.updateNav({
      totalValue: nextTotalValue,
      liquidValue: input.liquidValue,
      investedValue: input.investedValue,
      reservedForWithdrawals,
    });

    return {
      previousTotalValue: previous.totalValue,
      nextTotalValue: updated.totalValue,
      previousLiquidValue: previous.liquidValue,
      nextLiquidValue: updated.liquidValue,
      previousInvestedValue: previous.investedValue,
      nextInvestedValue: updated.investedValue,
      previousReservedForWithdrawals: previous.reservedForWithdrawals,
      nextReservedForWithdrawals: updated.reservedForWithdrawals,
      pnlDelta: updated.totalValue - previous.totalValue,
      sharePrice: updated.sharePrice,
      source: input.source,
      notes: input.notes,
      updatedAt: updated.updatedAt,
    };
  }
}

export function createManagedStrategyReconciliation(
  nav: ManagedStrategyNav
): ManagedStrategyReconciliation {
  return new ManagedStrategyReconciliation(nav);
}
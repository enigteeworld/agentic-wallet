import { ManagedStrategyNav } from "./nav";

export const SHARE_DECIMALS = 9;
const SHARE_EPSILON = 1 / Math.pow(10, SHARE_DECIMALS);

export interface ShareQuote {
  sharePrice: number;
  amount: number;
  shares: number;
}

export interface RedemptionQuote {
  sharePrice: number;
  shares: number;
  value: number;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function floorToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

function ceilToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor) / factor;
}

export class ManagedStrategyShares {
  private nav: ManagedStrategyNav;

  constructor(nav: ManagedStrategyNav) {
    this.nav = nav;
  }

  getSharePrice(): number {
    const sharePrice = this.nav.getSharePrice();

    if (!isFinitePositiveNumber(sharePrice)) {
      throw new Error(`Invalid share price: ${sharePrice}`);
    }

    return sharePrice;
  }

  quoteDeposit(amount: number): ShareQuote {
    if (!isFinitePositiveNumber(amount)) {
      throw new Error("Deposit amount must be greater than zero");
    }

    const sharePrice = this.getSharePrice();
    const rawShares = amount / sharePrice;
    const shares = floorToDecimals(rawShares, SHARE_DECIMALS);

    if (shares <= 0) {
      throw new Error(
        `Deposit amount ${amount} is too small at share price ${sharePrice}`
      );
    }

    return {
      sharePrice,
      amount: roundToDecimals(amount, SHARE_DECIMALS),
      shares,
    };
  }

  quoteRedemptionByShares(shares: number): RedemptionQuote {
    if (!isFinitePositiveNumber(shares)) {
      throw new Error("Shares must be greater than zero");
    }

    const sharePrice = this.getSharePrice();
    const normalizedShares = floorToDecimals(shares, SHARE_DECIMALS);

    if (normalizedShares <= 0) {
      throw new Error("Shares are too small after rounding");
    }

    const value = floorToDecimals(normalizedShares * sharePrice, SHARE_DECIMALS);

    return {
      sharePrice,
      shares: normalizedShares,
      value,
    };
  }

  quoteRedemptionByAmount(amount: number): ShareQuote {
    if (!isFinitePositiveNumber(amount)) {
      throw new Error("Withdrawal amount must be greater than zero");
    }

    const sharePrice = this.getSharePrice();
    const rawShares = amount / sharePrice;
    const shares = ceilToDecimals(rawShares, SHARE_DECIMALS);

    if (shares <= 0) {
      throw new Error(
        `Withdrawal amount ${amount} is too small at share price ${sharePrice}`
      );
    }

    return {
      sharePrice,
      amount: roundToDecimals(amount, SHARE_DECIMALS),
      shares,
    };
  }

  valueOfShares(shares: number): number {
    if (!isFinitePositiveNumber(shares)) {
      throw new Error("Shares must be greater than zero");
    }

    const quote = this.quoteRedemptionByShares(shares);
    return quote.value;
  }

  sharesForAmount(amount: number): number {
    return this.quoteDeposit(amount).shares;
  }

  canRedeemShares(requestedShares: number, availableShares: number): boolean {
    if (!isFinitePositiveNumber(requestedShares)) {
      return false;
    }

    if (!isFinitePositiveNumber(availableShares) && availableShares !== 0) {
      return false;
    }

    return requestedShares <= availableShares + SHARE_EPSILON;
  }

  normalizeShares(shares: number): number {
    if (!isFinitePositiveNumber(shares)) {
      throw new Error("Shares must be greater than zero");
    }

    const normalized = floorToDecimals(shares, SHARE_DECIMALS);

    if (normalized <= 0) {
      throw new Error("Shares are too small after normalization");
    }

    return normalized;
  }

  normalizeAmount(amount: number): number {
    if (!isFinitePositiveNumber(amount)) {
      throw new Error("Amount must be greater than zero");
    }

    const normalized = roundToDecimals(amount, SHARE_DECIMALS);

    if (normalized <= 0) {
      throw new Error("Amount is too small after normalization");
    }

    return normalized;
  }
}

export function createManagedStrategyShares(
  nav: ManagedStrategyNav
): ManagedStrategyShares {
  return new ManagedStrategyShares(nav);
}
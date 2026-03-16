import type {
  PositionRecord,
  SignalResult,
  StrategyContext,
  TradeRecord,
} from "./types";

const SYMBOL_TO_MINT: Record<string, string> = {
  SOL: "SOL",
  JUP: "JUP",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function minutesSince(timestamp?: string): number {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const then = new Date(timestamp).getTime();
  const now = Date.now();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (now - then) / 60000;
}

function getCurrentExposureUsd(
  positions: PositionRecord[],
  symbol: string
): number {
  return positions
    .filter((position) => position.symbol === symbol || position.mint === symbol)
    .reduce((sum, position) => sum + position.marketValueUsd, 0);
}

function getExposurePct(params: {
  positions: PositionRecord[];
  symbol: string;
  navUsd: number;
}): number {
  if (params.navUsd <= 0) return 0;

  const exposureUsd = getCurrentExposureUsd(params.positions, params.symbol);
  return exposureUsd / params.navUsd;
}

function getCashPct(context: StrategyContext): number {
  const navUsd = context.vault.totalValueUsd;
  if (navUsd <= 0) return 1;

  return context.vault.availableCapitalUsd / navUsd;
}

function getLastTradeForSymbol(
  recentTrades: TradeRecord[],
  symbol: string,
  mint: string
): TradeRecord | undefined {
  const matches = recentTrades.filter((trade) => {
    return (
      trade.inputMint === mint ||
      trade.outputMint === mint ||
      trade.inputMint === symbol ||
      trade.outputMint === symbol
    );
  });

  return matches.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  })[0];
}

function getLastBuyForSymbol(
  recentTrades: TradeRecord[],
  symbol: string,
  mint: string
): TradeRecord | undefined {
  const matches = recentTrades.filter((trade) => {
    if (trade.side !== "BUY") return false;

    return (
      trade.outputMint === mint ||
      trade.outputMint === symbol ||
      trade.inputMint === mint ||
      trade.inputMint === symbol
    );
  });

  return matches.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  })[0];
}

function getAnchorPrice(params: {
  symbol: string;
  mint: string;
  currentPrice: number;
  openPositions: PositionRecord[];
  recentTrades: TradeRecord[];
}): number {
  const position = params.openPositions.find((entry) => {
    return entry.symbol === params.symbol || entry.mint === params.mint;
  });

  if (position?.avgEntryPriceUsd && position.avgEntryPriceUsd > 0) {
    return position.avgEntryPriceUsd;
  }

  const lastTrade = getLastTradeForSymbol(
    params.recentTrades,
    params.symbol,
    params.mint
  );

  if (lastTrade?.executionPriceUsd && lastTrade.executionPriceUsd > 0) {
    return lastTrade.executionPriceUsd;
  }

  const fallbackDiscountBySymbol: Record<string, number> = {
    SOL: 0.025,
    JUP: 0.04,
  };

  const discount = fallbackDiscountBySymbol[params.symbol] ?? 0.03;
  return params.currentPrice * (1 - discount);
}

function computeMomentumScore(params: {
  currentPrice: number;
  anchorPrice: number;
}): number {
  if (params.currentPrice <= 0 || params.anchorPrice <= 0) return 0;

  const relativeMove =
    (params.currentPrice - params.anchorPrice) / params.anchorPrice;

  return clamp(0.5 + relativeMove * 5, 0, 1);
}

function computeRiskPenalty(params: {
  exposurePct: number;
  maxPositionPct: number;
  cashPct: number;
  minUsdcReservePct: number;
  drawdownPct: number;
  softDrawdownPct: number;
  cooldownMinutesRemaining: number;
}): number {
  let penalty = 0;

  if (params.maxPositionPct > 0) {
    const exposurePressure = params.exposurePct / params.maxPositionPct;
    penalty += clamp(exposurePressure - 0.45, 0, 1) * 0.3;
  }

  if (params.cashPct < params.minUsdcReservePct) {
    penalty += 0.2;
  }

  if (params.drawdownPct >= params.softDrawdownPct) {
    penalty += 0.2;
  }

  if (params.cooldownMinutesRemaining > 0) {
    penalty += 0.25;
  }

  return clamp(penalty, 0, 0.8);
}

export function computeSignals(context: StrategyContext): SignalResult[] {
  const navUsd = context.vault.totalValueUsd;
  const cashPct = getCashPct(context);

  return context.config.allowedAssets.map((symbol) => {
    const mint = SYMBOL_TO_MINT[symbol] ?? symbol;
    const currentPrice = context.prices[symbol] ?? context.prices[mint] ?? 0;

    if (!currentPrice || currentPrice <= 0) {
      return {
        symbol,
        mint,
        score: 0,
        confidence: 0,
        direction: "NEUTRAL",
        reason: "No price data available",
      };
    }

    const anchorPrice = getAnchorPrice({
      symbol,
      mint,
      currentPrice,
      openPositions: context.openPositions,
      recentTrades: context.recentTrades,
    });

    const momentumScore = computeMomentumScore({
      currentPrice,
      anchorPrice,
    });

    const exposurePct = getExposurePct({
      positions: context.openPositions,
      symbol,
      navUsd,
    });

    const lastBuy = getLastBuyForSymbol(context.recentTrades, symbol, mint);
    const cooldownMinutesElapsed = minutesSince(lastBuy?.timestamp);
    const cooldownMinutesRemaining = Math.max(
      0,
      context.config.cooldownMinutes - cooldownMinutesElapsed
    );

    const riskPenalty = computeRiskPenalty({
      exposurePct,
      maxPositionPct: context.config.maxPositionPct,
      cashPct,
      minUsdcReservePct: context.config.minUsdcReservePct,
      drawdownPct: context.vault.drawdownPct,
      softDrawdownPct: context.config.softDrawdownPct,
      cooldownMinutesRemaining,
    });

    const score = clamp(momentumScore - riskPenalty, 0, 1);

    let direction: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

    if (score >= 0.62) {
      direction = "BULLISH";
    } else if (score <= 0.38) {
      direction = "BEARISH";
    }

    const confidence = clamp(
      direction === "NEUTRAL"
        ? Math.abs(score - 0.5) * 1.5
        : score,
      0,
      1
    );

    const reasonParts = [
      `price=${currentPrice.toFixed(4)}`,
      `anchor=${anchorPrice.toFixed(4)}`,
      `momentum=${momentumScore.toFixed(2)}`,
      `riskPenalty=${riskPenalty.toFixed(2)}`,
      `exposurePct=${(exposurePct * 100).toFixed(2)}%`,
      `cashPct=${(cashPct * 100).toFixed(2)}%`,
      `drawdownPct=${(context.vault.drawdownPct * 100).toFixed(2)}%`,
      `cooldownRemaining=${cooldownMinutesRemaining.toFixed(0)}m`,
    ];

    return {
      symbol,
      mint,
      score,
      confidence,
      direction,
      reason: reasonParts.join(" | "),
    };
  });
}
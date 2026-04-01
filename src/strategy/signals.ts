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

const BASE_BULLISH_THRESHOLD = 0.62;
const BASE_BEARISH_THRESHOLD = 0.38;

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
  const navUsd = context.portfolio.totalValueUsd;
  if (navUsd <= 0) return 1;
  return context.portfolio.availableCapitalUsd / navUsd;
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

function computeTrendStrength(params: {
  currentPrice: number;
  anchorPrice: number;
}): number {
  if (params.currentPrice <= 0 || params.anchorPrice <= 0) return 0;

  const relativeMove =
    (params.currentPrice - params.anchorPrice) / params.anchorPrice;

  return clamp(Math.abs(relativeMove) * 8, 0, 1);
}

function computeProfitPressure(params: {
  position?: PositionRecord;
  currentPrice: number;
}): number {
  if (!params.position) return 0;
  if (params.position.avgEntryPriceUsd <= 0 || params.currentPrice <= 0) return 0;

  const pnlPct =
    (params.currentPrice - params.position.avgEntryPriceUsd) /
    params.position.avgEntryPriceUsd;

  if (pnlPct <= 0) return 0;

  return clamp(pnlPct / 0.12, 0, 1);
}

function computeDrawdownPressure(params: {
  drawdownPct: number;
  softDrawdownPct: number;
  hardDrawdownPct: number;
}): number {
  if (params.hardDrawdownPct <= 0) return 0;
  if (params.drawdownPct <= 0) return 0;

  if (params.drawdownPct >= params.hardDrawdownPct) {
    return 1;
  }

  if (params.drawdownPct <= params.softDrawdownPct) {
    return (
      clamp(
        params.drawdownPct / Math.max(params.softDrawdownPct, 0.0001),
        0,
        1
      ) * 0.5
    );
  }

  const range = params.hardDrawdownPct - params.softDrawdownPct;
  if (range <= 0) return 1;

  return clamp(
    0.5 + ((params.drawdownPct - params.softDrawdownPct) / range) * 0.5,
    0,
    1
  );
}

function computeRiskPenalty(params: {
  exposurePct: number;
  maxPositionPct: number;
  cashPct: number;
  minUsdcReservePct: number;
  drawdownPct: number;
  softDrawdownPct: number;
  cooldownMinutesRemaining: number;
  openPositionsCount: number;
  maxConcurrentPositions: number;
  profitPressure: number;
  drawdownPressure: number;
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

  if (
    params.maxConcurrentPositions > 0 &&
    params.openPositionsCount >= params.maxConcurrentPositions
  ) {
    penalty += 0.1;
  }

  penalty += params.profitPressure * 0.08;
  penalty += params.drawdownPressure * 0.15;

  return clamp(penalty, 0, 0.9);
}

export function computeSignals(context: StrategyContext): SignalResult[] {
  const navUsd = context.portfolio.totalValueUsd;
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

    const position = context.openPositions.find((entry) => {
      return entry.symbol === symbol || entry.mint === mint;
    });

    const momentumScore = computeMomentumScore({
      currentPrice,
      anchorPrice,
    });

    const trendStrength = computeTrendStrength({
      currentPrice,
      anchorPrice,
    });

    const exposurePct = getExposurePct({
      positions: context.openPositions,
      symbol,
      navUsd,
    });

    const profitPressure = computeProfitPressure({
      position,
      currentPrice,
    });

    const drawdownPressure = computeDrawdownPressure({
      drawdownPct: context.portfolio.drawdownPct,
      softDrawdownPct: context.config.softDrawdownPct,
      hardDrawdownPct: context.config.hardDrawdownPct,
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
      drawdownPct: context.portfolio.drawdownPct,
      softDrawdownPct: context.config.softDrawdownPct,
      cooldownMinutesRemaining,
      openPositionsCount: context.openPositions.length,
      maxConcurrentPositions: context.config.maxConcurrentPositions,
      profitPressure,
      drawdownPressure,
    });

    const score = clamp(momentumScore - riskPenalty, 0, 1);

    let direction: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

    if (score >= BASE_BULLISH_THRESHOLD) {
      direction = "BULLISH";
    } else if (score <= BASE_BEARISH_THRESHOLD) {
      direction = "BEARISH";
    }

    const confidence = clamp(
      direction === "NEUTRAL"
        ? Math.abs(score - 0.5) * 1.5 + trendStrength * 0.15
        : score + trendStrength * 0.1,
      0,
      1
    );

    const reasonParts = [
      `price=${currentPrice.toFixed(4)}`,
      `anchor=${anchorPrice.toFixed(4)}`,
      `momentum=${momentumScore.toFixed(2)}`,
      `trendStrength=${trendStrength.toFixed(2)}`,
      `riskPenalty=${riskPenalty.toFixed(2)}`,
      `profitPressure=${profitPressure.toFixed(2)}`,
      `drawdownPressure=${drawdownPressure.toFixed(2)}`,
      `exposurePct=${(exposurePct * 100).toFixed(2)}%`,
      `cashPct=${(cashPct * 100).toFixed(2)}%`,
      `drawdownPct=${(context.portfolio.drawdownPct * 100).toFixed(2)}%`,
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
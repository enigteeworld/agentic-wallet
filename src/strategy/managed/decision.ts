import type {
  PositionRecord,
  SignalResult,
  StrategyContext,
  StrategyIntent,
  TradeRecord,
} from "../types";

const SYMBOL_TO_MINT: Record<string, string> = {
  SOL: "SOL",
  JUP: "JUP",
};

const BASE_BULLISH_THRESHOLD = 0.52;
const BASE_BEARISH_THRESHOLD = 0.45;
const STRONG_BULLISH_THRESHOLD = 0.62;
const STRONG_BEARISH_THRESHOLD = 0.32;

const MIN_POSITION_VALUE_USD = 1;
const MIN_HOLD_MINUTES = 30;
const STOP_LOSS_PCT = -0.06;
const TAKE_PROFIT_PCT = 0.1;
const MAX_ENTRY_EXTENSION_PCT = 0.06;

type ManagedSignal = SignalResult & {
  currentPrice: number;
  anchorPrice: number;
  momentumScore: number;
  trendStrength: number;
  riskPenalty: number;
  profitPressure: number;
  drawdownPressure: number;
  exposurePct: number;
  cashPct: number;
  cooldownMinutesRemaining: number;
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
  if (params.position.avgEntryPriceUsd <= 0 || params.currentPrice <= 0) {
    return 0;
  }

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

export function computeSignals(context: StrategyContext): ManagedSignal[] {
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
        currentPrice: 0,
        anchorPrice: 0,
        momentumScore: 0,
        trendStrength: 0,
        riskPenalty: 1,
        profitPressure: 0,
        drawdownPressure: 0,
        exposurePct: 0,
        cashPct,
        cooldownMinutesRemaining: 0,
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
      currentPrice,
      anchorPrice,
      momentumScore,
      trendStrength,
      riskPenalty,
      profitPressure,
      drawdownPressure,
      exposurePct,
      cashPct,
      cooldownMinutesRemaining,
    };
  });
}

function findPositionForSignal(
  signal: SignalResult,
  positions: PositionRecord[]
): PositionRecord | undefined {
  return positions.find((position) => {
    return position.symbol === signal.symbol || position.mint === signal.mint;
  });
}

function hasCapacityForNewPosition(context: StrategyContext): boolean {
  return context.openPositions.length < context.config.maxConcurrentPositions;
}

function getPositionPnlPct(position: PositionRecord): number {
  if (position.avgEntryPriceUsd <= 0 || position.currentPriceUsd <= 0) {
    return 0;
  }

  return (
    (position.currentPriceUsd - position.avgEntryPriceUsd) /
    position.avgEntryPriceUsd
  );
}

function getLastBuyMinutesHeld(
  context: StrategyContext,
  signal: ManagedSignal
): number {
  const lastBuy = getLastBuyForSymbol(
    context.recentTrades,
    signal.symbol,
    signal.mint
  );
  return minutesSince(lastBuy?.timestamp);
}

function findTopBearishExitCandidate(
  context: StrategyContext,
  signals: ManagedSignal[]
): { signal: ManagedSignal; position: PositionRecord } | undefined {
  const candidates = signals
    .map((signal) => ({
      signal,
      position: findPositionForSignal(signal, context.openPositions),
    }))
    .filter((item): item is { signal: ManagedSignal; position: PositionRecord } => {
      return Boolean(item.position);
    })
    .filter((item) => item.position.marketValueUsd >= MIN_POSITION_VALUE_USD)
    .filter((item) => {
      const pnlPct = getPositionPnlPct(item.position);
      const minutesHeld = getLastBuyMinutesHeld(context, item.signal);
      const stopLossTriggered = pnlPct <= STOP_LOSS_PCT;
      const takeProfitReversalTriggered =
        pnlPct >= TAKE_PROFIT_PCT && item.signal.score <= 0.5;
      const strongBearishSignal =
        item.signal.direction === "BEARISH" &&
        item.signal.score <= BASE_BEARISH_THRESHOLD;
      const hardBearishSignal =
        item.signal.direction === "BEARISH" &&
        item.signal.score <= STRONG_BEARISH_THRESHOLD;

      if (stopLossTriggered || takeProfitReversalTriggered || hardBearishSignal) {
        return true;
      }

      if (minutesHeld < MIN_HOLD_MINUTES) {
        return false;
      }

      return strongBearishSignal;
    })
    .sort((a, b) => {
      const aPnlPct = getPositionPnlPct(a.position);
      const bPnlPct = getPositionPnlPct(b.position);

      const aScore =
        a.position.marketValueUsd * (1 - a.signal.score) + Math.abs(aPnlPct) * 10;
      const bScore =
        b.position.marketValueUsd * (1 - b.signal.score) + Math.abs(bPnlPct) * 10;

      return bScore - aScore;
    });

  return candidates[0];
}

function findTopBullishEntrySignal(
  signals: ManagedSignal[]
): ManagedSignal | undefined {
  return [...signals]
    .filter((signal) => signal.direction === "BULLISH")
    .sort((a, b) => b.score - a.score)[0];
}

function computeAdjustedBuyNotional(params: {
  context: StrategyContext;
  signal: ManagedSignal;
  existingPosition?: PositionRecord;
}): number {
  const { context, signal, existingPosition } = params;

  const nav = context.portfolio.totalValueUsd;
  if (nav <= 0) return 0;

  const maxTradeUsd = nav * context.config.maxTradePct;
  const maxPositionUsd = nav * context.config.maxPositionPct;
  const reserveUsd = nav * context.config.minUsdcReservePct;

  const deployableUsd = Math.max(
    0,
    context.portfolio.availableCapitalUsd - reserveUsd
  );

  const currentPositionUsd = existingPosition?.marketValueUsd ?? 0;
  const remainingPositionCapacityUsd = Math.max(
    0,
    maxPositionUsd - currentPositionUsd
  );

  const exposurePct = nav > 0 ? currentPositionUsd / nav : 0;
  const drawdownPct = context.portfolio.drawdownPct;

  let confidenceScaledUsd =
    maxTradeUsd *
    signal.confidence *
    (0.65 + signal.trendStrength * 0.5);

  if (signal.score >= STRONG_BULLISH_THRESHOLD) {
    confidenceScaledUsd *= 1.15;
  }

  if (exposurePct >= context.config.maxPositionPct * 0.9) {
    confidenceScaledUsd *= 0.1;
  } else if (exposurePct >= context.config.maxPositionPct * 0.75) {
    confidenceScaledUsd *= 0.35;
  } else if (exposurePct >= context.config.maxPositionPct * 0.5) {
    confidenceScaledUsd *= 0.6;
  }

  if (drawdownPct >= context.config.softDrawdownPct) {
    confidenceScaledUsd *= 0.5;
  }

  if (drawdownPct >= context.config.hardDrawdownPct * 0.85) {
    confidenceScaledUsd *= 0.25;
  }

  if (context.openPositions.length >= context.config.maxConcurrentPositions) {
    confidenceScaledUsd *= 0.75;
  }

  return Math.max(
    0,
    Math.min(
      confidenceScaledUsd,
      maxTradeUsd,
      deployableUsd,
      remainingPositionCapacityUsd
    )
  );
}

export async function generateManagedIntent(
  context: StrategyContext
): Promise<StrategyIntent> {
  if (context.portfolio.drawdownPct >= context.config.hardDrawdownPct) {
    const largestPosition = [...context.openPositions].sort(
      (a, b) => b.marketValueUsd - a.marketValueUsd
    )[0];

    if (largestPosition) {
      return {
        action: "SELL",
        inputMint: largestPosition.mint,
        outputMint: context.config.baseAssetMint,
        targetNotionalUsd: largestPosition.marketValueUsd,
        confidence: 1,
        reason: "Hard drawdown protection triggered",
        metadata: {
          symbol: largestPosition.symbol,
          forcedExit: true,
        },
      };
    }

    return {
      action: "HOLD",
      confidence: 1,
      reason: "Hard drawdown protection active with no open positions",
    };
  }

  const signals = computeSignals(context);

  console.log("----- SIGNAL DEBUG -----");
  for (const s of signals) {
    console.log(
      `${s.symbol} | score=${s.score.toFixed(3)} | momentum=${s.momentumScore.toFixed(3)} | risk=${s.riskPenalty.toFixed(3)} | trend=${s.trendStrength.toFixed(3)} | confidence=${s.confidence.toFixed(3)} | direction=${s.direction}`
    );
  }
  console.log("------------------------");

  const bearishExit = findTopBearishExitCandidate(context, signals);
  if (bearishExit) {
    const pnlPct = getPositionPnlPct(bearishExit.position);

    let exitReason = `Bearish exit: ${bearishExit.signal.reason}`;
    if (pnlPct <= STOP_LOSS_PCT) {
      exitReason = `Stop-loss exit: ${bearishExit.signal.reason}`;
    } else if (
      pnlPct >= TAKE_PROFIT_PCT &&
      bearishExit.signal.score <= 0.5
    ) {
      exitReason = `Take-profit protection exit: ${bearishExit.signal.reason}`;
    }

    return {
      action: "SELL",
      inputMint: bearishExit.position.mint,
      outputMint: context.config.baseAssetMint,
      targetNotionalUsd: bearishExit.position.marketValueUsd,
      confidence: Math.max(bearishExit.signal.confidence, 0.7),
      reason: exitReason,
      metadata: {
        symbol: bearishExit.position.symbol,
        score: bearishExit.signal.score,
        exposurePct:
          context.portfolio.totalValueUsd > 0
            ? bearishExit.position.marketValueUsd /
              context.portfolio.totalValueUsd
            : 0,
        pnlPct,
      },
    };
  }

  const bestBullish = findTopBullishEntrySignal(signals);
  if (!bestBullish) {
    return {
      action: "HOLD",
      confidence: 0,
      reason: "No valid bullish signal",
    };
  }

  if (
    bestBullish.score < BASE_BULLISH_THRESHOLD ||
    bestBullish.trendStrength < 0.08 ||
    bestBullish.momentumScore < 0.52
  ) {
    return {
      action: "HOLD",
      confidence: bestBullish.confidence,
      reason: "Bullish signal below entry threshold",
      metadata: {
        symbol: bestBullish.symbol,
        score: bestBullish.score,
      },
    };
  }

  const extensionPct =
    bestBullish.anchorPrice > 0
      ? (bestBullish.currentPrice - bestBullish.anchorPrice) /
        bestBullish.anchorPrice
      : 0;

  if (extensionPct > MAX_ENTRY_EXTENSION_PCT) {
    return {
      action: "HOLD",
      confidence: bestBullish.confidence,
      reason: "Entry rejected by price-extension sanity check",
      metadata: {
        symbol: bestBullish.symbol,
        score: bestBullish.score,
        extensionPct,
      },
    };
  }

  const existingPosition = findPositionForSignal(
    bestBullish,
    context.openPositions
  );

  if (!existingPosition && !hasCapacityForNewPosition(context)) {
    return {
      action: "HOLD",
      confidence: bestBullish.confidence,
      reason: "Max concurrent positions reached",
      metadata: {
        symbol: bestBullish.symbol,
        score: bestBullish.score,
      },
    };
  }

  const targetNotionalUsd = computeAdjustedBuyNotional({
    context,
    signal: bestBullish,
    existingPosition,
  });

  if (targetNotionalUsd <= 0) {
    return {
      action: "HOLD",
      confidence: bestBullish.confidence,
      reason: "Sizing returned zero notional",
      metadata: {
        symbol: bestBullish.symbol,
        score: bestBullish.score,
      },
    };
  }

  return {
    action: "BUY",
    inputMint: context.config.baseAssetMint,
    outputMint: bestBullish.mint,
    targetNotionalUsd,
    confidence: bestBullish.confidence,
    reason: bestBullish.reason,
    metadata: {
      symbol: bestBullish.symbol,
      score: bestBullish.score,
      existingPositionUsd: existingPosition?.marketValueUsd ?? 0,
      strongSignal: bestBullish.score >= STRONG_BULLISH_THRESHOLD,
      extensionPct,
    },
  };
}
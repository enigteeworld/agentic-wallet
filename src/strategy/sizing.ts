import type {
  PositionRecord,
  StrategyContext,
  StrategyIntent,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findPositionForIntent(
  intent: StrategyIntent,
  context: StrategyContext
): PositionRecord | undefined {
  return context.openPositions.find((position) => {
    return (
      position.mint === intent.inputMint ||
      position.mint === intent.outputMint ||
      position.symbol === intent.inputMint ||
      position.symbol === intent.outputMint
    );
  });
}

function getPriceForSymbolOrMint(
  symbolOrMint: string | undefined,
  context: StrategyContext
): number {
  if (!symbolOrMint) return 0;
  return context.prices[symbolOrMint] ?? 0;
}

function getExistingOutputPosition(
  intent: StrategyIntent,
  context: StrategyContext
): PositionRecord | undefined {
  return context.openPositions.find((position) => {
    return (
      position.mint === intent.outputMint ||
      position.symbol === intent.outputMint
    );
  });
}

function getExposurePct(params: {
  navUsd: number;
  positionUsd: number;
}): number {
  if (params.navUsd <= 0) return 0;
  return params.positionUsd / params.navUsd;
}

function getCashPct(context: StrategyContext): number {
  const nav = context.portfolio.totalValueUsd;
  if (nav <= 0) return 1;
  return context.portfolio.availableCapitalUsd / nav;
}

function getDrawdownScaling(context: StrategyContext): number {
  const drawdownPct = context.portfolio.drawdownPct;

  if (drawdownPct >= context.config.hardDrawdownPct) {
    return 0;
  }

  if (drawdownPct >= context.config.softDrawdownPct) {
    return 0.5;
  }

  return 1;
}

function getConfidenceScaling(confidence: number): number {
  return clamp(confidence, 0, 1);
}

function getExposureScaling(params: {
  exposurePct: number;
  maxPositionPct: number;
}): number {
  if (params.maxPositionPct <= 0) return 1;

  const pressure = params.exposurePct / params.maxPositionPct;

  if (pressure >= 0.9) return 0.1;
  if (pressure >= 0.75) return 0.35;
  if (pressure >= 0.5) return 0.6;

  return 1;
}

function getCashReserveScaling(context: StrategyContext): number {
  const cashPct = getCashPct(context);

  if (cashPct <= context.config.minUsdcReservePct) {
    return 0;
  }

  const excessCashPct = cashPct - context.config.minUsdcReservePct;

  if (excessCashPct <= 0.05) return 0.5;
  if (excessCashPct <= 0.1) return 0.75;

  return 1;
}

export function computeTargetNotionalUsd(
  intent: StrategyIntent,
  context: StrategyContext
): number {
  const nav = context.portfolio.totalValueUsd;
  if (nav <= 0) return 0;

  if (intent.action === "BUY") {
    const maxTradeUsd = nav * context.config.maxTradePct;
    const maxPositionUsd = nav * context.config.maxPositionPct;
    const reserveUsd = nav * context.config.minUsdcReservePct;

    const deployableUsd = Math.max(
      0,
      context.portfolio.availableCapitalUsd - reserveUsd
    );

    const existingPosition = getExistingOutputPosition(intent, context);
    const currentPositionUsd = existingPosition?.marketValueUsd ?? 0;
    const remainingPositionCapacityUsd = Math.max(
      0,
      maxPositionUsd - currentPositionUsd
    );

    const exposurePct = getExposurePct({
      navUsd: nav,
      positionUsd: currentPositionUsd,
    });

    const confidenceScale = getConfidenceScaling(intent.confidence);
    const exposureScale = getExposureScaling({
      exposurePct,
      maxPositionPct: context.config.maxPositionPct,
    });
    const drawdownScale = getDrawdownScaling(context);
    const cashScale = getCashReserveScaling(context);

    let confidenceScaledUsd = maxTradeUsd * confidenceScale;
    confidenceScaledUsd *= exposureScale;
    confidenceScaledUsd *= drawdownScale;
    confidenceScaledUsd *= cashScale;

    const signalScore =
      typeof intent.metadata?.score === "number"
        ? intent.metadata.score
        : undefined;

    if (typeof signalScore === "number" && signalScore >= 0.72) {
      confidenceScaledUsd *= 1.15;
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

  if (intent.action === "SELL") {
    const position = findPositionForIntent(intent, context);
    if (!position) return 0;

    if (typeof intent.targetNotionalUsd === "number" && intent.targetNotionalUsd > 0) {
      return Math.max(0, Math.min(intent.targetNotionalUsd, position.marketValueUsd));
    }

    return Math.max(0, position.marketValueUsd);
  }

  return 0;
}

export function computeExecutionAmountUi(
  intent: StrategyIntent,
  context: StrategyContext
): number {
  if (!intent.targetNotionalUsd || intent.targetNotionalUsd <= 0) {
    return 0;
  }

  if (intent.action === "BUY") {
    /**
     * For CARV-1, base asset is USDC, so USD notional maps directly to amountUi.
     * If later you allow non-stable base assets, convert through price here.
     */
    if (context.config.baseAssetMint === "USDC") {
      return intent.targetNotionalUsd;
    }

    const inputPriceUsd = getPriceForSymbolOrMint(intent.inputMint, context);
    if (inputPriceUsd <= 0) return 0;

    return intent.targetNotionalUsd / inputPriceUsd;
  }

  if (intent.action === "SELL") {
    const position = findPositionForIntent(intent, context);
    if (!position) return 0;

    const sellPriceUsd =
      getPriceForSymbolOrMint(position.symbol, context) ||
      getPriceForSymbolOrMint(position.mint, context) ||
      position.currentPriceUsd;

    if (sellPriceUsd <= 0) {
      return Math.max(0, position.quantity);
    }

    const quantityFromNotional = intent.targetNotionalUsd / sellPriceUsd;

    return Math.max(0, Math.min(quantityFromNotional, position.quantity));
  }

  return 0;
}
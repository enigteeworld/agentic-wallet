import type {
  PositionRecord,
  StrategyContext,
  StrategyIntent,
} from "./types";

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

export function computeTargetNotionalUsd(
  intent: StrategyIntent,
  context: StrategyContext
): number {
  const nav = context.vault.totalValueUsd;
  if (nav <= 0) return 0;

  if (intent.action === "BUY") {
    const maxTradeUsd = nav * context.config.maxTradePct;
    const maxPositionUsd = nav * context.config.maxPositionPct;
    const reserveUsd = nav * context.config.minUsdcReservePct;

    const deployableUsd = Math.max(
      0,
      context.vault.availableCapitalUsd - reserveUsd
    );

    const existingPosition = context.openPositions.find((position) => {
      return (
        position.mint === intent.outputMint ||
        position.symbol === intent.outputMint
      );
    });

    const currentPositionUsd = existingPosition?.marketValueUsd ?? 0;
    const remainingPositionCapacityUsd = Math.max(
      0,
      maxPositionUsd - currentPositionUsd
    );

    const confidenceScaledUsd = maxTradeUsd * intent.confidence;

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

    return Math.max(
      0,
      Math.min(quantityFromNotional, position.quantity)
    );
  }

  return 0;
}
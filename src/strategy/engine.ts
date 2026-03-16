import { computeSignals } from "./signals";
import { computeTargetNotionalUsd } from "./sizing";
import type {
  PositionRecord,
  SignalResult,
  StrategyContext,
  StrategyIntent,
} from "./types";

function findPositionForSignal(
  signal: SignalResult,
  positions: PositionRecord[]
): PositionRecord | undefined {
  return positions.find((position) => {
    return (
      position.symbol === signal.symbol ||
      position.mint === signal.mint
    );
  });
}

function hasCapacityForNewPosition(context: StrategyContext): boolean {
  return context.openPositions.length < context.config.maxConcurrentPositions;
}

function findTopBearishExitCandidate(
  context: StrategyContext,
  signals: SignalResult[]
): { signal: SignalResult; position: PositionRecord } | undefined {
  const candidates = signals
    .map((signal) => ({
      signal,
      position: findPositionForSignal(signal, context.openPositions),
    }))
    .filter((item): item is { signal: SignalResult; position: PositionRecord } => {
      return Boolean(item.position);
    })
    .filter((item) => item.signal.direction === "BEARISH")
    .sort((a, b) => {
      const aScore = a.position.marketValueUsd * (1 - a.signal.score);
      const bScore = b.position.marketValueUsd * (1 - b.signal.score);
      return bScore - aScore;
    });

  return candidates[0];
}

function findTopBullishEntrySignal(
  context: StrategyContext,
  signals: SignalResult[]
): SignalResult | undefined {
  return [...signals]
    .filter((signal) => signal.direction === "BULLISH")
    .sort((a, b) => b.score - a.score)[0];
}

export async function generateIntent(
  context: StrategyContext
): Promise<StrategyIntent> {
  if (context.vault.drawdownPct >= context.config.hardDrawdownPct) {
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

  const bearishExit = findTopBearishExitCandidate(context, signals);
  if (bearishExit) {
    return {
      action: "SELL",
      inputMint: bearishExit.position.mint,
      outputMint: context.config.baseAssetMint,
      targetNotionalUsd: bearishExit.position.marketValueUsd,
      confidence: Math.max(bearishExit.signal.confidence, 0.7),
      reason: `Bearish exit: ${bearishExit.signal.reason}`,
      metadata: {
        symbol: bearishExit.position.symbol,
        score: bearishExit.signal.score,
      },
    };
  }

  const bestBullish = findTopBullishEntrySignal(context, signals);
  if (!bestBullish) {
    return {
      action: "HOLD",
      confidence: 0,
      reason: "No valid bullish signal",
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

  const draftIntent: StrategyIntent = {
    action: "BUY",
    inputMint: context.config.baseAssetMint,
    outputMint: bestBullish.mint,
    confidence: bestBullish.confidence,
    reason: bestBullish.reason,
    metadata: {
      symbol: bestBullish.symbol,
      score: bestBullish.score,
    },
  };

  const targetNotionalUsd = computeTargetNotionalUsd(draftIntent, context);

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
    ...draftIntent,
    targetNotionalUsd,
  };
}
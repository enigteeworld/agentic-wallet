import { computeSignals } from "./signals";
import { computeTargetNotionalUsd } from "./sizing";
import type { StrategyContext, StrategyIntent } from "./types";

export async function generateIntent(
  context: StrategyContext,
): Promise<StrategyIntent> {
  if (context.vault.drawdownPct >= context.config.hardDrawdownPct) {
    const largestPosition = [...context.openPositions].sort(
      (a, b) => b.marketValueUsd - a.marketValueUsd,
    )[0];

    if (largestPosition) {
      return {
        action: "SELL",
        inputMint: largestPosition.mint,
        outputMint: context.config.baseAssetMint,
        targetNotionalUsd: largestPosition.marketValueUsd,
        confidence: 1,
        reason: "Hard drawdown protection triggered",
      };
    }

    return {
      action: "HOLD",
      confidence: 1,
      reason: "Hard drawdown protection active with no open positions",
    };
  }

  const signals = computeSignals(context);
  const best = [...signals].sort((a, b) => b.confidence - a.confidence)[0];

  if (!best || best.direction !== "BULLISH") {
    return {
      action: "HOLD",
      confidence: best?.confidence ?? 0,
      reason: best?.reason ?? "No valid signal",
    };
  }

  const draftIntent: StrategyIntent = {
    action: "BUY",
    inputMint: context.config.baseAssetMint,
    outputMint: best.mint,
    confidence: best.confidence,
    reason: best.reason,
  };

  const targetNotionalUsd = computeTargetNotionalUsd(draftIntent, context);

  if (targetNotionalUsd <= 0) {
    return {
      action: "HOLD",
      confidence: best.confidence,
      reason: "Sizing returned zero notional",
    };
  }

  return {
    ...draftIntent,
    targetNotionalUsd,
    metadata: {
      symbol: best.symbol,
      score: best.score,
    },
  };
}
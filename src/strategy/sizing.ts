import type { StrategyContext, StrategyIntent } from "./types";

export function computeTargetNotionalUsd(
  intent: StrategyIntent,
  context: StrategyContext,
): number {
  const nav = context.vault.totalValueUsd;
  const maxTradeUsd = nav * context.config.maxTradePct;
  const reserveUsd = nav * context.config.minUsdcReservePct;
  const deployableUsd = Math.max(
    0,
    context.vault.availableCapitalUsd - reserveUsd,
  );

  const confidenceScaledUsd = maxTradeUsd * intent.confidence;

  return Math.max(
    0,
    Math.min(confidenceScaledUsd, maxTradeUsd, deployableUsd),
  );
}
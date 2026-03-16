import type {
  PolicyDecision,
  StrategyContext,
  StrategyIntent,
} from "./types";

export function validateIntent(
  intent: StrategyIntent,
  context: StrategyContext,
): PolicyDecision {
  const violations: string[] = [];
  const cfg = context.config;
  const nav = context.vault.totalValueUsd;

  if (intent.action === "HOLD") {
    return { approved: true, reason: "No action requested" };
  }

  if (intent.confidence < cfg.minConfidence) {
    violations.push("confidence_below_threshold");
  }

  if (context.vault.drawdownPct >= cfg.hardDrawdownPct && intent.action === "BUY") {
    violations.push("hard_drawdown_lock");
  }

  const dailyTrades = context.recentTrades.filter((t) => {
    const tradeDate = new Date(t.timestamp);
    const now = new Date(context.now);
    return tradeDate.toDateString() === now.toDateString();
  }).length;

  if (dailyTrades >= cfg.maxDailyTrades) {
    violations.push("daily_trade_cap_reached");
  }

  const reserveUsd = nav * cfg.minUsdcReservePct;
  if (intent.action === "BUY" && context.vault.availableCapitalUsd <= reserveUsd) {
    violations.push("reserve_protection_active");
  }

  if (violations.length > 0) {
    return {
      approved: false,
      reason: "Intent rejected by risk policy",
      violations,
    };
  }

  return {
    approved: true,
    reason: "Intent approved",
    adjustedNotionalUsd: intent.targetNotionalUsd,
  };
}
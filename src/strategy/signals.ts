import type { SignalResult, StrategyContext } from "./types";

const SYMBOL_TO_MINT: Record<string, string> = {
  SOL: "SOL",
  JUP: "JUP",
};

export function computeSignals(context: StrategyContext): SignalResult[] {
  return context.config.allowedAssets.map((symbol) => {
    const price = context.prices[symbol] ?? 0;

    if (!price) {
      return {
        symbol,
        mint: SYMBOL_TO_MINT[symbol] ?? symbol,
        score: 0,
        confidence: 0,
        direction: "NEUTRAL",
        reason: "No price data",
      };
    }

    return {
      symbol,
      mint: SYMBOL_TO_MINT[symbol] ?? symbol,
      score: 0.5,
      confidence: 0.5,
      direction: "NEUTRAL",
      reason: "Signal model placeholder",
    };
  });
}
import type {
  ExecutionResult,
  PerformanceSnapshot,
  PortfolioState,
  PositionRecord,
  TradeRecord,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function safeNumber(value: number | undefined | null, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function computeUnrealizedPnl(position: PositionRecord): number {
  return (
    (position.currentPriceUsd - position.avgEntryPriceUsd) * position.quantity
  );
}

export function computePositionMarketValue(position: PositionRecord): number {
  return position.currentPriceUsd * position.quantity;
}

export function upsertPositionFromExecution(params: {
  positions: PositionRecord[];
  execution: ExecutionResult;
  outputSymbol?: string;
  outputPriceUsd?: number;
}): PositionRecord[] {
  const { positions, execution, outputSymbol, outputPriceUsd } = params;

  if (!execution.success) return positions;

  const mint = execution.outputMint;
  const symbol = outputSymbol ?? execution.outputMint;
  const quantity = safeNumber(execution.outputAmount, 0);
  const effectivePriceUsd = safeNumber(
    execution.effectivePriceUsd,
    outputPriceUsd ?? 0
  );

  if (quantity <= 0) return positions;

  const existing = positions.find((position) => position.mint === mint);

  if (!existing) {
    const created: PositionRecord = {
      mint,
      symbol,
      quantity,
      avgEntryPriceUsd: effectivePriceUsd,
      currentPriceUsd: effectivePriceUsd,
      marketValueUsd: quantity * effectivePriceUsd,
      unrealizedPnlUsd: 0,
      updatedAt: nowIso(),
    };

    return [...positions, created];
  }

  const totalCost =
    existing.quantity * existing.avgEntryPriceUsd +
    quantity * effectivePriceUsd;
  const totalQuantity = existing.quantity + quantity;
  const avgEntryPriceUsd = totalQuantity > 0 ? totalCost / totalQuantity : 0;
  const currentPriceUsd = effectivePriceUsd || existing.currentPriceUsd;
  const marketValueUsd = totalQuantity * currentPriceUsd;

  const updated: PositionRecord = {
    ...existing,
    symbol,
    quantity: totalQuantity,
    avgEntryPriceUsd,
    currentPriceUsd,
    marketValueUsd,
    unrealizedPnlUsd: (currentPriceUsd - avgEntryPriceUsd) * totalQuantity,
    updatedAt: nowIso(),
  };

  return positions.map((position) =>
    position.mint === mint ? updated : position
  );
}

export function reducePositionFromExecution(params: {
  positions: PositionRecord[];
  execution: ExecutionResult;
  inputPriceUsd?: number;
}): {
  positions: PositionRecord[];
  realizedPnlUsd: number;
} {
  const { positions, execution, inputPriceUsd } = params;

  if (!execution.success) {
    return {
      positions,
      realizedPnlUsd: 0,
    };
  }

  const mint = execution.inputMint;
  const existing = positions.find((position) => position.mint === mint);

  if (!existing) {
    return {
      positions,
      realizedPnlUsd: 0,
    };
  }

  const quantitySold = safeNumber(execution.inputAmount, 0);
  if (quantitySold <= 0) {
    return {
      positions,
      realizedPnlUsd: 0,
    };
  }

  const matchedQuantity = Math.min(existing.quantity, quantitySold);

  const salePriceUsd = safeNumber(
    execution.effectivePriceUsd,
    inputPriceUsd ?? existing.currentPriceUsd
  );

  const grossRealizedPnlUsd =
    (salePriceUsd - existing.avgEntryPriceUsd) * matchedQuantity;

  const netRealizedPnlUsd =
    grossRealizedPnlUsd - safeNumber(execution.feesUsd, 0);

  const remainingQuantity = existing.quantity - matchedQuantity;

  if (remainingQuantity <= 0) {
    return {
      positions: positions.filter((position) => position.mint !== mint),
      realizedPnlUsd: netRealizedPnlUsd,
    };
  }

  const currentPriceUsd = salePriceUsd || existing.currentPriceUsd;

  const updated: PositionRecord = {
    ...existing,
    quantity: remainingQuantity,
    currentPriceUsd,
    marketValueUsd: remainingQuantity * currentPriceUsd,
    unrealizedPnlUsd:
      (currentPriceUsd - existing.avgEntryPriceUsd) * remainingQuantity,
    updatedAt: nowIso(),
  };

  return {
    positions: positions.map((position) =>
      position.mint === mint ? updated : position
    ),
    realizedPnlUsd: netRealizedPnlUsd,
  };
}

export function refreshPositionsWithPrices(params: {
  positions: PositionRecord[];
  prices: Record<string, number>;
}): PositionRecord[] {
  return params.positions.map((position) => {
    const currentPriceUsd =
      params.prices[position.symbol] ??
      params.prices[position.mint] ??
      position.currentPriceUsd;

    const marketValueUsd = currentPriceUsd * position.quantity;
    const unrealizedPnlUsd =
      (currentPriceUsd - position.avgEntryPriceUsd) * position.quantity;

    return {
      ...position,
      currentPriceUsd,
      marketValueUsd,
      unrealizedPnlUsd,
      updatedAt: nowIso(),
    };
  });
}

export function buildPerformanceSnapshot(params: {
  portfolioState: PortfolioState;
  positions: PositionRecord[];
}): PerformanceSnapshot {
  const grossExposureUsd = params.positions.reduce(
    (sum, position) => sum + position.marketValueUsd,
    0
  );

  const unrealizedPnlUsd = params.positions.reduce(
    (sum, position) => sum + position.unrealizedPnlUsd,
    0
  );

  const navUsd = params.portfolioState.totalValueUsd;

  const cumulativeReturnPct =
    params.portfolioState.highWaterMarkUsd > 0
      ? (navUsd - params.portfolioState.highWaterMarkUsd) /
        params.portfolioState.highWaterMarkUsd
      : 0;

  const cashPct =
    navUsd > 0 ? params.portfolioState.availableCapitalUsd / navUsd : 1;

  return {
    navUsd,
    realizedPnlUsd: params.portfolioState.realizedPnlUsd,
    unrealizedPnlUsd,
    cumulativeReturnPct,
    drawdownPct: params.portfolioState.drawdownPct,
    highWaterMarkUsd: params.portfolioState.highWaterMarkUsd,
    grossExposureUsd,
    cashPct,
    updatedAt: nowIso(),
  };
}

export function tradeRecordFromExecution(params: {
  execution: ExecutionResult;
  reason: string;
  side: "BUY" | "SELL";
  realizedPnlUsd?: number;
}): TradeRecord {
  const { execution, reason, side, realizedPnlUsd } = params;

  return {
    id:
      execution.txSignature ??
      `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: execution.executedAt,
    side,
    inputMint: execution.inputMint,
    outputMint: execution.outputMint,
    inputAmount: execution.inputAmount,
    outputAmount: execution.outputAmount,
    executionPriceUsd: execution.effectivePriceUsd ?? 0,
    feesUsd: execution.feesUsd ?? 0,
    slippageBps: execution.slippageBps ?? 0,
    txSignature: execution.txSignature ?? "simulated",
    strategyReason: reason,
    realizedPnlUsd,
  };
}
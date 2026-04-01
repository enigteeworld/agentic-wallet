import fs from "fs";
import path from "path";
import type {
  PositionRecord,
  TradeRecord,
} from "../types";

export type ManagedMarketState = {
  positions: PositionRecord[];
  trades: TradeRecord[];
};

type ManagedBuyInput = {
  agentId: string;
  symbol: string;
  mint: string;
  notionalUsd: number;
  priceUsd: number;
  reason: string;
  slippageBps?: number;
  timestamp?: string;
};

type ManagedSellInput = {
  agentId: string;
  symbol: string;
  mint: string;
  quantity?: number;
  notionalUsd?: number;
  priceUsd: number;
  reason: string;
  slippageBps?: number;
  timestamp?: string;
};

type MarkToMarketInput = {
  agentId: string;
  prices: Record<string, number>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function roundToDecimals(value: number, decimals = 9): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function managedStateDir(): string {
  return path.resolve(process.cwd(), "state", "managed");
}

function ensureManagedStateDir(): void {
  fs.mkdirSync(managedStateDir(), { recursive: true });
}

function positionsPath(agentId: string): string {
  return path.join(managedStateDir(), `${agentId}.positions.json`);
}

function tradesPath(agentId: string): string {
  return path.join(managedStateDir(), `${agentId}.trades.json`);
}

function readJsonFile<T>(filepath: string, fallback: T): T {
  if (!fs.existsSync(filepath)) return fallback;

  try {
    const raw = fs.readFileSync(filepath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filepath: string, value: unknown): void {
  fs.writeFileSync(filepath, JSON.stringify(value, null, 2));
}

function makeTradeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSimulatedSignature(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safePriceForPosition(
  position: PositionRecord,
  prices: Record<string, number>
): number {
  return (
    prices[position.symbol] ??
    prices[position.mint] ??
    position.currentPriceUsd ??
    position.avgEntryPriceUsd ??
    0
  );
}

export function loadManagedMarketState(agentId: string): ManagedMarketState {
  ensureManagedStateDir();

  return {
    positions: readJsonFile<PositionRecord[]>(positionsPath(agentId), []),
    trades: readJsonFile<TradeRecord[]>(tradesPath(agentId), []),
  };
}

export function saveManagedMarketState(
  agentId: string,
  state: ManagedMarketState
): void {
  ensureManagedStateDir();
  writeJsonFile(positionsPath(agentId), state.positions);
  writeJsonFile(tradesPath(agentId), state.trades);
}

export function markManagedPositionsToMarket(
  input: MarkToMarketInput
): ManagedMarketState {
  const state = loadManagedMarketState(input.agentId);

  const positions = state.positions.map((position) => {
    const currentPriceUsd = safePriceForPosition(position, input.prices);
    const marketValueUsd = roundToDecimals(position.quantity * currentPriceUsd);
    const unrealizedPnlUsd = roundToDecimals(
      (currentPriceUsd - position.avgEntryPriceUsd) * position.quantity
    );

    return {
      ...position,
      currentPriceUsd,
      marketValueUsd,
      unrealizedPnlUsd,
      updatedAt: nowIso(),
    };
  });

  const nextState: ManagedMarketState = {
    positions,
    trades: state.trades,
  };

  saveManagedMarketState(input.agentId, nextState);
  return nextState;
}

export function recordManagedBuy(input: ManagedBuyInput): ManagedMarketState {
  const state = loadManagedMarketState(input.agentId);
  const timestamp = input.timestamp ?? nowIso();
  const slippageBps = input.slippageBps ?? 0;

  if (input.priceUsd <= 0 || input.notionalUsd <= 0) {
    return state;
  }

  const quantity = roundToDecimals(input.notionalUsd / input.priceUsd);
  if (quantity <= 0) {
    return state;
  }

  const existingIndex = state.positions.findIndex(
    (position) =>
      position.mint === input.mint ||
      position.symbol === input.symbol
  );

  let nextPositions = [...state.positions];

  if (existingIndex === -1) {
    nextPositions.push({
      mint: input.mint,
      symbol: input.symbol,
      quantity,
      avgEntryPriceUsd: input.priceUsd,
      currentPriceUsd: input.priceUsd,
      marketValueUsd: roundToDecimals(quantity * input.priceUsd),
      unrealizedPnlUsd: 0,
      updatedAt: timestamp,
    });
  } else {
    const existing = nextPositions[existingIndex];
    const nextQuantity = roundToDecimals(existing.quantity + quantity);
    const nextCostBasis =
      existing.quantity * existing.avgEntryPriceUsd +
      quantity * input.priceUsd;
    const nextAvgEntryPriceUsd =
      nextQuantity > 0 ? roundToDecimals(nextCostBasis / nextQuantity) : 0;

    nextPositions[existingIndex] = {
      ...existing,
      quantity: nextQuantity,
      avgEntryPriceUsd: nextAvgEntryPriceUsd,
      currentPriceUsd: input.priceUsd,
      marketValueUsd: roundToDecimals(nextQuantity * input.priceUsd),
      unrealizedPnlUsd: roundToDecimals(
        (input.priceUsd - nextAvgEntryPriceUsd) * nextQuantity
      ),
      updatedAt: timestamp,
    };
  }

  const trade: TradeRecord = {
    id: makeTradeId("managed-buy"),
    timestamp,
    side: "BUY",
    inputMint: "USDC",
    outputMint: input.mint,
    inputAmount: roundToDecimals(input.notionalUsd),
    outputAmount: quantity,
    executionPriceUsd: input.priceUsd,
    feesUsd: 0,
    slippageBps,
    txSignature: makeSimulatedSignature("managed-buy"),
    strategyReason: input.reason,
    realizedPnlUsd: 0,
  };

  const nextState: ManagedMarketState = {
    positions: nextPositions,
    trades: [...state.trades, trade],
  };

  saveManagedMarketState(input.agentId, nextState);
  return nextState;
}

export function recordManagedSell(input: ManagedSellInput): ManagedMarketState {
  const state = loadManagedMarketState(input.agentId);
  const timestamp = input.timestamp ?? nowIso();
  const slippageBps = input.slippageBps ?? 0;

  const index = state.positions.findIndex(
    (position) =>
      position.mint === input.mint ||
      position.symbol === input.symbol
  );

  if (index === -1 || input.priceUsd <= 0) {
    return state;
  }

  const existing = state.positions[index];

  let quantityToSell = 0;

  if (typeof input.quantity === "number" && input.quantity > 0) {
    quantityToSell = Math.min(existing.quantity, input.quantity);
  } else if (typeof input.notionalUsd === "number" && input.notionalUsd > 0) {
    quantityToSell = Math.min(existing.quantity, input.notionalUsd / input.priceUsd);
  } else {
    quantityToSell = existing.quantity;
  }

  quantityToSell = roundToDecimals(quantityToSell);

  if (quantityToSell <= 0) {
    return state;
  }

  const saleNotionalUsd = roundToDecimals(quantityToSell * input.priceUsd);
  const realizedPnlUsd = roundToDecimals(
    (input.priceUsd - existing.avgEntryPriceUsd) * quantityToSell
  );

  const remainingQuantity = roundToDecimals(existing.quantity - quantityToSell);

  let nextPositions = [...state.positions];

  if (remainingQuantity <= 0) {
    nextPositions.splice(index, 1);
  } else {
    nextPositions[index] = {
      ...existing,
      quantity: remainingQuantity,
      currentPriceUsd: input.priceUsd,
      marketValueUsd: roundToDecimals(remainingQuantity * input.priceUsd),
      unrealizedPnlUsd: roundToDecimals(
        (input.priceUsd - existing.avgEntryPriceUsd) * remainingQuantity
      ),
      updatedAt: timestamp,
    };
  }

  const trade: TradeRecord = {
    id: makeTradeId("managed-sell"),
    timestamp,
    side: "SELL",
    inputMint: input.mint,
    outputMint: "USDC",
    inputAmount: quantityToSell,
    outputAmount: saleNotionalUsd,
    executionPriceUsd: input.priceUsd,
    feesUsd: 0,
    slippageBps,
    txSignature: makeSimulatedSignature("managed-sell"),
    strategyReason: input.reason,
    realizedPnlUsd,
  };

  const nextState: ManagedMarketState = {
    positions: nextPositions,
    trades: [...state.trades, trade],
  };

  saveManagedMarketState(input.agentId, nextState);
  return nextState;
}

export function getManagedExposureUsd(agentId: string): number {
  const state = loadManagedMarketState(agentId);

  return roundToDecimals(
    state.positions.reduce((sum, position) => sum + position.marketValueUsd, 0)
  );
}

export function resetManagedMarketState(agentId: string): void {
  saveManagedMarketState(agentId, {
    positions: [],
    trades: [],
  });
}
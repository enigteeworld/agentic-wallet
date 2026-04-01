import fs from "fs";
import path from "path";
import {
  buildPerformanceSnapshot,
  reducePositionFromExecution,
  refreshPositionsWithPrices,
  tradeRecordFromExecution,
  upsertPositionFromExecution,
} from "../../strategy/pnl";
import type {
  ExecutionResult,
  PerformanceSnapshot,
  PortfolioState,
  PositionRecord,
  TradeRecord,
} from "../../strategy/types";

const MINT_TO_SYMBOL: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
};

type AccountingState = {
  trades: TradeRecord[];
  positions: PositionRecord[];
  performance?: PerformanceSnapshot;
};

function accountingDir(): string {
  return path.resolve(process.cwd(), "state", "vault");
}

function ensureAccountingDir(): void {
  fs.mkdirSync(accountingDir(), { recursive: true });
}

function tradesPath(agentId: string): string {
  return path.join(accountingDir(), `${agentId}.trades.json`);
}

function positionsPath(agentId: string): string {
  return path.join(accountingDir(), `${agentId}.positions.json`);
}

function performancePath(agentId: string): string {
  return path.join(accountingDir(), `${agentId}.performance.json`);
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

function inferSymbol(mintOrSymbol: string): string {
  return MINT_TO_SYMBOL[mintOrSymbol] ?? mintOrSymbol;
}

export function loadAccountingState(agentId: string): AccountingState {
  ensureAccountingDir();

  return {
    trades: readJsonFile<TradeRecord[]>(tradesPath(agentId), []),
    positions: readJsonFile<PositionRecord[]>(positionsPath(agentId), []),
    performance: readJsonFile<PerformanceSnapshot | undefined>(
      performancePath(agentId),
      undefined
    ),
  };
}

export function saveAccountingState(params: {
  agentId: string;
  trades: TradeRecord[];
  positions: PositionRecord[];
  performance: PerformanceSnapshot;
}): void {
  ensureAccountingDir();

  writeJsonFile(tradesPath(params.agentId), params.trades);
  writeJsonFile(positionsPath(params.agentId), params.positions);
  writeJsonFile(performancePath(params.agentId), params.performance);
}

export function updateAccountingFromExecution(params: {
  agentId: string;
  execution: ExecutionResult;
  portfolioState: PortfolioState;
  prices?: Record<string, number>;
  reason: string;
  side: "BUY" | "SELL";
}): {
  trades: TradeRecord[];
  positions: PositionRecord[];
  performance: PerformanceSnapshot;
  realizedPnlUsd: number;
} {
  const state = loadAccountingState(params.agentId);
  const prices = params.prices ?? {};

  let positions = refreshPositionsWithPrices({
    positions: state.positions,
    prices,
  });

  let realizedPnlUsd = 0;

  if (params.side === "BUY") {
    positions = upsertPositionFromExecution({
      positions,
      execution: params.execution,
      outputSymbol: inferSymbol(params.execution.outputMint),
      outputPriceUsd:
        prices[params.execution.outputMint] ??
        prices[inferSymbol(params.execution.outputMint)],
    });
  } else {
    const reduced = reducePositionFromExecution({
      positions,
      execution: params.execution,
      inputPriceUsd:
        prices[params.execution.inputMint] ??
        prices[inferSymbol(params.execution.inputMint)] ??
        params.execution.effectivePriceUsd,
    });

    positions = reduced.positions;
    realizedPnlUsd = reduced.realizedPnlUsd;
  }

  positions = refreshPositionsWithPrices({
    positions,
    prices,
  });

  const trade = tradeRecordFromExecution({
    execution: params.execution,
    reason: params.reason,
    side: params.side,
    realizedPnlUsd,
  });

  const trades = [...state.trades, trade];

  const grossExposureUsd = positions.reduce(
    (sum, position) => sum + position.marketValueUsd,
    0
  );

  const unrealizedPnlUsd = positions.reduce(
    (sum, position) => sum + position.unrealizedPnlUsd,
    0
  );

  const availableCapitalUsd = Math.max(
    0,
    params.portfolioState.totalValueUsd - grossExposureUsd
  );

  const nextPortfolioState: PortfolioState = {
    ...params.portfolioState,
    availableCapitalUsd,
    deployedCapitalUsd: grossExposureUsd,
    grossExposureUsd,
    netExposureUsd: grossExposureUsd,
    realizedPnlUsd: params.portfolioState.realizedPnlUsd + realizedPnlUsd,
    unrealizedPnlUsd,
  };

  const performance = buildPerformanceSnapshot({
    portfolioState: nextPortfolioState,
    positions,
  });

  saveAccountingState({
    agentId: params.agentId,
    trades,
    positions,
    performance,
  });

  return {
    trades,
    positions,
    performance,
    realizedPnlUsd,
  };
}
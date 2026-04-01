import { createManagedStrategyRuntime } from ".";
import { loadManagedMarketState } from "./marketState";
import type { PositionRecord, TradeRecord } from "../types";

export type ManagedOverviewStatus = {
  totalUsers: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalShares: number;
  totalValue: number;
  liquidValue: number;
  investedValue: number;
  reservedForWithdrawals: number;
  sharePrice: number;
  pendingWithdrawalAmount: number;
  pendingWithdrawalCount: number;
  updatedAt: string;
};

export type ManagedPositionRow = {
  symbol: string;
  mint: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
  unrealizedPnlUsd: number;
  updatedAt: string;
};

export type ManagedTradeRow = {
  id: string;
  timestamp: string;
  side: "BUY" | "SELL";
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  executionPriceUsd: number;
  feesUsd: number;
  slippageBps: number;
  txSignature: string;
  strategyReason: string;
  realizedPnlUsd?: number;
};

export type ManagedWalletPositionStatus = {
  wallet: string;
  shares: number;
  sharePrice: number;
  currentValue: number;
  totalDeposited: number;
  totalWithdrawn: number;
  netDeposited: number;
  pnlAbsolute: number;
  pnlPercent: number;
  pendingWithdrawalAmount: number;
  pendingWithdrawalShares: number;
  createdAt?: string;
  updatedAt?: string;
};

function roundToDecimals(value: number, decimals = 9): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function getManagedOverviewStatus(): ManagedOverviewStatus {
  const runtime = createManagedStrategyRuntime();
  const overview = runtime.getOverview();

  return {
    totalUsers: overview.totalUsers,
    totalDeposited: overview.totalDeposited,
    totalWithdrawn: overview.totalWithdrawn,
    totalShares: overview.valuation.totalShares,
    totalValue: overview.valuation.totalValue,
    liquidValue: overview.valuation.liquidValue,
    investedValue: overview.valuation.investedValue,
    reservedForWithdrawals: overview.valuation.reservedForWithdrawals,
    sharePrice: overview.valuation.sharePrice,
    pendingWithdrawalAmount: overview.pendingWithdrawalAmount,
    pendingWithdrawalCount: overview.pendingWithdrawalCount,
    updatedAt: overview.valuation.updatedAt,
  };
}

export function getManagedPositionsStatus(agentId: string): ManagedPositionRow[] {
  const state = loadManagedMarketState(agentId);

  return state.positions.map((position: PositionRecord) => ({
    symbol: position.symbol,
    mint: position.mint,
    quantity: position.quantity,
    avgEntryPriceUsd: position.avgEntryPriceUsd,
    currentPriceUsd: position.currentPriceUsd,
    marketValueUsd: position.marketValueUsd,
    unrealizedPnlUsd: position.unrealizedPnlUsd,
    updatedAt: position.updatedAt,
  }));
}

export function getManagedTradesStatus(
  agentId: string,
  limit = 10
): ManagedTradeRow[] {
  const state = loadManagedMarketState(agentId);

  return [...state.trades]
    .sort((a: TradeRecord, b: TradeRecord) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, limit)
    .map((trade: TradeRecord) => ({
      id: trade.id,
      timestamp: trade.timestamp,
      side: trade.side,
      inputMint: trade.inputMint,
      outputMint: trade.outputMint,
      inputAmount: trade.inputAmount,
      outputAmount: trade.outputAmount,
      executionPriceUsd: trade.executionPriceUsd,
      feesUsd: trade.feesUsd,
      slippageBps: trade.slippageBps,
      txSignature: trade.txSignature,
      strategyReason: trade.strategyReason,
      realizedPnlUsd: trade.realizedPnlUsd,
    }));
}

export function getManagedWalletPositionStatus(
  wallet: string
): ManagedWalletPositionStatus | null {
  const runtime = createManagedStrategyRuntime();
  const position = runtime.getUserPosition(wallet);

  if (!position) {
    return null;
  }

  return {
    wallet: position.wallet,
    shares: position.shares,
    sharePrice: position.sharePrice,
    currentValue: position.currentValue,
    totalDeposited: position.totalDeposited,
    totalWithdrawn: position.totalWithdrawn,
    netDeposited: position.netDeposited,
    pnlAbsolute: roundToDecimals(position.pnlAbsolute),
    pnlPercent: roundToDecimals(position.pnlPercent),
    pendingWithdrawalAmount: position.pendingWithdrawalAmount,
    pendingWithdrawalShares: position.pendingWithdrawalShares,
    createdAt: position.createdAt,
    updatedAt: position.updatedAt,
  };
}
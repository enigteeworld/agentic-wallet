export type StrategyAction = "BUY" | "SELL" | "REBALANCE" | "HOLD";

export type VaultState = {
  vaultId: string;
  totalValueUsd: number;
  availableCapitalUsd: number;
  reservedCapitalUsd: number;
  deployedCapitalUsd: number;
  baseAssetMint: string;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  grossExposureUsd: number;
  netExposureUsd: number;
  drawdownPct: number;
  highWaterMarkUsd: number;
  lastSyncAt: string;
};

export type BalanceSnapshot = {
  mint: string;
  symbol: string;
  amount: number;
  valueUsd: number;
};

export type PositionRecord = {
  mint: string;
  symbol: string;
  quantity: number;
  avgEntryPriceUsd: number;
  currentPriceUsd: number;
  marketValueUsd: number;
  unrealizedPnlUsd: number;
  updatedAt: string;
};

export type TradeRecord = {
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

export type StrategyIntent = {
  action: StrategyAction;
  inputMint?: string;
  outputMint?: string;
  targetNotionalUsd?: number;
  reason: string;
  confidence: number;
  metadata?: Record<string, unknown>;
};

export type PolicyDecision = {
  approved: boolean;
  reason: string;
  violations?: string[];
  adjustedNotionalUsd?: number;
};

export type PerformanceSnapshot = {
  navUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  cumulativeReturnPct: number;
  drawdownPct: number;
  highWaterMarkUsd: number;
  grossExposureUsd: number;
  cashPct: number;
  updatedAt: string;
};

export type StrategyConfig = {
  mode: "vault";
  strategyId: string;
  vaultId: string;
  baseAssetMint: string;
  allowedAssets: string[];
  minUsdcReservePct: number;
  maxPositionPct: number;
  maxTradePct: number;
  maxConcurrentPositions: number;
  minConfidence: number;
  cooldownMinutes: number;
  maxDailyTrades: number;
  softDrawdownPct: number;
  hardDrawdownPct: number;
  maxSlippageBps: number;
};

export type StrategyContext = {
  agentId: string;
  vault: VaultState;
  balances: BalanceSnapshot[];
  prices: Record<string, number>;
  recentTrades: TradeRecord[];
  openPositions: PositionRecord[];
  now: string;
  config: StrategyConfig;
};

export type SignalResult = {
  symbol: string;
  mint: string;
  score: number;
  confidence: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  reason: string;
};

export type ExecutionResult = {
  success: boolean;
  txSignature?: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  effectivePriceUsd?: number;
  slippageBps?: number;
  feesUsd?: number;
  executedAt: string;
  raw?: Record<string, unknown>;
  error?: string;
};
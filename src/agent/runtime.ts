import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletManager } from "../wallet/walletManager";
import { SplTokenService } from "../token/splTokenService";
import { StateStore } from "../state/stateStore";
import { executeStrategyIntent } from "../strategy/execution/executor";
import { fetchVaultPrices } from "../strategy/market/prices";
import { generateIntent } from "../strategy/engine";
import { validateIntent } from "../strategy/risk";
import { generateManagedIntent } from "../strategy/managed/decision";
import {
  type BalanceSnapshot,
  type PositionRecord,
  type StrategyConfig,
  type StrategyContext,
  type StrategyIntent,
  type TradeRecord,
} from "../strategy/types";
import {
  loadManagedMarketState,
  markManagedPositionsToMarket,
  recordManagedBuy,
  recordManagedSell,
  type ManagedMarketState,
} from "../strategy/managed/marketState";
import { RangerVaultAdapter } from "../vault/adapter";
import { loadAgentConfig } from "./config";
import {
  type AgentActionLogEntry,
  type AgentConfig,
  type AgentReputation,
  type StrategyRuntimeConfig,
  type VaultConfig,
} from "./types";
import { decideNextAction, normalizeMemoryForPolicy } from "./policy";
import {
  loadAgentMemory,
  markBalanceCheck,
  markCycle,
  markDraftCreated,
  markError,
  saveAgentMemory,
} from "./memory";
import {
  appendActionLog,
  createActionLog,
  getAgentLogPath,
} from "./actionLogger";
import {
  appendDraftPost,
  createBootDraft,
  createSummaryDraft,
} from "./xDrafts";
import {
  loadAgentReputation,
  recomputeReputationFromLogs,
  saveAgentReputation,
} from "./reputation";
import { runRegistryTask } from "./tasks/registryTask";
import { runX402Task } from "./tasks/x402Task";
import {
  updateAccountingFromExecution,
  loadAccountingState,
} from "./tasks/accounting";
import { runJupiterTask } from "./tasks/jupiterTask";
import { postLatestDraft } from "./xPoster";
import { createManagedStrategyRuntime } from "../strategy/managed";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const MIN_NAV_USD_TO_EXECUTE = 5;
const MIN_TRADE_NOTIONAL_USD = 0.2;

type StrategyMode = "vault" | "managed" | "generic";

type VaultRuntimeResolvedConfig = {
  enabled: boolean;
  vaultId: string;
  source: "local" | "ranger";
  rangerVaultPubkey?: string;
  managerAuthority?: string;
  adminAuthority?: string;
  assetMint?: string;
  listed: boolean;
  strategyId: string;
  baseAsset: string;
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

type ManagedRuntimeResolvedConfig = {
  enabled: boolean;
  strategyId: string;
  baseAsset: string;
  depositAsset: string;
  withdrawToSourceWalletOnly: boolean;
  manualDepositConfirmation: boolean;
  queueIfInsufficientLiquidity: boolean;
  manualExecution: boolean;
  executionEnabled: boolean;
  executionMode: "simulated" | "live";
  executionRoute: "jupiter";
  allowBuy: boolean;
  allowSell: boolean;
  maxLiveNotionalUsd: number;
  minLiveNotionalUsd: number;
  reconcileAfterTrade: boolean;
  maxPriceDeviationPct: number;
  maxConsecutiveLosses: number;
  maxCumulativeRealizedLossUsd: number;
  emergencyStop: boolean;
};

function color(text: string, ...styles: string[]): string {
  return `${styles.join("")}${text}${ansi.reset}`;
}

function line(char = "─", width = 72): string {
  return char.repeat(width);
}

function banner(title: string): string {
  return (
    color(`┌${line("─", 70)}┐`, ansi.magenta) +
    `\n` +
    color(`│ ${title.padEnd(68, " ")} │`, ansi.magenta, ansi.bold) +
    `\n` +
    color(`└${line("─", 70)}┘`, ansi.magenta)
  );
}

function section(text: string): string {
  return color(text, ansi.cyan, ansi.bold);
}

function success(text: string): string {
  return color(text, ansi.green, ansi.bold);
}

function warn(text: string): string {
  return color(text, ansi.yellow, ansi.bold);
}

function errText(text: string): string {
  return color(text, ansi.red, ansi.bold);
}

function subtle(text: string): string {
  return color(text, ansi.gray);
}

function value(text: string): string {
  return color(text, ansi.white);
}

function keyValue(label: string, val: string): string {
  return `${subtle(label)} ${value(val)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundToDecimals(value: number, decimals = 9): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function readRecentActionLogs(agentId: string, limit = 50): AgentActionLogEntry[] {
  const filepath = getAgentLogPath(agentId);
  if (!fs.existsSync(filepath)) return [];

  const lines = fs
    .readFileSync(filepath, "utf8")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  return lines
    .slice(-limit)
    .map((logLine) => JSON.parse(logLine) as AgentActionLogEntry);
}

function resolveStrategyMode(config: AgentConfig): StrategyMode {
  const strategyMode = String(config.strategy?.mode ?? "").toLowerCase();

  if (strategyMode === "managed") return "managed";
  if (strategyMode === "vault") return "vault";

  const vaultEnabled = config.vault?.enabled === true;
  return vaultEnabled ? "vault" : "generic";
}

function resolveManagedRuntimeConfig(config: AgentConfig): ManagedRuntimeResolvedConfig {
  const managed = config.managedStrategy;
  const strategy = config.strategy;
  const execution = managed?.execution;

  const enabled =
    managed?.enabled === true ||
    String(strategy?.mode ?? "").toLowerCase() === "managed";

  return {
    enabled,
    strategyId: String(managed?.strategyId ?? strategy?.strategyId ?? "carv-1"),
    baseAsset: String(managed?.baseAsset ?? strategy?.baseAsset ?? "USDC"),
    depositAsset: String(
      managed?.depositAsset ??
        managed?.baseAsset ??
        strategy?.baseAsset ??
        "USDC"
    ),
    withdrawToSourceWalletOnly: Boolean(
      managed?.depositPolicy?.withdrawToSourceWalletOnly ?? true
    ),
    manualDepositConfirmation: Boolean(
      managed?.depositPolicy?.manualDepositConfirmation ?? true
    ),
    queueIfInsufficientLiquidity: Boolean(
      managed?.withdrawalPolicy?.queueIfInsufficientLiquidity ?? true
    ),
    manualExecution: Boolean(
      managed?.withdrawalPolicy?.manualExecution ?? true
    ),
    executionEnabled: Boolean(execution?.enabled ?? false),
    executionMode: execution?.mode ?? "simulated",
    executionRoute: execution?.route ?? "jupiter",
    allowBuy: Boolean(execution?.allowBuy ?? true),
    allowSell: Boolean(execution?.allowSell ?? true),
    maxLiveNotionalUsd: Number(execution?.maxLiveNotionalUsd ?? 5),
    minLiveNotionalUsd: Number(execution?.minLiveNotionalUsd ?? 1),
    reconcileAfterTrade: Boolean(execution?.reconcileAfterTrade ?? true),
    maxPriceDeviationPct: Number(execution?.maxPriceDeviationPct ?? 0.01),
    maxConsecutiveLosses: Number(execution?.maxConsecutiveLosses ?? 3),
    maxCumulativeRealizedLossUsd: Number(
      execution?.maxCumulativeRealizedLossUsd ?? 15
    ),
    emergencyStop: Boolean(execution?.emergencyStop ?? false),
  };
}

function resolveVaultRuntimeConfig(config: AgentConfig): VaultRuntimeResolvedConfig {
  const vault: VaultConfig | undefined = config.vault;
  const strategy: StrategyRuntimeConfig | undefined = config.strategy;

  const enabled = vault?.enabled === true || strategy?.mode === "vault";

  const rawAssetMint = (vault as any)?.assetMint as string | undefined;
  const strategyBaseAsset = strategy?.baseAsset ?? "USDC";
  const inferredAssetMint =
    strategyBaseAsset.toUpperCase() === "USDC"
      ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      : undefined;

  return {
    enabled,
    vaultId: vault?.vaultId ?? "ranger-vault-001",
    source: vault?.source ?? "local",
    rangerVaultPubkey: vault?.rangerVaultPubkey,
    managerAuthority: vault?.managerAuthority,
    adminAuthority: vault?.adminAuthority,
    assetMint: rawAssetMint ?? inferredAssetMint,
    listed: vault?.listed ?? false,
    strategyId: strategy?.strategyId ?? "carv-1",
    baseAsset: strategyBaseAsset,
    allowedAssets: strategy?.allowedAssets ?? ["SOL", "JUP"],
    minUsdcReservePct: strategy?.minUsdcReservePct ?? 0.4,
    maxPositionPct: strategy?.maxPositionPct ?? 0.25,
    maxTradePct: strategy?.maxTradePct ?? 0.1,
    maxConcurrentPositions: strategy?.maxConcurrentPositions ?? 2,
    minConfidence: strategy?.minConfidence ?? 0.65,
    cooldownMinutes: strategy?.cooldownMinutes ?? 360,
    maxDailyTrades: strategy?.maxDailyTrades ?? 4,
    softDrawdownPct: strategy?.softDrawdownPct ?? 0.05,
    hardDrawdownPct: strategy?.hardDrawdownPct ?? 0.08,
    maxSlippageBps: strategy?.maxSlippageBps ?? 50,
  };
}

function toStrategyConfig(resolved: VaultRuntimeResolvedConfig): StrategyConfig {
  return {
    mode: "vault",
    strategyId: resolved.strategyId,
    portfolioId: resolved.vaultId,
    vaultId: resolved.vaultId,
    baseAssetMint: resolved.baseAsset,
    allowedAssets: resolved.allowedAssets,
    minUsdcReservePct: resolved.minUsdcReservePct,
    maxPositionPct: resolved.maxPositionPct,
    maxTradePct: resolved.maxTradePct,
    maxConcurrentPositions: resolved.maxConcurrentPositions,
    minConfidence: resolved.minConfidence,
    cooldownMinutes: resolved.cooldownMinutes,
    maxDailyTrades: resolved.maxDailyTrades,
    softDrawdownPct: resolved.softDrawdownPct,
    hardDrawdownPct: resolved.hardDrawdownPct,
    maxSlippageBps: resolved.maxSlippageBps,
  };
}

function toManagedStrategyConfig(
  managedConfig: ManagedRuntimeResolvedConfig,
  strategy: StrategyRuntimeConfig
): StrategyConfig {
  return {
    mode: "managed",
    strategyId: strategy.strategyId,
    portfolioId: managedConfig.strategyId,
    baseAssetMint: strategy.baseAsset,
    allowedAssets: strategy.allowedAssets,
    minUsdcReservePct: strategy.minUsdcReservePct,
    maxPositionPct: strategy.maxPositionPct,
    maxTradePct: strategy.maxTradePct,
    maxConcurrentPositions: strategy.maxConcurrentPositions,
    minConfidence: strategy.minConfidence,
    cooldownMinutes: strategy.cooldownMinutes,
    maxDailyTrades: strategy.maxDailyTrades,
    softDrawdownPct: strategy.softDrawdownPct,
    hardDrawdownPct: strategy.hardDrawdownPct,
    maxSlippageBps: strategy.maxSlippageBps,
  };
}

function buildStrategyBalances(params: {
  balances: {
    sol: number;
    mintAddress: string | null;
    ata: string | null;
    tokenRaw: string | null;
    tokenUi: number | null;
  };
}): BalanceSnapshot[] {
  const result: BalanceSnapshot[] = [
    {
      mint: "SOL",
      symbol: "SOL",
      amount: params.balances.sol,
      valueUsd: 0,
    },
  ];

  if (
    params.balances.tokenUi !== null &&
    params.balances.tokenUi !== undefined
  ) {
    result.push({
      mint: params.balances.mintAddress ?? "TOKEN",
      symbol: "TOKEN",
      amount: params.balances.tokenUi,
      valueUsd: 0,
    });
  }

  return result;
}

async function readBalances(params: {
  rpcUrl: string;
  agentId: string;
}): Promise<{
  sol: number;
  mintAddress: string | null;
  ata: string | null;
  tokenRaw: string | null;
  tokenUi: number | null;
}> {
  const connection = new Connection(params.rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);
  const tokenService = new SplTokenService(connection);
  const stateStore = new StateStore();

  const kp = walletManager.loadOrCreateEncryptedKeypairOrThrow(params.agentId);
  const solLamports = await connection.getBalance(kp.publicKey, "confirmed");
  const sol = solLamports / 1000000000;

  const state = stateStore.load();
  const mintAddress = state.mint?.address ?? null;
  const decimals = state.mint?.decimals ?? 6;
  const ata = state.atas?.[params.agentId] ?? null;

  let tokenRaw: string | null = null;
  let tokenUi: number | null = null;

  if (ata) {
    try {
      const amt = await tokenService.getTokenAccountAmountRaw({
        ata: new PublicKey(ata),
      });
      tokenRaw = amt.toString();
      tokenUi = Number(amt) / 10 ** decimals;
    } catch {
      tokenRaw = null;
      tokenUi = null;
    }
  }

  return {
    sol,
    mintAddress,
    ata,
    tokenRaw,
    tokenUi,
  };
}

function saveReputationFromLogs(agentId: string): AgentReputation {
  const entries = readRecentActionLogs(agentId, 5000);
  const reputation = recomputeReputationFromLogs({ agentId, entries });
  saveAgentReputation(reputation);
  return reputation;
}

async function maybeAutoPost(params: {
  agentId: string;
  enabled: boolean;
  reason: string;
}): Promise<void> {
  if (!params.enabled) return;

  const result = await postLatestDraft({ agentId: params.agentId });

  if (result.ok) {
    console.log(success(`Auto-post check complete (${params.reason})`));
    console.log(keyValue("Dry run: ", result.dryRun ? "yes" : "no"));
    console.log(keyValue("Posted:  ", result.posted ? "yes" : "no"));
    if (result.tweetId) {
      console.log(keyValue("Tweet ID:", result.tweetId));
    }
  } else {
    console.log(errText(`Auto-post failed: ${result.error}`));
  }
}

function getManagedStrategyConfig(
  config: AgentConfig
): StrategyRuntimeConfig | null {
  if (!config.strategy || config.strategy.mode !== "managed") {
    return null;
  }

  return config.strategy;
}

function getManagedExposureUsd(state: ManagedMarketState): number {
  return roundToDecimals(
    state.positions.reduce((sum, position) => sum + position.marketValueUsd, 0)
  );
}

function getManagedRealizedPnlUsd(state: ManagedMarketState): number {
  return roundToDecimals(
    state.trades.reduce((sum, trade) => sum + (trade.realizedPnlUsd ?? 0), 0)
  );
}

function getManagedUnrealizedPnlUsd(state: ManagedMarketState): number {
  return roundToDecimals(
    state.positions.reduce((sum, position) => sum + position.unrealizedPnlUsd, 0)
  );
}

function getManagedConsecutiveLosses(state: ManagedMarketState): number {
  let count = 0;

  for (let i = state.trades.length - 1; i >= 0; i -= 1) {
    const realized = Number(state.trades[i].realizedPnlUsd ?? 0);
    if (realized < 0) {
      count += 1;
      continue;
    }
    break;
  }

  return count;
}

function getManagedCumulativeRealizedLossUsd(state: ManagedMarketState): number {
  return roundToDecimals(
    Math.abs(
      state.trades.reduce((sum, trade) => {
        const realized = Number(trade.realizedPnlUsd ?? 0);
        return realized < 0 ? sum + realized : sum;
      }, 0)
    )
  );
}

function resolveIntentSymbol(intent: StrategyIntent): string {
  const symbol = intent.metadata?.symbol;
  return typeof symbol === "string" && symbol.trim().length > 0
    ? symbol
    : String(intent.outputMint ?? intent.inputMint ?? "UNKNOWN");
}

function resolveIntentPriceUsd(params: {
  symbol: string;
  mint?: string;
  prices: Record<string, number>;
}): number {
  const fromSymbol = params.prices[params.symbol];
  if (typeof fromSymbol === "number" && Number.isFinite(fromSymbol)) {
    return fromSymbol;
  }

  if (params.mint) {
    const fromMint = params.prices[params.mint];
    if (typeof fromMint === "number" && Number.isFinite(fromMint)) {
      return fromMint;
    }
  }

  return 0;
}

function getVaultPortfolioId(
  vaultState: Record<string, unknown>,
  fallback: string
): string {
  const portfolioId = vaultState.portfolioId;
  if (typeof portfolioId === "string" && portfolioId.trim().length > 0) {
    return portfolioId;
  }

  const vaultId = vaultState.vaultId;
  if (typeof vaultId === "string" && vaultId.trim().length > 0) {
    return vaultId;
  }

  return fallback;
}

function shouldUseManagedLiveExecution(params: {
  config: AgentConfig;
  managedConfig: ManagedRuntimeResolvedConfig;
  intent: StrategyIntent;
  notionalUsd: number;
}): { enabled: boolean; reason?: string } {
  const { config, managedConfig, intent, notionalUsd } = params;

  if (!managedConfig.executionEnabled) {
    return { enabled: false, reason: "Managed execution disabled" };
  }

  if (managedConfig.executionMode !== "live") {
    return { enabled: false, reason: "Managed execution mode is simulated" };
  }

  if (config.mode !== "live") {
    return { enabled: false, reason: "Agent runtime mode is not live" };
  }

  if (intent.action === "BUY" && !managedConfig.allowBuy) {
    return { enabled: false, reason: "Live managed BUY disabled" };
  }

  if (intent.action === "SELL" && !managedConfig.allowSell) {
    return { enabled: false, reason: "Live managed SELL disabled" };
  }

  if (notionalUsd < managedConfig.minLiveNotionalUsd) {
    return {
      enabled: false,
      reason: `Live notional below minimum (${notionalUsd.toFixed(6)} < ${managedConfig.minLiveNotionalUsd})`,
    };
  }

  if (notionalUsd > managedConfig.maxLiveNotionalUsd) {
    return {
      enabled: false,
      reason: `Live notional above cap (${notionalUsd.toFixed(6)} > ${managedConfig.maxLiveNotionalUsd})`,
    };
  }

  return { enabled: true };
}

function isManagedCircuitBreakerOpen(params: {
  managedConfig: ManagedRuntimeResolvedConfig;
  strategy: StrategyRuntimeConfig;
  marketState: ManagedMarketState;
  overview: ReturnType<ReturnType<typeof createManagedStrategyRuntime>["getOverview"]>;
}): { open: boolean; reason: string } {
  const { managedConfig, strategy, marketState, overview } = params;

  if (managedConfig.emergencyStop) {
    return { open: true, reason: "Emergency stop enabled" };
  }

  const consecutiveLosses = getManagedConsecutiveLosses(marketState);
  if (consecutiveLosses >= managedConfig.maxConsecutiveLosses) {
    return {
      open: true,
      reason: `Circuit breaker: consecutive losses ${consecutiveLosses}/${managedConfig.maxConsecutiveLosses}`,
    };
  }

  const cumulativeRealizedLossUsd =
    getManagedCumulativeRealizedLossUsd(marketState);
  if (
    cumulativeRealizedLossUsd >= managedConfig.maxCumulativeRealizedLossUsd
  ) {
    return {
      open: true,
      reason: `Circuit breaker: cumulative realized loss ${cumulativeRealizedLossUsd} USD`,
    };
  }

  const sharePrice =
    overview.totalDeposited > 0 ? overview.valuation.sharePrice : 1;
  const estimatedDrawdownPct =
    sharePrice > 0 && sharePrice < 1
      ? 1 - sharePrice
      : 0;

  if (estimatedDrawdownPct >= strategy.hardDrawdownPct) {
    return {
      open: true,
      reason: `Circuit breaker: drawdown ${(
        estimatedDrawdownPct * 100
      ).toFixed(2)}% >= hard limit`,
    };
  }

  return { open: false, reason: "closed" };
}

function getQuotedExecutionPriceUsd(params: {
  executionResult: Record<string, unknown>;
  oraclePriceUsd: number;
}): number {
  const effectivePriceUsd = Number(params.executionResult.effectivePriceUsd ?? 0);
  if (Number.isFinite(effectivePriceUsd) && effectivePriceUsd > 0) {
    return effectivePriceUsd;
  }

  return params.oraclePriceUsd;
}

function validateManagedQuote(params: {
  oraclePriceUsd: number;
  quoteResult: Awaited<ReturnType<typeof executeStrategyIntent>>;
  managedConfig: ManagedRuntimeResolvedConfig;
}): { ok: boolean; reason?: string; quotedPriceUsd?: number; deviationPct?: number } {
  if (!params.quoteResult.ok) {
    return { ok: false, reason: `Quote failed: ${params.quoteResult.error}` };
  }

  if (!(params.oraclePriceUsd > 0)) {
    return { ok: false, reason: "No oracle/reference price available" };
  }

  const quotedPriceUsd = getQuotedExecutionPriceUsd({
    executionResult: params.quoteResult.executionResult as Record<string, unknown>,
    oraclePriceUsd: params.oraclePriceUsd,
  });

  if (!(quotedPriceUsd > 0)) {
    return { ok: false, reason: "Quote returned invalid execution price" };
  }

  const deviationPct =
    Math.abs(quotedPriceUsd - params.oraclePriceUsd) / params.oraclePriceUsd;

  if (deviationPct > params.managedConfig.maxPriceDeviationPct) {
    return {
      ok: false,
      reason: `Quote deviation too large (${(deviationPct * 100).toFixed(2)}% > ${(params.managedConfig.maxPriceDeviationPct * 100).toFixed(2)}%)`,
      quotedPriceUsd,
      deviationPct,
    };
  }

  return { ok: true, quotedPriceUsd, deviationPct };
}

function buildManagedStrategyContext(params: {
  agentId: string;
  managedConfig: ManagedRuntimeResolvedConfig;
  strategy: StrategyRuntimeConfig;
  overview: ReturnType<ReturnType<typeof createManagedStrategyRuntime>["getOverview"]>;
  prices: Record<string, number>;
  balances: {
    sol: number;
    mintAddress: string | null;
    ata: string | null;
    tokenRaw: string | null;
    tokenUi: number | null;
  };
  marketState: ManagedMarketState;
}): StrategyContext {
  const availableCapitalUsd = Math.max(
    0,
    params.overview.valuation.liquidValue -
      params.overview.valuation.reservedForWithdrawals
  );

  return {
    agentId: params.agentId,
    portfolio: {
      portfolioId: params.managedConfig.strategyId,
      totalValueUsd: params.overview.valuation.totalValue,
      availableCapitalUsd,
      reservedCapitalUsd: params.overview.valuation.reservedForWithdrawals,
      deployedCapitalUsd: params.overview.valuation.investedValue,
      baseAssetMint: params.strategy.baseAsset,
      realizedPnlUsd: getManagedRealizedPnlUsd(params.marketState),
      unrealizedPnlUsd: getManagedUnrealizedPnlUsd(params.marketState),
      grossExposureUsd: getManagedExposureUsd(params.marketState),
      netExposureUsd: getManagedExposureUsd(params.marketState),
      drawdownPct: 0,
      highWaterMarkUsd: params.overview.valuation.totalValue,
      lastSyncAt: params.overview.valuation.updatedAt,
    },
    balances: buildStrategyBalances({
      balances: params.balances,
    }),
    prices: params.prices,
    recentTrades: params.marketState.trades,
    openPositions: params.marketState.positions,
    now: new Date().toISOString(),
    config: toManagedStrategyConfig(params.managedConfig, params.strategy),
  };
}

async function runManagedCycle(params: {
  agentId: string;
  rpcUrl: string;
  config: AgentConfig;
  balances: {
    sol: number;
    mintAddress: string | null;
    ata: string | null;
    tokenRaw: string | null;
    tokenUi: number | null;
  };
  cycleCount: number;
}): Promise<void> {
  const managedConfig = resolveManagedRuntimeConfig(params.config);
  const strategy = getManagedStrategyConfig(params.config);
  const runtime = createManagedStrategyRuntime();

  let before = runtime.getOverview();
  const pendingRequests = runtime.listWithdrawalRequests().filter(
    (request) =>
      request.status === "pending" ||
      request.status === "queued" ||
      request.status === "ready"
  );

  console.log(section("Managed strategy"));
  console.log(keyValue("Strategy: ", managedConfig.strategyId));
  console.log(keyValue("Base:     ", managedConfig.baseAsset));
  console.log(keyValue("Deposit:  ", managedConfig.depositAsset));
  console.log(
    keyValue(
      "Withdraw: ",
      managedConfig.withdrawToSourceWalletOnly
        ? "source wallet only"
        : "custom destination allowed"
    )
  );
  console.log(
    keyValue(
      "Queue WD: ",
      managedConfig.queueIfInsufficientLiquidity ? "yes" : "no"
    )
  );
  console.log(
    keyValue("Manual WD:", managedConfig.manualExecution ? "yes" : "no")
  );
  console.log(keyValue("Exec:     ", managedConfig.executionMode));
  console.log(keyValue("Live buy: ", managedConfig.allowBuy ? "yes" : "no"));
  console.log(keyValue("Live sell:", managedConfig.allowSell ? "yes" : "no"));
  console.log(
    keyValue("Live cap: ", `${managedConfig.maxLiveNotionalUsd} USD`)
  );
  console.log(
    keyValue(
      "Px guard: ",
      `${(managedConfig.maxPriceDeviationPct * 100).toFixed(2)}%`
    )
  );
  console.log("");

  let managedMarketState = loadManagedMarketState(params.agentId);

  const prices = strategy
    ? await fetchVaultPrices([strategy.baseAsset, ...strategy.allowedAssets])
    : {};

  if (strategy) {
    managedMarketState = markManagedPositionsToMarket({
      agentId: params.agentId,
      prices,
    });

    const exposureUsd = getManagedExposureUsd(managedMarketState);

    runtime.reconcileNav({
      liquidValue: Math.max(
        0,
        before.valuation.totalValue -
          before.valuation.reservedForWithdrawals -
          exposureUsd
      ),
      investedValue: exposureUsd,
      reservedForWithdrawals: before.valuation.reservedForWithdrawals,
      source: "managed-market-sync",
      notes: `cycle=${params.cycleCount}; synced managed market state`,
    });

    before = runtime.getOverview();
  }

  console.log(section("Managed overview"));
  console.log(keyValue("Users:      ", String(before.totalUsers)));
  console.log(keyValue("Deposited:  ", String(before.totalDeposited)));
  console.log(keyValue("Withdrawn:  ", String(before.totalWithdrawn)));
  console.log(keyValue("Shares:     ", String(before.valuation.totalShares)));
  console.log(keyValue("Total:      ", String(before.valuation.totalValue)));
  console.log(keyValue("Liquid:     ", String(before.valuation.liquidValue)));
  console.log(keyValue("Invested:   ", String(before.valuation.investedValue)));
  console.log(
    keyValue("Reserved WD:", String(before.valuation.reservedForWithdrawals))
  );
  console.log(keyValue("Share Px:   ", String(before.valuation.sharePrice)));
  console.log(keyValue("Pending WD: ", String(before.pendingWithdrawalAmount)));
  console.log(keyValue("WD Count:   ", String(before.pendingWithdrawalCount)));
  console.log(keyValue("Updated:    ", before.valuation.updatedAt));
  console.log("");

  console.log(section("Wallet snapshot"));
  console.log(
    keyValue(
      "Balances:",
      `SOL=${params.balances.sol.toFixed(4)} | TOKEN=${params.balances.tokenUi ?? "—"}`
    )
  );
  if (params.balances.mintAddress) {
    console.log(keyValue("Mint:    ", params.balances.mintAddress));
  }
  if (params.balances.ata) {
    console.log(keyValue("ATA:     ", params.balances.ata));
  }
  console.log("");

  let action = "HOLD";
  let reason = "No managed action taken";
  let deployedAmount = 0;
  let pnlRate = 0;
  let pnlDelta = 0;
  let intentNotionalUsd = 0;
  let intentConfidence = 0;
  let policyApproved = false;
  let policyViolations: string[] = [];
  let liveExecutionReason = "not evaluated";

  if (!strategy) {
    reason = "Missing managed strategy config";
  } else if (before.valuation.totalValue < MIN_NAV_USD_TO_EXECUTE) {
    reason = `NAV below execution threshold (${before.valuation.totalValue.toFixed(4)} < ${MIN_NAV_USD_TO_EXECUTE})`;
  } else {
    const breaker = isManagedCircuitBreakerOpen({
      managedConfig,
      strategy,
      marketState: managedMarketState,
      overview: before,
    });

    if (breaker.open) {
      liveExecutionReason = breaker.reason;
      reason = breaker.reason;

      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "managed_circuit_breaker",
          ok: true,
          reason: breaker.reason,
          details: {
            consecutiveLosses: getManagedConsecutiveLosses(managedMarketState),
            cumulativeRealizedLossUsd:
              getManagedCumulativeRealizedLossUsd(managedMarketState),
            emergencyStop: managedConfig.emergencyStop,
          },
        })
      );
    } else {
      const context = buildManagedStrategyContext({
        agentId: params.agentId,
        managedConfig,
        strategy,
        overview: before,
        prices,
        balances: params.balances,
        marketState: managedMarketState,
      });

      const intent = await generateManagedIntent(context);
      const policyDecision = validateIntent(intent, context);

      intentNotionalUsd = Number(intent.targetNotionalUsd ?? 0);
      intentConfidence = intent.confidence;
      policyApproved = policyDecision.approved;
      policyViolations = policyDecision.violations ?? [];

      const liveDecision = shouldUseManagedLiveExecution({
        config: params.config,
        managedConfig,
        intent,
        notionalUsd: intentNotionalUsd,
      });
      liveExecutionReason = liveDecision.reason ?? "eligible";

      console.log(section("Managed strategy decision"));
      console.log(keyValue("Intent:    ", intent.action));
      console.log(keyValue("Reason:    ", intent.reason));
      console.log(keyValue("Confidence:", intent.confidence.toFixed(2)));
      console.log(
        keyValue(
          "Notional:  ",
          intent.targetNotionalUsd !== undefined
            ? String(intent.targetNotionalUsd)
            : "—"
        )
      );
      console.log(
        keyValue("Approved:  ", policyDecision.approved ? "yes" : "no")
      );
      console.log(keyValue("Live exec: ", liveDecision.enabled ? "yes" : "no"));
      console.log(keyValue("Live why:  ", liveExecutionReason));
      if (policyDecision.violations?.length) {
        console.log(
          keyValue("Violations:", policyDecision.violations.join(", "))
        );
      }
      console.log("");

      if (!policyDecision.approved) {
        action = "HOLD";
        reason = "Intent rejected by CARV-1 risk policy";
      } else if (intent.action === "HOLD") {
        action = "HOLD";
        reason = intent.reason;
      } else if (intent.action === "BUY") {
        const symbol = resolveIntentSymbol(intent);
        const mint = String(intent.outputMint ?? symbol);
        const priceUsd = resolveIntentPriceUsd({
          symbol,
          mint,
          prices,
        });

        if (priceUsd <= 0) {
          action = "HOLD";
          reason = `No price available for BUY ${symbol}`;
        } else if (intentNotionalUsd < MIN_TRADE_NOTIONAL_USD) {
          action = "HOLD";
          reason = `Trade notional too small (${intentNotionalUsd.toFixed(6)} < ${MIN_TRADE_NOTIONAL_USD})`;
        } else if (liveDecision.enabled) {
          const quote = await executeStrategyIntent({
            agentId: params.agentId,
            version: params.config.version,
            intent,
            context,
            cluster: params.config.jupiter.cluster,
            execute: false,
            maxSlippageBps: strategy.maxSlippageBps,
          });

          const quoteGuard = validateManagedQuote({
            oraclePriceUsd: priceUsd,
            quoteResult: quote,
            managedConfig,
          });

          if (!quoteGuard.ok) {
            action = "HOLD";
            reason = `Managed live BUY blocked: ${quoteGuard.reason}`;
            liveExecutionReason = reason;
          } else {
            const execution = await executeStrategyIntent({
              agentId: params.agentId,
              version: params.config.version,
              intent,
              context,
              cluster: params.config.jupiter.cluster,
              execute: true,
              maxSlippageBps: strategy.maxSlippageBps,
            });

            if (!execution.ok) {
              action = "HOLD";
              reason = `Managed live BUY failed: ${execution.error}`;
            } else {
              const buyNotionalUsd = Number(
                execution.executionResult.inputAmount ?? intentNotionalUsd
              );
              const fillPriceUsd = getQuotedExecutionPriceUsd({
                executionResult: execution.executionResult as Record<string, unknown>,
                oraclePriceUsd: priceUsd,
              });

              managedMarketState = recordManagedBuy({
                agentId: params.agentId,
                symbol,
                mint,
                notionalUsd: buyNotionalUsd,
                priceUsd: fillPriceUsd,
                reason: intent.reason,
                slippageBps:
                  execution.executionResult.slippageBps ??
                  strategy.maxSlippageBps,
              });

              const exposureUsd = getManagedExposureUsd(managedMarketState);
              const nextLiquidValue = Math.max(
                0,
                before.valuation.totalValue -
                  before.valuation.reservedForWithdrawals -
                  exposureUsd
              );

              if (managedConfig.reconcileAfterTrade) {
                runtime.reconcileNav({
                  liquidValue: nextLiquidValue,
                  investedValue: exposureUsd,
                  reservedForWithdrawals: before.valuation.reservedForWithdrawals,
                  source: "carv1-managed-live-buy",
                  notes: `cycle=${params.cycleCount}; symbol=${symbol}; tx=${execution.executionResult.txSignature ?? "unknown"}; reason=${intent.reason}`,
                });
              }

              appendActionLog(
                createActionLog({
                  agentId: params.agentId,
                  action: "managed_live_buy",
                  ok: true,
                  reason: `Managed live BUY executed for ${symbol}`,
                  signature: execution.executionResult.txSignature,
                  details: {
                    symbol,
                    mint,
                    requestedNotionalUsd: intentNotionalUsd,
                    executedInputAmount: execution.executionResult.inputAmount,
                    executedOutputAmount: execution.executionResult.outputAmount,
                    effectivePriceUsd:
                      execution.executionResult.effectivePriceUsd,
                    slippageBps: execution.executionResult.slippageBps,
                    quoteDeviationPct: quoteGuard.deviationPct,
                    raw: execution.executionResult.raw,
                  },
                })
              );

              deployedAmount = roundToDecimals(buyNotionalUsd);
              action = "CARV1_BUY_LIVE";
              reason = `CARV-1 live BUY executed for ${symbol}`;
            }
          }
        } else {
          managedMarketState = recordManagedBuy({
            agentId: params.agentId,
            symbol,
            mint,
            notionalUsd: intentNotionalUsd,
            priceUsd,
            reason: intent.reason,
            slippageBps: strategy.maxSlippageBps,
          });

          const exposureUsd = getManagedExposureUsd(managedMarketState);
          const nextLiquidValue = Math.max(
            0,
            before.valuation.totalValue -
              before.valuation.reservedForWithdrawals -
              exposureUsd
          );

          runtime.reconcileNav({
            liquidValue: nextLiquidValue,
            investedValue: exposureUsd,
            reservedForWithdrawals: before.valuation.reservedForWithdrawals,
            source: "carv1-managed-buy",
            notes: `cycle=${params.cycleCount}; symbol=${symbol}; notional=${intentNotionalUsd}; reason=${intent.reason}`,
          });

          deployedAmount = roundToDecimals(intentNotionalUsd);
          action = "CARV1_BUY_SIMULATED";
          reason = `CARV-1 BUY simulated for ${symbol}`;
        }
      } else if (intent.action === "SELL") {
        const symbol = resolveIntentSymbol(intent);
        const mint = String(intent.inputMint ?? symbol);
        const priceUsd = resolveIntentPriceUsd({
          symbol,
          mint,
          prices,
        });

        if (priceUsd <= 0) {
          action = "HOLD";
          reason = `No price available for SELL ${symbol}`;
        } else if (intentNotionalUsd <= 0) {
          action = "HOLD";
          reason = "SELL intent had zero notional";
        } else if (liveDecision.enabled) {
          const quote = await executeStrategyIntent({
            agentId: params.agentId,
            version: params.config.version,
            intent,
            context,
            cluster: params.config.jupiter.cluster,
            execute: false,
            maxSlippageBps: strategy.maxSlippageBps,
          });

          const quoteGuard = validateManagedQuote({
            oraclePriceUsd: priceUsd,
            quoteResult: quote,
            managedConfig,
          });

          if (!quoteGuard.ok) {
            action = "HOLD";
            reason = `Managed live SELL blocked: ${quoteGuard.reason}`;
            liveExecutionReason = reason;
          } else {
            const execution = await executeStrategyIntent({
              agentId: params.agentId,
              version: params.config.version,
              intent,
              context,
              cluster: params.config.jupiter.cluster,
              execute: true,
              maxSlippageBps: strategy.maxSlippageBps,
            });

            if (!execution.ok) {
              action = "HOLD";
              reason = `Managed live SELL failed: ${execution.error}`;
            } else {
              const prevTradeCount = managedMarketState.trades.length;
              const sellNotionalUsd = Number(
                execution.executionResult.outputAmount ?? intentNotionalUsd
              );
              const fillPriceUsd = getQuotedExecutionPriceUsd({
                executionResult: execution.executionResult as Record<string, unknown>,
                oraclePriceUsd: priceUsd,
              });

              managedMarketState = recordManagedSell({
                agentId: params.agentId,
                symbol,
                mint,
                notionalUsd: sellNotionalUsd,
                priceUsd: fillPriceUsd,
                reason: intent.reason,
                slippageBps:
                  execution.executionResult.slippageBps ??
                  strategy.maxSlippageBps,
              });

              const latestTrade =
                managedMarketState.trades.length > prevTradeCount
                  ? managedMarketState.trades[managedMarketState.trades.length - 1]
                  : undefined;

              const exposureUsd = getManagedExposureUsd(managedMarketState);
              const nextLiquidValue = Math.max(
                0,
                before.valuation.totalValue -
                  before.valuation.reservedForWithdrawals -
                  exposureUsd
              );

              if (managedConfig.reconcileAfterTrade) {
                runtime.reconcileNav({
                  liquidValue: nextLiquidValue,
                  investedValue: exposureUsd,
                  reservedForWithdrawals: before.valuation.reservedForWithdrawals,
                  source: "carv1-managed-live-sell",
                  notes: `cycle=${params.cycleCount}; symbol=${symbol}; tx=${execution.executionResult.txSignature ?? "unknown"}; reason=${intent.reason}`,
                });
              }

              appendActionLog(
                createActionLog({
                  agentId: params.agentId,
                  action: "managed_live_sell",
                  ok: true,
                  reason: `Managed live SELL executed for ${symbol}`,
                  signature: execution.executionResult.txSignature,
                  details: {
                    symbol,
                    mint,
                    requestedNotionalUsd: intentNotionalUsd,
                    executedInputAmount: execution.executionResult.inputAmount,
                    executedOutputAmount: execution.executionResult.outputAmount,
                    effectivePriceUsd:
                      execution.executionResult.effectivePriceUsd,
                    slippageBps: execution.executionResult.slippageBps,
                    quoteDeviationPct: quoteGuard.deviationPct,
                    raw: execution.executionResult.raw,
                  },
                })
              );

              pnlDelta = roundToDecimals(latestTrade?.realizedPnlUsd ?? 0);
              action = "CARV1_SELL_LIVE";
              reason = `CARV-1 live SELL executed for ${symbol}`;
            }
          }
        } else {
          const prevTradeCount = managedMarketState.trades.length;

          managedMarketState = recordManagedSell({
            agentId: params.agentId,
            symbol,
            mint,
            notionalUsd: intentNotionalUsd,
            priceUsd,
            reason: intent.reason,
            slippageBps: strategy.maxSlippageBps,
          });

          const latestTrade =
            managedMarketState.trades.length > prevTradeCount
              ? managedMarketState.trades[managedMarketState.trades.length - 1]
              : undefined;

          const exposureUsd = getManagedExposureUsd(managedMarketState);
          const nextLiquidValue = Math.max(
            0,
            before.valuation.totalValue -
              before.valuation.reservedForWithdrawals -
              exposureUsd
          );

          runtime.reconcileNav({
            liquidValue: nextLiquidValue,
            investedValue: exposureUsd,
            reservedForWithdrawals: before.valuation.reservedForWithdrawals,
            source: "carv1-managed-sell",
            notes: `cycle=${params.cycleCount}; symbol=${symbol}; notional=${intentNotionalUsd}; reason=${intent.reason}`,
          });

          pnlDelta = roundToDecimals(latestTrade?.realizedPnlUsd ?? 0);
          action = "CARV1_SELL_SIMULATED";
          reason = `CARV-1 SELL simulated for ${symbol}`;
        }
      } else {
        action = intent.action;
        reason = `Unhandled managed intent action: ${intent.action}`;
      }
    }
  }

  const after = runtime.getOverview();

  if (before.valuation.totalValue > 0) {
    pnlRate = roundToDecimals(
      (after.valuation.totalValue - before.valuation.totalValue) /
        before.valuation.totalValue,
      6
    );
  }

  if (pnlDelta === 0) {
    pnlDelta = roundToDecimals(
      after.valuation.totalValue - before.valuation.totalValue
    );
  }

  console.log(section("Managed decision"));
  console.log(keyValue("Action:    ", action));
  console.log(keyValue("Reason:    ", reason));
  console.log(keyValue("Deployed:  ", String(deployedAmount)));
  console.log(keyValue("PnL Rate:  ", `${(pnlRate * 100).toFixed(2)}%`));
  console.log(keyValue("PnL Delta: ", String(pnlDelta)));
  console.log(keyValue("Intent Ntl:", String(intentNotionalUsd)));
  console.log(keyValue("Intent Cnf:", intentConfidence.toFixed(2)));
  console.log(keyValue("Approved:  ", policyApproved ? "yes" : "no"));
  console.log(keyValue("Live why:  ", liveExecutionReason));
  if (policyViolations.length) {
    console.log(keyValue("Violations:", policyViolations.join(", ")));
  }
  console.log(
    keyValue(
      "Reserve:   ",
      strategy ? `${(strategy.minUsdcReservePct * 100).toFixed(0)}%` : "—"
    )
  );
  console.log(
    keyValue(
      "Max trade: ",
      strategy ? `${(strategy.maxTradePct * 100).toFixed(0)}%` : "—"
    )
  );
  console.log(keyValue("Min NAV:   ", `${MIN_NAV_USD_TO_EXECUTE}`));
  console.log(keyValue("Min exec:  ", `${MIN_TRADE_NOTIONAL_USD}`));
  console.log("");

  appendActionLog(
    createActionLog({
      agentId: params.agentId,
      action: "managed_cycle",
      ok: true,
      reason,
      details: {
        rpcUrl: params.rpcUrl,
        cycleCount: params.cycleCount,
        strategyId: managedConfig.strategyId,
        baseAsset: managedConfig.baseAsset,
        depositAsset: managedConfig.depositAsset,
        withdrawToSourceWalletOnly: managedConfig.withdrawToSourceWalletOnly,
        manualDepositConfirmation: managedConfig.manualDepositConfirmation,
        queueIfInsufficientLiquidity: managedConfig.queueIfInsufficientLiquidity,
        manualExecution: managedConfig.manualExecution,
        executionEnabled: managedConfig.executionEnabled,
        executionMode: managedConfig.executionMode,
        allowBuy: managedConfig.allowBuy,
        allowSell: managedConfig.allowSell,
        maxLiveNotionalUsd: managedConfig.maxLiveNotionalUsd,
        minLiveNotionalUsd: managedConfig.minLiveNotionalUsd,
        reconcileAfterTrade: managedConfig.reconcileAfterTrade,
        maxPriceDeviationPct: managedConfig.maxPriceDeviationPct,
        maxConsecutiveLosses: managedConfig.maxConsecutiveLosses,
        maxCumulativeRealizedLossUsd:
          managedConfig.maxCumulativeRealizedLossUsd,
        emergencyStop: managedConfig.emergencyStop,
        balances: {
          sol: params.balances.sol,
          mintAddress: params.balances.mintAddress,
          ata: params.balances.ata,
          tokenRaw: params.balances.tokenRaw,
          tokenUi: params.balances.tokenUi,
        },
        before,
        after,
        managedMarketState,
        pendingWithdrawalRequests: pendingRequests,
        action,
        deployedAmount,
        pnlRate,
        pnlDelta,
        intentNotionalUsd,
        intentConfidence,
        policyApproved,
        policyViolations,
        liveExecutionReason,
        consecutiveLosses: getManagedConsecutiveLosses(managedMarketState),
        cumulativeRealizedLossUsd:
          getManagedCumulativeRealizedLossUsd(managedMarketState),
      },
    })
  );

  const reputation = saveReputationFromLogs(params.agentId);

  appendActionLog(
    createActionLog({
      agentId: params.agentId,
      action: "summary",
      ok: true,
      reason: "Managed cycle summary written",
      details: {
        strategyMode: "managed",
        strategyId: managedConfig.strategyId,
        reputationScore: reputation.score,
        successfulTrades: reputation.successfulTrades,
        successfulPayments: reputation.successfulPayments,
        failedActions: reputation.failedActions,
        totalUsers: after.totalUsers,
        totalValue: after.valuation.totalValue,
        liquidValue: after.valuation.liquidValue,
        investedValue: after.valuation.investedValue,
        sharePrice: after.valuation.sharePrice,
        pendingWithdrawalCount: after.pendingWithdrawalCount,
      },
    })
  );

  console.log("");
  console.log(section("Cycle summary"));
  console.log(keyValue("Mode:      ", "managed"));
  console.log(keyValue("Strategy:  ", managedConfig.strategyId));
  console.log(keyValue("Reputation:", String(reputation.score)));
  console.log(keyValue("Users:     ", String(after.totalUsers)));
  console.log(keyValue("Total:     ", String(after.valuation.totalValue)));
  console.log(keyValue("Liquid:    ", String(after.valuation.liquidValue)));
  console.log(keyValue("Invested:  ", String(after.valuation.investedValue)));
  console.log(keyValue("Share Px:  ", String(after.valuation.sharePrice)));
  console.log(keyValue("Pending WD:", String(after.pendingWithdrawalCount)));
  console.log(color(line("─", 72), ansi.gray));
}

async function runVaultCycle(params: {
  agentId: string;
  rpcUrl: string;
  config: AgentConfig;
  balances: {
    sol: number;
    mintAddress: string | null;
    ata: string | null;
    tokenRaw: string | null;
    tokenUi: number | null;
  };
  cycleCount: number;
}): Promise<void> {
  const vaultConfig = resolveVaultRuntimeConfig(params.config);
  const strategyConfig = toStrategyConfig(vaultConfig);

  const vaultAdapter = new RangerVaultAdapter({
    agentId: params.agentId,
    vaultId: vaultConfig.vaultId,
    baseAssetMint: vaultConfig.assetMint ?? vaultConfig.baseAsset,
    minReservePct: vaultConfig.minUsdcReservePct,
    source: vaultConfig.source,
    rangerVaultPubkey: vaultConfig.rangerVaultPubkey,
    managerAuthority: vaultConfig.managerAuthority,
    adminAuthority: vaultConfig.adminAuthority,
    listed: vaultConfig.listed,
    rpcUrl: params.rpcUrl,
  });

  const vaultIdentity = await vaultAdapter.getVaultIdentity();
  const vaultState = (await vaultAdapter.getVaultState()) as Record<string, unknown>;
  const accountingState = loadAccountingState(params.agentId);

  const strategyBalances = buildStrategyBalances({
    balances: params.balances,
  });

  const prices = await fetchVaultPrices([
    vaultConfig.baseAsset,
    ...vaultConfig.allowedAssets,
  ]);

  const recentTrades: TradeRecord[] = accountingState.trades;
  const openPositions: PositionRecord[] = accountingState.positions;

  const portfolioId = getVaultPortfolioId(vaultState, vaultConfig.vaultId);

  const context: StrategyContext = {
    agentId: params.agentId,
    portfolio: {
      portfolioId,
      totalValueUsd: Number(vaultState.totalValueUsd ?? 0),
      availableCapitalUsd: Number(vaultState.availableCapitalUsd ?? 0),
      reservedCapitalUsd: Number(vaultState.reservedCapitalUsd ?? 0),
      deployedCapitalUsd: Number(vaultState.deployedCapitalUsd ?? 0),
      baseAssetMint: String(vaultState.baseAssetMint ?? strategyConfig.baseAssetMint),
      realizedPnlUsd: Number(vaultState.realizedPnlUsd ?? 0),
      unrealizedPnlUsd: Number(vaultState.unrealizedPnlUsd ?? 0),
      grossExposureUsd: Number(vaultState.grossExposureUsd ?? 0),
      netExposureUsd: Number(vaultState.netExposureUsd ?? 0),
      drawdownPct: Number(vaultState.drawdownPct ?? 0),
      highWaterMarkUsd: Number(vaultState.highWaterMarkUsd ?? 0),
      lastSyncAt: String(vaultState.lastSyncAt ?? new Date().toISOString()),
    },
    balances: strategyBalances,
    prices,
    recentTrades,
    openPositions,
    now: new Date().toISOString(),
    config: strategyConfig,
  };

  const intent = await generateIntent(context);

  const navUsd = Number(vaultState.totalValueUsd ?? 0);
  if (navUsd < MIN_NAV_USD_TO_EXECUTE) {
    intent.action = "HOLD";
    intent.reason = "NAV below execution threshold";
  }

  const policyDecision = validateIntent(intent, context);

  console.log(section("Vault identity"));
  console.log(keyValue("Source:    ", vaultIdentity.source));
  console.log(keyValue("Vault ID:  ", vaultIdentity.vaultId));
  console.log(keyValue("Base:      ", vaultIdentity.baseAssetMint));
  console.log(keyValue("Listed:    ", vaultIdentity.listed ? "yes" : "no"));
  if (vaultIdentity.rangerVaultPubkey) {
    console.log(keyValue("Ranger PK: ", vaultIdentity.rangerVaultPubkey));
  }
  if (vaultIdentity.managerAuthority) {
    console.log(keyValue("Manager:   ", vaultIdentity.managerAuthority));
  }
  if (vaultIdentity.adminAuthority) {
    console.log(keyValue("Admin:     ", vaultIdentity.adminAuthority));
  }
  console.log("");

  console.log(section("Vault strategy"));
  console.log(keyValue("Strategy: ", vaultConfig.strategyId));
  console.log(keyValue("Vault ID: ", vaultConfig.vaultId));
  console.log(keyValue("Base:     ", vaultConfig.baseAsset));
  if (vaultConfig.assetMint) {
    console.log(keyValue("Mint:     ", vaultConfig.assetMint));
  }
  console.log(keyValue("Universe: ", vaultConfig.allowedAssets.join(", ")));
  console.log(
    keyValue(
      "Reserve:  ",
      `${(vaultConfig.minUsdcReservePct * 100).toFixed(0)}%`
    )
  );
  console.log(
    keyValue(
      "Max pos:  ",
      `${(vaultConfig.maxPositionPct * 100).toFixed(0)}%`
    )
  );
  console.log(
    keyValue(
      "Max trade:",
      `${(vaultConfig.maxTradePct * 100).toFixed(0)}%`
    )
  );
  console.log(keyValue("Cooldown: ", `${vaultConfig.cooldownMinutes}m`));
  console.log(keyValue("Max/day:  ", String(vaultConfig.maxDailyTrades)));
  console.log(
    keyValue(
      "Soft DD:  ",
      `${(vaultConfig.softDrawdownPct * 100).toFixed(1)}%`
    )
  );
  console.log(
    keyValue(
      "Hard DD:  ",
      `${(vaultConfig.hardDrawdownPct * 100).toFixed(1)}%`
    )
  );
  console.log(keyValue("Slippage: ", `${vaultConfig.maxSlippageBps} bps`));
  console.log(keyValue("Min NAV:  ", `${MIN_NAV_USD_TO_EXECUTE} USD`));
  console.log(keyValue("Min exec: ", `${MIN_TRADE_NOTIONAL_USD} USD`));
  console.log("");

  console.log(section("Vault state"));
  console.log(keyValue("NAV USD:      ", String(vaultState.totalValueUsd ?? 0)));
  console.log(keyValue("Available USD:", String(vaultState.availableCapitalUsd ?? 0)));
  console.log(
    keyValue(
      "Drawdown:     ",
      `${(Number(vaultState.drawdownPct ?? 0) * 100).toFixed(2)}%`
    )
  );
  console.log(keyValue("Positions:    ", String(openPositions.length)));
  console.log(keyValue("Recent trades:", String(recentTrades.length)));
  console.log(keyValue("Updated:      ", String(vaultState.lastSyncAt ?? "—")));
  console.log("");

  console.log(section("Market snapshot"));
  console.log(keyValue("USDC: ", String(prices.USDC ?? 1)));
  console.log(
    keyValue("SOL:  ", prices.SOL !== undefined ? String(prices.SOL) : "—")
  );
  console.log(
    keyValue("JUP:  ", prices.JUP !== undefined ? String(prices.JUP) : "—")
  );
  console.log("");

  console.log(section("Strategy decision"));
  console.log(keyValue("Action:    ", intent.action));
  console.log(keyValue("Reason:    ", intent.reason));
  console.log(keyValue("Confidence:", intent.confidence.toFixed(2)));
  console.log(
    keyValue(
      "Notional:  ",
      intent.targetNotionalUsd !== undefined
        ? String(intent.targetNotionalUsd)
        : "—"
    )
  );
  console.log(keyValue("Approved:  ", policyDecision.approved ? "yes" : "no"));
  if (policyDecision.violations?.length) {
    console.log(keyValue("Violations:", policyDecision.violations.join(", ")));
  }
  console.log("");

  appendActionLog(
    createActionLog({
      agentId: params.agentId,
      action: "vault_cycle",
      ok: true,
      reason: "Vault strategy cycle executed",
      details: {
        rpcUrl: params.rpcUrl,
        cycleCount: params.cycleCount,
        vaultIdentity,
        strategyId: vaultConfig.strategyId,
        vaultId: vaultConfig.vaultId,
        baseAsset: vaultConfig.baseAsset,
        assetMint: vaultConfig.assetMint,
        allowedAssets: vaultConfig.allowedAssets,
        balances: {
          sol: params.balances.sol,
          mintAddress: params.balances.mintAddress,
          ata: params.balances.ata,
          tokenRaw: params.balances.tokenRaw,
          tokenUi: params.balances.tokenUi,
        },
        vaultState,
        strategyContext: {
          balances: strategyBalances,
          prices,
          recentTradesCount: recentTrades.length,
          openPositionsCount: openPositions.length,
        },
        intent,
        policyDecision,
      },
    })
  );

  if (intent.action === "HOLD") {
    if (intent.reason === "NAV below execution threshold") {
      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "vault_skip_execution",
          ok: true,
          reason: `NAV too small for execution (${navUsd.toFixed(4)} < ${MIN_NAV_USD_TO_EXECUTE})`,
          details: {
            navUsd,
            minNavUsdToExecute: MIN_NAV_USD_TO_EXECUTE,
            targetNotionalUsd: Number(intent.targetNotionalUsd ?? 0),
            intent,
          },
        })
      );

      console.log(
        warn(
          `Vault execution skipped: NAV too small for execution (${navUsd.toFixed(4)} < ${MIN_NAV_USD_TO_EXECUTE})`
        )
      );
      return;
    }

    console.log(warn("Vault strategy is holding"));
    return;
  }

  if (!policyDecision.approved) {
    console.log(warn("Vault intent rejected by policy"));
    return;
  }

  const targetNotionalUsd = Number(intent.targetNotionalUsd ?? 0);

  if (targetNotionalUsd < MIN_TRADE_NOTIONAL_USD) {
    const reason = `Trade notional too small (${targetNotionalUsd.toFixed(6)} < ${MIN_TRADE_NOTIONAL_USD})`;

    appendActionLog(
      createActionLog({
        agentId: params.agentId,
        action: "vault_skip_execution",
        ok: true,
        reason,
        details: {
          navUsd,
          targetNotionalUsd,
          minTradeNotionalUsd: MIN_TRADE_NOTIONAL_USD,
          intent,
        },
      })
    );

    console.log(warn(`Vault execution skipped: ${reason}`));
    return;
  }

  const execution = await executeStrategyIntent({
    agentId: params.agentId,
    version: params.config.version,
    intent,
    context,
    cluster: params.config.jupiter.cluster,
    execute: params.config.jupiter.execute && params.config.mode === "live",
    maxSlippageBps: vaultConfig.maxSlippageBps,
  });

  if (!execution.ok) {
    console.log(errText(`Vault execution failed: ${execution.error}`));
    return;
  }

  const accounting = updateAccountingFromExecution({
    agentId: params.agentId,
    execution: execution.executionResult,
    portfolioState: {
      portfolioId,
      totalValueUsd: Number(vaultState.totalValueUsd ?? 0),
      availableCapitalUsd: Number(vaultState.availableCapitalUsd ?? 0),
      reservedCapitalUsd: Number(vaultState.reservedCapitalUsd ?? 0),
      deployedCapitalUsd: Number(vaultState.deployedCapitalUsd ?? 0),
      baseAssetMint: String(vaultState.baseAssetMint ?? strategyConfig.baseAssetMint),
      realizedPnlUsd: Number(vaultState.realizedPnlUsd ?? 0),
      unrealizedPnlUsd: Number(vaultState.unrealizedPnlUsd ?? 0),
      grossExposureUsd: Number(vaultState.grossExposureUsd ?? 0),
      netExposureUsd: Number(vaultState.netExposureUsd ?? 0),
      drawdownPct: Number(vaultState.drawdownPct ?? 0),
      highWaterMarkUsd: Number(vaultState.highWaterMarkUsd ?? 0),
      lastSyncAt: String(vaultState.lastSyncAt ?? new Date().toISOString()),
    },
    prices,
    reason: intent.reason,
    side: intent.action === "SELL" ? "SELL" : "BUY",
  });

  await vaultAdapter.recordExecution(execution.executionResult);

  console.log(success("Vault intent executed and recorded"));
  console.log(
    keyValue("Signature: ", execution.executionResult.txSignature ?? "—")
  );
  console.log(keyValue("Input:     ", execution.inputSymbol));
  console.log(keyValue("Output:    ", execution.outputSymbol));
  console.log(keyValue("Exec UI:   ", String(execution.executionAmountUi)));
  console.log(keyValue("Trades:    ", String(accounting.trades.length)));
  console.log(keyValue("Positions: ", String(accounting.positions.length)));
  console.log(keyValue("Realized:  ", String(accounting.realizedPnlUsd)));

  if (params.config.x.autoPost) {
    await maybeAutoPost({
      agentId: params.agentId,
      enabled: true,
      reason: "vault strategy execution",
    });
  }
}

export async function runAgentRuntime(params: {
  agentId: string;
  rpcUrl: string;
  live?: boolean;
}): Promise<void> {
  const config = loadAgentConfig({
    agentId: params.agentId,
    forceLive: params.live,
  });

  const strategyMode = resolveStrategyMode(config);
  const vaultConfig = resolveVaultRuntimeConfig(config);
  const managedConfig = resolveManagedRuntimeConfig(config);

  appendActionLog(
    createActionLog({
      agentId: params.agentId,
      action: "boot",
      ok: true,
      reason: "Agent runtime booted",
      details: {
        mode: config.mode,
        version: config.version,
        rpcUrl: params.rpcUrl,
        strategyMode,
        vaultEnabled: vaultConfig.enabled,
        vaultId: vaultConfig.vaultId,
        vaultSource: vaultConfig.source,
        rangerVaultPubkey: vaultConfig.rangerVaultPubkey,
        managedEnabled: managedConfig.enabled,
        managedStrategyId: managedConfig.strategyId,
        managedExecutionEnabled: managedConfig.executionEnabled,
        managedExecutionMode: managedConfig.executionMode,
        strategyId:
          strategyMode === "managed"
            ? managedConfig.strategyId
            : vaultConfig.strategyId,
        assetMint: vaultConfig.assetMint,
      },
    })
  );

  appendDraftPost(
    createBootDraft({
      agentId: params.agentId,
      config,
    })
  );

  console.log("");
  console.log(banner("AGENT RUNTIME ONLINE"));
  console.log(keyValue("Agent:   ", params.agentId));
  console.log(keyValue("Public:  ", config.persona.publicName));
  console.log(keyValue("Mode:    ", String(config.mode)));
  console.log(keyValue("Version: ", String(config.version)));
  console.log(keyValue("RPC:     ", params.rpcUrl));
  console.log(
    keyValue("Loop:    ", `every ${config.runtime.loopIntervalSeconds}s`)
  );
  console.log(keyValue("Strategy:", strategyMode));

  if (strategyMode === "managed") {
    console.log(
      keyValue("Managed: ", managedConfig.enabled ? "enabled" : "disabled")
    );
    console.log(keyValue("Strat ID:", managedConfig.strategyId));
    console.log(keyValue("Base:    ", managedConfig.baseAsset));
    console.log(keyValue("Deposit: ", managedConfig.depositAsset));
    console.log(keyValue("Exec:    ", managedConfig.executionMode));
  } else if (vaultConfig.enabled) {
    console.log(keyValue("Vault:   ", "enabled"));
    console.log(keyValue("Source:  ", vaultConfig.source));
    console.log(keyValue("Strategy:", vaultConfig.strategyId));
    console.log(keyValue("Vault ID:", vaultConfig.vaultId));
    if (vaultConfig.assetMint) {
      console.log(keyValue("Mint:    ", vaultConfig.assetMint));
    }
    if (vaultConfig.rangerVaultPubkey) {
      console.log(keyValue("Ranger:  ", vaultConfig.rangerVaultPubkey));
    }
  } else {
    console.log(keyValue("Vault:   ", "disabled"));
  }

  console.log(color(line("─", 72), ansi.gray));

  while (true) {
    let memory = loadAgentMemory({
      agentId: params.agentId,
      version: config.version,
    });

    try {
      memory = markCycle(memory);
      saveAgentMemory(memory);

      const balances = await readBalances({
        rpcUrl: params.rpcUrl,
        agentId: params.agentId,
      });

      memory = markBalanceCheck(memory);
      saveAgentMemory(memory);

      console.log("");
      console.log(banner(`CYCLE ${memory.counters.cycleCount}`));
      console.log(
        keyValue(
          "Balances:",
          `SOL=${balances.sol.toFixed(4)} | TOKEN=${balances.tokenUi ?? "—"}`
        )
      );
      if (balances.mintAddress) {
        console.log(keyValue("Mint:    ", balances.mintAddress));
      }
      if (balances.ata) {
        console.log(keyValue("ATA:     ", balances.ata));
      }
      console.log("");

      if (strategyMode === "managed" && managedConfig.enabled) {
        await runManagedCycle({
          agentId: params.agentId,
          rpcUrl: params.rpcUrl,
          config,
          balances,
          cycleCount: memory.counters.cycleCount,
        });

        console.log(
          subtle(
            `Sleeping ${config.runtime.loopIntervalSeconds}s until next cycle...`
          )
        );
        await sleep(config.runtime.loopIntervalSeconds * 1000);
        continue;
      }

      if (vaultConfig.enabled) {
        await runVaultCycle({
          agentId: params.agentId,
          rpcUrl: params.rpcUrl,
          config,
          balances,
          cycleCount: memory.counters.cycleCount,
        });

        const reputation = saveReputationFromLogs(params.agentId);

        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "summary",
            ok: true,
            reason: "Vault cycle summary written",
            details: {
              vaultEnabled: true,
              vaultSource: vaultConfig.source,
              rangerVaultPubkey: vaultConfig.rangerVaultPubkey,
              strategyId: vaultConfig.strategyId,
              vaultId: vaultConfig.vaultId,
              assetMint: vaultConfig.assetMint,
              reputationScore: reputation.score,
              successfulTrades: reputation.successfulTrades,
              successfulPayments: reputation.successfulPayments,
              failedActions: reputation.failedActions,
            },
          })
        );

        console.log("");
        console.log(section("Cycle summary"));
        console.log(keyValue("Vault:     ", "enabled"));
        console.log(keyValue("Source:    ", vaultConfig.source));
        console.log(keyValue("Strategy:  ", vaultConfig.strategyId));
        console.log(keyValue("Reputation:", String(reputation.score)));
        console.log(keyValue("Trades:    ", String(reputation.successfulTrades)));
        console.log(
          keyValue("Payments:  ", String(reputation.successfulPayments))
        );
        console.log(keyValue("Failures:  ", String(reputation.failedActions)));
        console.log(color(line("─", 72), ansi.gray));
        console.log(
          subtle(
            `Sleeping ${config.runtime.loopIntervalSeconds}s until next cycle...`
          )
        );

        await sleep(config.runtime.loopIntervalSeconds * 1000);
        continue;
      }

      console.log(section("Registry check"));
      const registryResult = await runRegistryTask({
        rpcUrl: params.rpcUrl,
        agentId: params.agentId,
        version: config.version,
      });

      const registered = registryResult.ok ? registryResult.registered : false;

      if (registryResult.ok) {
        console.log(
          `${success("Registry status:")} ${
            registered ? value("registered") : warn("not registered")
          }`
        );
        if (registryResult.registryPda) {
          console.log(keyValue("Registry: ", registryResult.registryPda));
        }
      } else {
        console.log(`${errText("Registry error:")} ${registryResult.error}`);
      }

      if (
        registryResult.ok &&
        !registryResult.alreadyRegistered &&
        config.x.autoPost
      ) {
        await maybeAutoPost({
          agentId: params.agentId,
          enabled: true,
          reason: "registry registration",
        });
      }

      memory = loadAgentMemory({
        agentId: params.agentId,
        version: config.version,
      });

      memory = normalizeMemoryForPolicy(memory);
      saveAgentMemory(memory);

      const decision = decideNextAction({
        config,
        memory,
        registered,
        solBalance: balances.sol,
        preferX402: memory.counters.cycleCount % 2 === 1,
        preferJupiter: memory.counters.cycleCount % 2 === 0,
        preferDraft: true,
      });

      console.log("");
      console.log(section("Policy decision"));
      console.log(`${subtle("Action:")} ${value(decision.action)}`);
      console.log(`${subtle("Reason:")} ${value(decision.reason)}`);
      console.log(color(line("─", 72), ansi.gray));

      if (decision.action === "x402_payment") {
        const paymentResult = await runX402Task({
          agentId: params.agentId,
          version: config.version,
          serverUrl: config.x402.serverUrl,
        });

        if (paymentResult.ok) {
          console.log(success("x402 payment task completed"));
          if (paymentResult.signature) {
            console.log(keyValue("Signature:", paymentResult.signature));
          }
          if (paymentResult.explorerUrl) {
            console.log(keyValue("Proof:    ", paymentResult.explorerUrl));
          }

          if (config.x.autoPost) {
            await maybeAutoPost({
              agentId: params.agentId,
              enabled: true,
              reason: "x402 payment",
            });
          }
        } else {
          console.log(
            errText(`x402 payment task failed: ${paymentResult.error}`)
          );
        }
      } else if (decision.action === "jupiter_swap") {
        const swapResult = await runJupiterTask({
          agentId: params.agentId,
          version: config.version,
          solAmount: config.jupiter.solPerTrade,
          slippageBps: config.jupiter.slippageBps,
          cluster: config.jupiter.cluster,
          execute: config.jupiter.execute && config.mode === "live",
        });

        if (swapResult.ok) {
          console.log(success("Jupiter task completed"));
          if (swapResult.signature) {
            console.log(keyValue("Signature:", swapResult.signature));
          }

          if (config.x.autoPost) {
            await maybeAutoPost({
              agentId: params.agentId,
              enabled: true,
              reason: "jupiter swap",
            });
          }
        } else {
          console.log(errText(`Jupiter task failed: ${swapResult.error}`));
        }
      } else if (decision.action === "draft_post") {
        const recentEntries = readRecentActionLogs(params.agentId, 25);
        const currentReputation = loadAgentReputation(params.agentId);

        appendDraftPost(
          createSummaryDraft({
            agentId: params.agentId,
            config,
            reputation: currentReputation,
            recentEntries,
          })
        );

        memory = loadAgentMemory({
          agentId: params.agentId,
          version: config.version,
        });
        memory = markDraftCreated(memory);
        saveAgentMemory(memory);

        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "draft_post",
            ok: true,
            reason: "Created summary draft",
          })
        );

        console.log(success("Summary draft created"));

        if (config.x.autoPost) {
          await maybeAutoPost({
            agentId: params.agentId,
            enabled: true,
            reason: "summary draft",
          });
        }
      } else {
        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "noop",
            ok: true,
            reason: decision.reason,
          })
        );

        console.log(warn("No action executed this cycle"));
      }

      const reputation = saveReputationFromLogs(params.agentId);

      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "summary",
          ok: true,
          reason: "Cycle summary written",
          details: {
            reputationScore: reputation.score,
            successfulTrades: reputation.successfulTrades,
            successfulPayments: reputation.successfulPayments,
            failedActions: reputation.failedActions,
          },
        })
      );

      console.log("");
      console.log(section("Cycle summary"));
      console.log(keyValue("Reputation:", String(reputation.score)));
      console.log(keyValue("Trades:    ", String(reputation.successfulTrades)));
      console.log(
        keyValue("Payments:  ", String(reputation.successfulPayments))
      );
      console.log(keyValue("Failures:  ", String(reputation.failedActions)));
      console.log(color(line("─", 72), ansi.gray));
      console.log(
        subtle(`Sleeping ${config.runtime.loopIntervalSeconds}s until next cycle...`)
      );
    } catch (error: any) {
      memory = loadAgentMemory({
        agentId: params.agentId,
        version: config.version,
      });
      memory = markError(memory);
      saveAgentMemory(memory);

      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "error",
          ok: false,
          reason: String(error?.message ?? error),
        })
      );

      saveReputationFromLogs(params.agentId);

      console.log("");
      console.log(errText("Runtime cycle error"));
      console.log(color(String(error?.message ?? error), ansi.red));
      console.log(color(line("─", 72), ansi.gray));
    }

    await sleep(config.runtime.loopIntervalSeconds * 1000);
  }
}
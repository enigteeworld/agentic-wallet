import { loadAgentConfig } from "../../agent/config";
import { createManagedStrategyRuntime } from "../../strategy/managed";
import type { AgentConfig } from "../../agent/types";

type ManagedExecutionConfig = {
  enabled?: boolean;
  mode?: "simulated" | "live";
  route?: "jupiter";
  allowBuy?: boolean;
  allowSell?: boolean;
  maxLiveNotionalUsd?: number;
  minLiveNotionalUsd?: number;
  reconcileAfterTrade?: boolean;
  maxPriceDeviationPct?: number;
};

function getManagedConfigOrThrow(config: AgentConfig) {
  if (!config.managedStrategy?.enabled) {
    throw new Error("Managed strategy is not enabled in agent config");
  }

  if (!config.strategy || config.strategy.mode !== "managed") {
    throw new Error("Strategy mode is not configured as managed");
  }

  return {
    managed: config.managedStrategy,
    strategy: config.strategy,
  };
}

function getExecutionConfig(config: AgentConfig): ManagedExecutionConfig {
  return ((config.managedStrategy as any)?.execution ??
    {}) as ManagedExecutionConfig;
}

function buildStrategyStatus(config: AgentConfig): "active" | "disabled" {
  const managedEnabled = config.managedStrategy?.enabled === true;
  const strategyManaged = config.strategy?.mode === "managed";

  return managedEnabled && strategyManaged ? "active" : "disabled";
}

export function getManagedStrategySummary(agentId: string) {
  const config = loadAgentConfig({ agentId });
  const { managed, strategy } = getManagedConfigOrThrow(config);
  const execution = getExecutionConfig(config);
  const runtime = createManagedStrategyRuntime();
  const overview = runtime.getOverview();

  return {
    id: String(managed.strategyId),
    agentId,
    name: "CARV-1",
    type: "managed",
    status: buildStrategyStatus(config),
    description:
      "Managed USDC strategy runtime for CARV-1 with vault-style accounting, local state, and execution controls.",
    baseAsset: String(managed.baseAsset),
    depositAsset: String(managed.depositAsset),
    allowedAssets: [...strategy.allowedAssets],
    execution: {
      enabled: Boolean(execution.enabled ?? false),
      mode: String(execution.mode ?? "simulated"),
      route: String(execution.route ?? "jupiter"),
      allowBuy: Boolean(execution.allowBuy ?? true),
      allowSell: Boolean(execution.allowSell ?? true),
    },
    cadenceSeconds: Number(config.runtime.loopIntervalSeconds),
    totals: {
      users: overview.totalUsers,
      deposited: overview.totalDeposited,
      withdrawn: overview.totalWithdrawn,
      shares: overview.valuation.totalShares,
      totalValue: overview.valuation.totalValue,
      liquidValue: overview.valuation.liquidValue,
      investedValue: overview.valuation.investedValue,
      sharePrice: overview.valuation.sharePrice,
      pendingWithdrawalAmount: overview.pendingWithdrawalAmount,
      pendingWithdrawalCount: overview.pendingWithdrawalCount,
      updatedAt: overview.valuation.updatedAt,
    },
  };
}

export function getManagedStrategyDetail(agentId: string, strategyId: string) {
  const config = loadAgentConfig({ agentId });
  const { managed, strategy } = getManagedConfigOrThrow(config);
  const execution = getExecutionConfig(config);
  const runtime = createManagedStrategyRuntime();
  const overview = runtime.getOverview();

  if (String(managed.strategyId) !== strategyId) {
    throw new Error(
      `Requested strategy "${strategyId}" does not match configured strategy "${managed.strategyId}"`
    );
  }

  return {
    id: String(managed.strategyId),
    agentId,
    name: "CARV-1",
    type: "managed",
    status: buildStrategyStatus(config),
    description:
      "Managed strategy backend for Corsair. Supports accounting, signal/intent generation, preview/execution gating, and local runtime orchestration.",
    runtime: {
      mode: config.mode,
      version: config.version,
      loopIntervalSeconds: config.runtime.loopIntervalSeconds,
    },
    assets: {
      baseAsset: String(managed.baseAsset),
      depositAsset: String(managed.depositAsset),
      allowedAssets: [...strategy.allowedAssets],
    },
    policy: {
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
    },
    depositPolicy: {
      sourceWalletRequired: managed.depositPolicy.sourceWalletRequired,
      withdrawToSourceWalletOnly: managed.depositPolicy.withdrawToSourceWalletOnly,
      manualDepositConfirmation: managed.depositPolicy.manualDepositConfirmation,
    },
    withdrawalPolicy: {
      allowPartialWithdrawals: managed.withdrawalPolicy.allowPartialWithdrawals,
      queueIfInsufficientLiquidity:
        managed.withdrawalPolicy.queueIfInsufficientLiquidity,
      manualExecution: managed.withdrawalPolicy.manualExecution,
    },
    accounting: {
      shareDecimals: managed.accounting.shareDecimals,
      initialSharePrice: managed.accounting.initialSharePrice,
    },
    execution: {
      enabled: Boolean(execution.enabled ?? false),
      mode: String(execution.mode ?? "simulated"),
      route: String(execution.route ?? "jupiter"),
      allowBuy: Boolean(execution.allowBuy ?? true),
      allowSell: Boolean(execution.allowSell ?? true),
      maxLiveNotionalUsd: Number(execution.maxLiveNotionalUsd ?? 5),
      minLiveNotionalUsd: Number(execution.minLiveNotionalUsd ?? 1),
      reconcileAfterTrade: Boolean(execution.reconcileAfterTrade ?? true),
      maxPriceDeviationPct: Number(execution.maxPriceDeviationPct ?? 0),
    },
    overview: {
      totalUsers: overview.totalUsers,
      totalDeposited: overview.totalDeposited,
      totalWithdrawn: overview.totalWithdrawn,
      pendingWithdrawalAmount: overview.pendingWithdrawalAmount,
      pendingWithdrawalCount: overview.pendingWithdrawalCount,
      valuation: {
        totalShares: overview.valuation.totalShares,
        totalValue: overview.valuation.totalValue,
        liquidValue: overview.valuation.liquidValue,
        investedValue: overview.valuation.investedValue,
        reservedForWithdrawals: overview.valuation.reservedForWithdrawals,
        sharePrice: overview.valuation.sharePrice,
        updatedAt: overview.valuation.updatedAt,
      },
    },
  };
}
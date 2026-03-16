import type {
  ExecutionResult,
  PerformanceSnapshot,
  VaultState,
} from "../strategy/types";
import type { VaultAdapter } from "./interfaces";

export class RangerVaultAdapter implements VaultAdapter {
  async getVaultState(): Promise<VaultState> {
    return {
      vaultId: "ranger-vault-001",
      totalValueUsd: 0,
      availableCapitalUsd: 0,
      reservedCapitalUsd: 0,
      deployedCapitalUsd: 0,
      baseAssetMint: "USDC",
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      grossExposureUsd: 0,
      netExposureUsd: 0,
      drawdownPct: 0,
      highWaterMarkUsd: 0,
      lastSyncAt: new Date().toISOString(),
    };
  }

  async getDeployableCapitalUsd(): Promise<number> {
    const state = await this.getVaultState();
    return Math.max(0, state.availableCapitalUsd - state.reservedCapitalUsd);
  }

  async getBaseAssetMint(): Promise<string> {
    return "USDC";
  }

  async recordExecution(_result: ExecutionResult): Promise<void> {
    return;
  }

  async getPerformanceSnapshot(): Promise<PerformanceSnapshot> {
    return {
      navUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      cumulativeReturnPct: 0,
      drawdownPct: 0,
      highWaterMarkUsd: 0,
      grossExposureUsd: 0,
      cashPct: 1,
      updatedAt: new Date().toISOString(),
    };
  }
}
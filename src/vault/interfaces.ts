import type {
  ExecutionResult,
  PerformanceSnapshot,
  VaultState,
} from "../strategy/types";

export interface VaultAdapter {
  getVaultState(): Promise<VaultState>;
  getDeployableCapitalUsd(): Promise<number>;
  getBaseAssetMint(): Promise<string>;
  recordExecution(result: ExecutionResult): Promise<void>;
  getPerformanceSnapshot(): Promise<PerformanceSnapshot>;
}
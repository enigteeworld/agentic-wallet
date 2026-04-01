import type {
  ExecutionResult,
  PerformanceSnapshot,
  PortfolioState,
} from "../strategy/types";

export type VaultIdentity = {
  vaultId: string;
  baseAssetMint: string;
  source: "local" | "ranger";
  rangerVaultPubkey?: string;
  managerAuthority?: string;
  adminAuthority?: string;
  listed?: boolean;
};

export interface VaultAdapter {
  getVaultIdentity(): Promise<VaultIdentity>;
  getVaultState(): Promise<PortfolioState>;
  getDeployableCapitalUsd(): Promise<number>;
  getBaseAssetMint(): Promise<string>;
  recordExecution(result: ExecutionResult): Promise<void>;
  getPerformanceSnapshot(): Promise<PerformanceSnapshot>;
}
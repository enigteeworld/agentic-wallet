import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { VoltrClient } from "@voltr/vault-sdk";
import type {
  ExecutionResult,
  PerformanceSnapshot,
  VaultState,
} from "../strategy/types";
import type { VaultAdapter, VaultIdentity } from "./interfaces";

type PersistedVaultSnapshot = {
  vaultId: string;
  baseAssetMint: string;
  totalValueUsd: number;
  availableCapitalUsd: number;
  reservedCapitalUsd: number;
  deployedCapitalUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  grossExposureUsd: number;
  netExposureUsd: number;
  highWaterMarkUsd: number;
  lastSyncAt: string;
};

type PersistedVaultMetadata = {
  vaultId: string;
  source: "local" | "ranger";
  rangerVaultPubkey?: string;
  managerAuthority?: string;
  adminAuthority?: string;
  baseAssetMint: string;
  listed?: boolean;
  createdAt: string;
  updatedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function vaultStateDir(): string {
  return path.resolve(process.cwd(), "state", "vault");
}

function ensureVaultStateDir(): void {
  fs.mkdirSync(vaultStateDir(), { recursive: true });
}

function vaultSnapshotPath(vaultId: string): string {
  return path.join(vaultStateDir(), `${vaultId}.state.json`);
}

function vaultExecutionsPath(vaultId: string): string {
  return path.join(vaultStateDir(), `${vaultId}.executions.json`);
}

function vaultMetadataPath(vaultId: string): string {
  return path.join(vaultStateDir(), `${vaultId}.meta.json`);
}

function performancePath(agentId: string): string {
  return path.join(vaultStateDir(), `${agentId}.performance.json`);
}

function positionsPath(agentId: string): string {
  return path.join(vaultStateDir(), `${agentId}.positions.json`);
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

function createDefaultSnapshot(params: {
  vaultId: string;
  baseAssetMint: string;
}): PersistedVaultSnapshot {
  return {
    vaultId: params.vaultId,
    baseAssetMint: params.baseAssetMint,
    totalValueUsd: 0,
    availableCapitalUsd: 0,
    reservedCapitalUsd: 0,
    deployedCapitalUsd: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    grossExposureUsd: 0,
    netExposureUsd: 0,
    highWaterMarkUsd: 0,
    lastSyncAt: nowIso(),
  };
}

function createDefaultMetadata(params: {
  vaultId: string;
  baseAssetMint: string;
  source: "local" | "ranger";
  rangerVaultPubkey?: string;
  managerAuthority?: string;
  adminAuthority?: string;
  listed?: boolean;
}): PersistedVaultMetadata {
  const now = nowIso();

  return {
    vaultId: params.vaultId,
    source: params.source,
    rangerVaultPubkey: params.rangerVaultPubkey,
    managerAuthority: params.managerAuthority,
    adminAuthority: params.adminAuthority,
    baseAssetMint: params.baseAssetMint,
    listed: params.listed ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

export class RangerVaultAdapter implements VaultAdapter {
  constructor(
    private readonly params: {
      vaultId: string;
      baseAssetMint: string;
      agentId?: string;
      minReservePct?: number;
      source?: "local" | "ranger";
      rangerVaultPubkey?: string;
      managerAuthority?: string;
      adminAuthority?: string;
      listed?: boolean;
      rpcUrl?: string;
    }
  ) {}

  private get agentId(): string {
    return this.params.agentId ?? "agent-001";
  }

  private get minReservePct(): number {
    return this.params.minReservePct ?? 0.4;
  }

  private get source(): "local" | "ranger" {
    return this.params.source ?? "local";
  }

  private get rpcUrl(): string | undefined {
    return this.params.rpcUrl;
  }

  private loadSnapshot(): PersistedVaultSnapshot {
    ensureVaultStateDir();

    const filepath = vaultSnapshotPath(this.params.vaultId);
    const fallback = createDefaultSnapshot({
      vaultId: this.params.vaultId,
      baseAssetMint: this.params.baseAssetMint,
    });

    const snapshot = readJsonFile<PersistedVaultSnapshot>(filepath, fallback);

    if (!fs.existsSync(filepath)) {
      writeJsonFile(filepath, snapshot);
    }

    return snapshot;
  }

  private saveSnapshot(snapshot: PersistedVaultSnapshot): void {
    ensureVaultStateDir();
    writeJsonFile(vaultSnapshotPath(this.params.vaultId), snapshot);
  }

  private loadMetadata(): PersistedVaultMetadata {
    ensureVaultStateDir();

    const filepath = vaultMetadataPath(this.params.vaultId);
    const fallback = createDefaultMetadata({
      vaultId: this.params.vaultId,
      baseAssetMint: this.params.baseAssetMint,
      source: this.source,
      rangerVaultPubkey: this.params.rangerVaultPubkey,
      managerAuthority: this.params.managerAuthority,
      adminAuthority: this.params.adminAuthority,
      listed: this.params.listed,
    });

    const raw = readJsonFile<Record<string, unknown>>(filepath, {});

    const metadata: PersistedVaultMetadata = {
      vaultId:
        typeof raw.vaultId === "string" && raw.vaultId.trim().length > 0
          ? raw.vaultId
          : this.params.vaultId,
      source:
        raw.source === "ranger" || raw.source === "local"
          ? raw.source
          : this.source,
      rangerVaultPubkey:
        typeof raw.rangerVaultPubkey === "string" && raw.rangerVaultPubkey.trim().length > 0
          ? raw.rangerVaultPubkey
          : this.params.rangerVaultPubkey,
      managerAuthority:
        typeof raw.managerAuthority === "string" && raw.managerAuthority.trim().length > 0
          ? raw.managerAuthority
          : this.params.managerAuthority,
      adminAuthority:
        typeof raw.adminAuthority === "string" && raw.adminAuthority.trim().length > 0
          ? raw.adminAuthority
          : this.params.adminAuthority,
      baseAssetMint:
        typeof raw.baseAssetMint === "string" && raw.baseAssetMint.trim().length > 0
          ? raw.baseAssetMint
          : this.params.baseAssetMint,
      listed:
        typeof raw.listed === "boolean"
          ? raw.listed
          : this.params.listed ?? false,
      createdAt:
        typeof raw.createdAt === "string" && raw.createdAt.trim().length > 0
          ? raw.createdAt
          : fallback.createdAt,
      updatedAt: nowIso(),
    };

    writeJsonFile(filepath, metadata);
    return metadata;
  }

  private saveMetadata(metadata: PersistedVaultMetadata): void {
    ensureVaultStateDir();
    writeJsonFile(vaultMetadataPath(this.params.vaultId), metadata);
  }

  private async tryLoadRangerBaseBalanceUsd(): Promise<number | null> {
    if (this.source !== "ranger") return null;
    if (!this.params.rangerVaultPubkey) return null;
    if (!this.rpcUrl) return null;

    try {
      const connection = new Connection(this.rpcUrl, "confirmed");
      const vaultPk = new PublicKey(this.params.rangerVaultPubkey);
      const baseMintPk = new PublicKey(this.params.baseAssetMint);
      const client = new VoltrClient(connection);

      const { vaultAssetIdleAuth } = client.findVaultAddresses(vaultPk);

      const vaultAssetIdleAta = getAssociatedTokenAddressSync(
        baseMintPk,
        vaultAssetIdleAuth,
        true,
        TOKEN_PROGRAM_ID,
      );

      const [account, mintInfo] = await Promise.all([
        getAccount(connection, vaultAssetIdleAta, "confirmed", TOKEN_PROGRAM_ID),
        getMint(connection, baseMintPk, "confirmed", TOKEN_PROGRAM_ID),
      ]);

      const decimals = mintInfo.decimals;
      const totalUi = Number(account.amount) / 10 ** decimals;

      return Number.isFinite(totalUi) ? totalUi : 0;
    } catch {
      return null;
    }
  }

  async getVaultIdentity(): Promise<VaultIdentity> {
    const metadata = this.loadMetadata();

    const nextMetadata: PersistedVaultMetadata = {
      ...metadata,
      vaultId:
        metadata.vaultId && metadata.vaultId.trim().length > 0
          ? metadata.vaultId
          : this.params.vaultId,
      source: this.source,
      rangerVaultPubkey:
        this.params.rangerVaultPubkey ?? metadata.rangerVaultPubkey,
      managerAuthority:
        this.params.managerAuthority ?? metadata.managerAuthority,
      adminAuthority: this.params.adminAuthority ?? metadata.adminAuthority,
      baseAssetMint: this.params.baseAssetMint,
      listed: this.params.listed ?? metadata.listed ?? false,
      updatedAt: nowIso(),
    };

    this.saveMetadata(nextMetadata);

    return {
      vaultId: nextMetadata.vaultId,
      baseAssetMint: nextMetadata.baseAssetMint,
      source: nextMetadata.source,
      rangerVaultPubkey: nextMetadata.rangerVaultPubkey,
      managerAuthority: nextMetadata.managerAuthority,
      adminAuthority: nextMetadata.adminAuthority,
      listed: nextMetadata.listed,
    };
  }

  async getVaultState(): Promise<VaultState> {
    const snapshot = this.loadSnapshot();
    const performance = readJsonFile<PerformanceSnapshot | null>(
      performancePath(this.agentId),
      null
    );

    const rangerBaseBalanceUsd = await this.tryLoadRangerBaseBalanceUsd();

    const grossExposureUsd =
      performance?.grossExposureUsd ?? snapshot.grossExposureUsd ?? 0;

    const unrealizedPnlUsd =
      performance?.unrealizedPnlUsd ?? snapshot.unrealizedPnlUsd ?? 0;

    const realizedPnlUsd =
      performance?.realizedPnlUsd ?? snapshot.realizedPnlUsd ?? 0;

    const availableCapitalUsd =
      rangerBaseBalanceUsd ??
      snapshot.availableCapitalUsd ??
      Math.max(0, (performance?.navUsd ?? snapshot.totalValueUsd ?? 0) - grossExposureUsd);

    const totalValueUsd =
      this.source === "ranger"
        ? availableCapitalUsd + grossExposureUsd
        : performance?.navUsd ?? snapshot.totalValueUsd ?? 0;

    const reservedCapitalUsd = totalValueUsd * this.minReservePct;
    const deployedCapitalUsd = grossExposureUsd;

    const highWaterMarkUsd =
      snapshot.highWaterMarkUsd > 0
        ? Math.max(snapshot.highWaterMarkUsd, totalValueUsd)
        : totalValueUsd > 0
          ? totalValueUsd
          : 0;

    const drawdownPct =
      highWaterMarkUsd > 0
        ? Math.max(0, (highWaterMarkUsd - totalValueUsd) / highWaterMarkUsd)
        : 0;

    const nextSnapshot: PersistedVaultSnapshot = {
      ...snapshot,
      totalValueUsd,
      availableCapitalUsd,
      reservedCapitalUsd,
      deployedCapitalUsd,
      realizedPnlUsd,
      unrealizedPnlUsd,
      grossExposureUsd,
      netExposureUsd: grossExposureUsd,
      highWaterMarkUsd,
      lastSyncAt: nowIso(),
    };

    this.saveSnapshot(nextSnapshot);

    return {
      vaultId: nextSnapshot.vaultId,
      totalValueUsd: nextSnapshot.totalValueUsd,
      availableCapitalUsd: nextSnapshot.availableCapitalUsd,
      reservedCapitalUsd: nextSnapshot.reservedCapitalUsd,
      deployedCapitalUsd: nextSnapshot.deployedCapitalUsd,
      baseAssetMint: nextSnapshot.baseAssetMint,
      realizedPnlUsd: nextSnapshot.realizedPnlUsd,
      unrealizedPnlUsd: nextSnapshot.unrealizedPnlUsd,
      grossExposureUsd: nextSnapshot.grossExposureUsd,
      netExposureUsd: nextSnapshot.netExposureUsd,
      drawdownPct,
      highWaterMarkUsd: nextSnapshot.highWaterMarkUsd,
      lastSyncAt: nextSnapshot.lastSyncAt,
    };
  }

  async getDeployableCapitalUsd(): Promise<number> {
    const state = await this.getVaultState();
    return Math.max(0, state.availableCapitalUsd - state.reservedCapitalUsd);
  }

  async getBaseAssetMint(): Promise<string> {
    return this.params.baseAssetMint;
  }

  async recordExecution(result: ExecutionResult): Promise<void> {
    ensureVaultStateDir();

    const executions = readJsonFile<ExecutionResult[]>(
      vaultExecutionsPath(this.params.vaultId),
      []
    );

    executions.push(result);
    writeJsonFile(vaultExecutionsPath(this.params.vaultId), executions);

    const snapshot = this.loadSnapshot();
    const positions = readJsonFile<Array<{ marketValueUsd?: number }>>(
      positionsPath(this.agentId),
      []
    );

    const grossExposureUsd = positions.reduce((sum, position) => {
      return sum + (position.marketValueUsd ?? 0);
    }, 0);

    const totalValueUsd =
      this.source === "ranger"
        ? (await this.tryLoadRangerBaseBalanceUsd() ?? snapshot.availableCapitalUsd) +
          grossExposureUsd
        : snapshot.totalValueUsd > 0
          ? snapshot.totalValueUsd
          : snapshot.availableCapitalUsd + grossExposureUsd;

    const highWaterMarkUsd =
      snapshot.highWaterMarkUsd > 0
        ? Math.max(snapshot.highWaterMarkUsd, totalValueUsd)
        : totalValueUsd;

    const updated: PersistedVaultSnapshot = {
      ...snapshot,
      totalValueUsd,
      availableCapitalUsd: Math.max(0, totalValueUsd - grossExposureUsd),
      reservedCapitalUsd: totalValueUsd * this.minReservePct,
      deployedCapitalUsd: grossExposureUsd,
      grossExposureUsd,
      netExposureUsd: grossExposureUsd,
      highWaterMarkUsd,
      lastSyncAt: nowIso(),
    };

    this.saveSnapshot(updated);
  }

  async getPerformanceSnapshot(): Promise<PerformanceSnapshot> {
    const snapshot = this.loadSnapshot();
    const persisted = readJsonFile<PerformanceSnapshot | null>(
      performancePath(this.agentId),
      null
    );

    const rangerBaseBalanceUsd = await this.tryLoadRangerBaseBalanceUsd();

    const grossExposureUsd =
      persisted?.grossExposureUsd ?? snapshot.grossExposureUsd ?? 0;

    const navUsd =
      this.source === "ranger"
        ? (rangerBaseBalanceUsd ?? snapshot.availableCapitalUsd ?? 0) +
          grossExposureUsd
        : persisted?.navUsd ?? snapshot.totalValueUsd ?? 0;

    const realizedPnlUsd =
      persisted?.realizedPnlUsd ?? snapshot.realizedPnlUsd ?? 0;

    const unrealizedPnlUsd =
      persisted?.unrealizedPnlUsd ?? snapshot.unrealizedPnlUsd ?? 0;

    const highWaterMarkUsd =
      snapshot.highWaterMarkUsd > 0
        ? Math.max(snapshot.highWaterMarkUsd, navUsd)
        : navUsd > 0
          ? navUsd
          : 0;

    const drawdownPct =
      highWaterMarkUsd > 0
        ? Math.max(0, (highWaterMarkUsd - navUsd) / highWaterMarkUsd)
        : 0;

    const effectiveAvailableCapitalUsd =
      this.source === "ranger"
        ? rangerBaseBalanceUsd ?? snapshot.availableCapitalUsd ?? 0
        : snapshot.availableCapitalUsd ?? 0;

    const cashPct = navUsd > 0 ? effectiveAvailableCapitalUsd / navUsd : 1;

    const cumulativeReturnPct =
      highWaterMarkUsd > 0
        ? (navUsd - highWaterMarkUsd) / highWaterMarkUsd
        : 0;

    return {
      navUsd,
      realizedPnlUsd,
      unrealizedPnlUsd,
      cumulativeReturnPct,
      drawdownPct,
      highWaterMarkUsd,
      grossExposureUsd,
      cashPct,
      updatedAt: nowIso(),
    };
  }
}
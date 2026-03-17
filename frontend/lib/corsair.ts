import fs from "fs";
import path from "path";

export type CorsairTelemetry = {
  agentId: string;
  generatedAt: string;
  summary: {
    totalActions: number;
    okActions: number;
    failedActions: number;
    successRatePct: number;
    latestActionAt?: string;
  };
  reputation: {
    score: number;
    successfulTrades: number;
    successfulPayments: number;
    failedActions: number;
    uptimeCycles: number;
    successRatePct: number;
  };
  performance: {
    navUsd: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    cumulativeReturnPct: number;
    drawdownPct: number;
    highWaterMarkUsd: number;
    grossExposureUsd: number;
    cashPct: number;
    updatedAt?: string;
  };
  trades: {
    total: number;
    buys: number;
    sells: number;
    realizedPnlUsd: number;
    latestTradeAt?: string;
    items: Array<{
      id?: string;
      timestamp?: string;
      side?: string;
      inputMint?: string;
      outputMint?: string;
      inputAmount?: number;
      outputAmount?: number;
      executionPriceUsd?: number;
      feesUsd?: number;
      slippageBps?: number;
      txSignature?: string;
      strategyReason?: string;
      realizedPnlUsd?: number;
    }>;
  };
  positions: {
    total: number;
    grossMarketValueUsd: number;
    items: Array<{
      mint?: string;
      symbol?: string;
      quantity?: number;
      avgEntryPriceUsd?: number;
      currentPriceUsd?: number;
      marketValueUsd?: number;
      unrealizedPnlUsd?: number;
      updatedAt?: string;
    }>;
  };
  vault: {
    vaultAddress?: string;
    manager?: string;
    admin?: string;
    baseAsset?: string;
    lpSymbol?: string;
    protocol?: string;
    strategy?: string;
    network?: string;
  };
  recentLogs: Array<{
    ts: string;
    action: string;
    ok: boolean;
    reason?: string;
    explorerUrl?: string;
  }>;
};

export type VaultMeta = {
  vaultId?: string;
  source?: "local" | "ranger";
  createdAt?: string;
  strategyId?: string;
  baseAsset?: string;
  rangerVaultPubkey?: string | null;
  managerAuthority?: string | null;
  adminAuthority?: string | null;
  listed?: boolean;
  vaultAddress?: string;
  manager?: string;
  admin?: string;
  lpSymbol?: string;
  protocol?: string;
  strategy?: string;
  network?: string;
};

function repoRoot(): string {
  return path.resolve(process.cwd(), "..");
}

function safeReadJson<T>(filepath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filepath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function telemetryPath(agentId: string): string {
  return path.join(repoRoot(), "public", "telemetry", agentId, "telemetry.json");
}

function fallbackVaultMetaPath(): string {
  return path.join(repoRoot(), "state", "vault", "ranger-vault-001.meta.json");
}

export function loadTelemetry(agentId = "agent-001"): CorsairTelemetry {
  const fallbackMeta = safeReadJson<VaultMeta>(fallbackVaultMetaPath(), {});
  const telemetry = safeReadJson<CorsairTelemetry>(telemetryPath(agentId), {
    agentId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalActions: 0,
      okActions: 0,
      failedActions: 0,
      successRatePct: 100,
      latestActionAt: undefined,
    },
    reputation: {
      score: 0,
      successfulTrades: 0,
      successfulPayments: 0,
      failedActions: 0,
      uptimeCycles: 0,
      successRatePct: 100,
    },
    performance: {
      navUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      cumulativeReturnPct: 0,
      drawdownPct: 0,
      highWaterMarkUsd: 0,
      grossExposureUsd: 0,
      cashPct: 1,
      updatedAt: undefined,
    },
    trades: {
      total: 0,
      buys: 0,
      sells: 0,
      realizedPnlUsd: 0,
      latestTradeAt: undefined,
      items: [],
    },
    positions: {
      total: 0,
      grossMarketValueUsd: 0,
      items: [],
    },
    vault: {
      vaultAddress: fallbackMeta.vaultAddress ?? fallbackMeta.rangerVaultPubkey ?? "",
      manager: fallbackMeta.manager ?? fallbackMeta.managerAuthority ?? "",
      admin: fallbackMeta.admin ?? fallbackMeta.adminAuthority ?? "",
      baseAsset: fallbackMeta.baseAsset ?? "USDC",
      lpSymbol: fallbackMeta.lpSymbol ?? "cUSDC",
      protocol: fallbackMeta.protocol ?? "ranger",
      strategy: fallbackMeta.strategy ?? "CARV-1",
      network: fallbackMeta.network ?? "solana-mainnet",
    },
    recentLogs: [],
  });

  if (!telemetry.vault?.vaultAddress && fallbackMeta.rangerVaultPubkey) {
    telemetry.vault.vaultAddress = fallbackMeta.rangerVaultPubkey;
  }

  if (!telemetry.vault?.manager && fallbackMeta.managerAuthority) {
    telemetry.vault.manager = fallbackMeta.managerAuthority;
  }

  if (!telemetry.vault?.admin && fallbackMeta.adminAuthority) {
    telemetry.vault.admin = fallbackMeta.adminAuthority;
  }

  if (!telemetry.vault?.baseAsset && fallbackMeta.baseAsset) {
    telemetry.vault.baseAsset = fallbackMeta.baseAsset;
  }

  return telemetry;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

export function formatPct(value: number): string {
  return `${((value ?? 0) * 100).toFixed(2)}%`;
}

export function shortAddress(value?: string): string {
  if (!value) return "—";
  if (value.length < 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function vaultPublicLink(vaultAddress?: string): string {
  if (!vaultAddress) return "#";
  return `/vault/${vaultAddress}`;
}
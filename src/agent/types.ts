export type AgentRuntimeMode = "safe" | "live";

export type AgentActionType =
  | "boot"
  | "registry_check"
  | "registry_register"
  | "balance_check"
  | "x402_payment"
  | "jupiter_swap"
  | "draft_post"
  | "x_post"
  | "summary"
  | "error"
  | "noop";

export type AgentConfig = {
  agentId: string;
  version: string;
  mode: AgentRuntimeMode;
  persona: {
    publicName: string;
    xHandle?: string;
  };
  runtime: {
    loopIntervalSeconds: number;
  };
  risk: {
    minSolReserve: number;
    maxTradesPerDay: number;
    maxSolPerTrade: number;
    tradeCooldownMinutes: number;
    maxPaymentsPerDay: number;
  };
  registry: {
    enabled: boolean;
  };
  x402: {
    enabled: boolean;
    serverUrl: string;
  };
  jupiter: {
    enabled: boolean;
    solPerTrade: number;
    slippageBps: number;
    cluster: "devnet" | "mainnet-beta";
    execute: boolean;
  };
  xDrafts: {
    enabled: boolean;
    maxDraftsPerDay: number;
  };
  x: {
    enabled: boolean;
    dryRun: boolean;
    maxPostsPerDay: number;
    autoPost: boolean;
  };
};

export type AgentMemory = {
  agentId: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  lastCycleAt?: string;
  lastBalanceCheckAt?: string;
  lastRegistryCheckAt?: string;
  lastRegistryRegisterAt?: string;
  lastX402PaymentAt?: string;
  lastJupiterSwapAt?: string;
  lastDraftAt?: string;
  lastXPostAt?: string;
  counters: {
    cycleCount: number;
    registryChecks: number;
    registryRegistrations: number;
    x402PaymentsAttempted: number;
    x402PaymentsSucceeded: number;
    jupiterSwapsAttempted: number;
    jupiterSwapsSucceeded: number;
    draftsCreated: number;
    xPostsAttempted: number;
    xPostsSucceeded: number;
    errors: number;
  };
  daily: {
    date: string;
    trades: number;
    payments: number;
    drafts: number;
    posts: number;
  };
};

export type AgentReputation = {
  agentId: string;
  updatedAt: string;
  score: number;
  successfulTrades: number;
  successfulPayments: number;
  failedActions: number;
  uptimeCycles: number;
};

export type AgentBalanceSnapshot = {
  sol: number;
  tokenRaw?: string | null;
  tokenUi?: number | null;
  mintAddress?: string | null;
  ata?: string | null;
};

export type AgentActionLogEntry = {
  ts: string;
  agentId: string;
  action: AgentActionType;
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
  signature?: string;
  explorerUrl?: string;
};

export type AgentRuntimeContext = {
  config: AgentConfig;
  rpcUrl: string;
};

export type AgentCycleDecision =
  | { action: "noop"; reason: string }
  | { action: "registry_check"; reason: string }
  | { action: "x402_payment"; reason: string }
  | { action: "jupiter_swap"; reason: string }
  | { action: "draft_post"; reason: string };

export function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createDefaultMemory(params: {
  agentId: string;
  version: string;
}): AgentMemory {
  const now = new Date().toISOString();

  return {
    agentId: params.agentId,
    version: params.version,
    createdAt: now,
    updatedAt: now,
    counters: {
      cycleCount: 0,
      registryChecks: 0,
      registryRegistrations: 0,
      x402PaymentsAttempted: 0,
      x402PaymentsSucceeded: 0,
      jupiterSwapsAttempted: 0,
      jupiterSwapsSucceeded: 0,
      draftsCreated: 0,
      xPostsAttempted: 0,
      xPostsSucceeded: 0,
      errors: 0,
    },
    daily: {
      date: todayUtcDateString(),
      trades: 0,
      payments: 0,
      drafts: 0,
      posts: 0,
    },
  };
}

export function createDefaultReputation(agentId: string): AgentReputation {
  return {
    agentId,
    updatedAt: new Date().toISOString(),
    score: 0,
    successfulTrades: 0,
    successfulPayments: 0,
    failedActions: 0,
    uptimeCycles: 0,
  };
}
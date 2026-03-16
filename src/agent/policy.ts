import {
  type AgentConfig,
  type AgentCycleDecision,
  type AgentMemory,
  todayUtcDateString,
} from "./types";

function minutesSince(iso?: string): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  if (Number.isNaN(then)) return null;
  return (now - then) / 1000 / 60;
}

function resetDailyIfNeeded(memory: AgentMemory): AgentMemory {
  const today = todayUtcDateString();
  if (memory.daily.date === today) return memory;

  return {
    ...memory,
    daily: {
      date: today,
      trades: 0,
      payments: 0,
      drafts: 0,
      posts: 0,
    },
  };
}

export function normalizeMemoryForPolicy(memory: AgentMemory): AgentMemory {
  return resetDailyIfNeeded(memory);
}

export function canAttemptJupiterSwap(params: {
  config: AgentConfig;
  memory: AgentMemory;
  solBalance: number;
}): { ok: boolean; reason: string } {
  const { config, solBalance } = params;
  const memory = normalizeMemoryForPolicy(params.memory);

  if (!config.jupiter.enabled) {
    return { ok: false, reason: "Jupiter disabled in config" };
  }

  if (memory.daily.trades >= config.risk.maxTradesPerDay) {
    return { ok: false, reason: "Daily trade limit reached" };
  }

  const mins = minutesSince(memory.lastJupiterSwapAt);
  if (mins !== null && mins < config.risk.tradeCooldownMinutes) {
    return {
      ok: false,
      reason: `Trade cooldown active (${Math.ceil(config.risk.tradeCooldownMinutes - mins)} min remaining)`,
    };
  }

  const required = config.risk.minSolReserve + config.jupiter.solPerTrade;
  if (solBalance < required) {
    return {
      ok: false,
      reason: `Insufficient SOL for reserve + trade (need at least ${required} SOL)`,
    };
  }

  if (config.jupiter.solPerTrade > config.risk.maxSolPerTrade) {
    return {
      ok: false,
      reason: "Configured Jupiter trade size exceeds maxSolPerTrade risk limit",
    };
  }

  return { ok: true, reason: "Jupiter swap allowed" };
}

export function canAttemptX402Payment(params: {
  config: AgentConfig;
  memory: AgentMemory;
  solBalance: number;
}): { ok: boolean; reason: string } {
  const { config, solBalance } = params;
  const memory = normalizeMemoryForPolicy(params.memory);

  if (!config.x402.enabled) {
    return { ok: false, reason: "x402 disabled in config" };
  }

  if (memory.daily.payments >= config.risk.maxPaymentsPerDay) {
    return { ok: false, reason: "Daily x402 payment limit reached" };
  }

  if (solBalance < config.risk.minSolReserve) {
    return { ok: false, reason: "SOL balance below min reserve" };
  }

  return { ok: true, reason: "x402 payment allowed" };
}

export function canCreateDraft(params: {
  config: AgentConfig;
  memory: AgentMemory;
}): { ok: boolean; reason: string } {
  const { config } = params;
  const memory = normalizeMemoryForPolicy(params.memory);

  if (!config.xDrafts.enabled) {
    return { ok: false, reason: "X drafts disabled in config" };
  }

  if (memory.daily.drafts >= config.xDrafts.maxDraftsPerDay) {
    return { ok: false, reason: "Daily draft limit reached" };
  }

  return { ok: true, reason: "Draft creation allowed" };
}

export function decideNextAction(params: {
  config: AgentConfig;
  memory: AgentMemory;
  registered: boolean;
  solBalance: number;
  preferX402?: boolean;
  preferJupiter?: boolean;
  preferDraft?: boolean;
}): AgentCycleDecision {
  const { config, registered, solBalance } = params;
  const memory = normalizeMemoryForPolicy(params.memory);

  if (config.registry.enabled && !registered) {
    return {
      action: "registry_check",
      reason: "Agent is not yet registered on-chain",
    };
  }

  if (params.preferX402) {
    const x402 = canAttemptX402Payment({ config, memory, solBalance });
    if (x402.ok) {
      return { action: "x402_payment", reason: x402.reason };
    }
  }

  if (params.preferJupiter) {
    const swap = canAttemptJupiterSwap({ config, memory, solBalance });
    if (swap.ok) {
      return { action: "jupiter_swap", reason: swap.reason };
    }
  }

  if (params.preferDraft) {
    const draft = canCreateDraft({ config, memory });
    if (draft.ok) {
      return { action: "draft_post", reason: draft.reason };
    }
  }

  return {
    action: "noop",
    reason: "No eligible action this cycle",
  };
}
import fs from "fs";
import path from "path";
import {
  type AgentMemory,
  createDefaultMemory,
  todayUtcDateString,
} from "./types";

function ensureDir(dirpath: string) {
  if (!fs.existsSync(dirpath)) {
    fs.mkdirSync(dirpath, { recursive: true });
  }
}

function memoryDir(): string {
  return path.resolve(process.cwd(), "memory");
}

function memoryPathForAgent(agentId: string): string {
  return path.join(memoryDir(), `${agentId}-state.json`);
}

export function loadAgentMemory(params: {
  agentId: string;
  version: string;
}): AgentMemory {
  const filepath = memoryPathForAgent(params.agentId);
  ensureDir(memoryDir());

  if (!fs.existsSync(filepath)) {
    const fresh = createDefaultMemory({
      agentId: params.agentId,
      version: params.version,
    });
    saveAgentMemory(fresh);
    return fresh;
  }

  const raw = fs.readFileSync(filepath, "utf8");
  const parsed = JSON.parse(raw) as AgentMemory;

  const next: AgentMemory = {
    ...parsed,
    agentId: parsed.agentId ?? params.agentId,
    version: parsed.version ?? params.version,
    counters: {
      cycleCount: parsed.counters?.cycleCount ?? 0,
      registryChecks: parsed.counters?.registryChecks ?? 0,
      registryRegistrations: parsed.counters?.registryRegistrations ?? 0,
      x402PaymentsAttempted: parsed.counters?.x402PaymentsAttempted ?? 0,
      x402PaymentsSucceeded: parsed.counters?.x402PaymentsSucceeded ?? 0,
      jupiterSwapsAttempted: parsed.counters?.jupiterSwapsAttempted ?? 0,
      jupiterSwapsSucceeded: parsed.counters?.jupiterSwapsSucceeded ?? 0,
      draftsCreated: parsed.counters?.draftsCreated ?? 0,
      xPostsAttempted: parsed.counters?.xPostsAttempted ?? 0,
      xPostsSucceeded: parsed.counters?.xPostsSucceeded ?? 0,
      errors: parsed.counters?.errors ?? 0,
    },
    daily: {
      date: parsed.daily?.date ?? todayUtcDateString(),
      trades: parsed.daily?.trades ?? 0,
      payments: parsed.daily?.payments ?? 0,
      drafts: parsed.daily?.drafts ?? 0,
      posts: parsed.daily?.posts ?? 0,
    },
  };

  return rotateDailyIfNeeded(next);
}

export function saveAgentMemory(memory: AgentMemory): void {
  ensureDir(memoryDir());
  const filepath = memoryPathForAgent(memory.agentId);

  const next: AgentMemory = {
    ...memory,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filepath, JSON.stringify(next, null, 2), "utf8");
}

export function rotateDailyIfNeeded(memory: AgentMemory): AgentMemory {
  const today = todayUtcDateString();
  if (memory.daily.date === today) return memory;

  return {
    ...memory,
    updatedAt: new Date().toISOString(),
    daily: {
      date: today,
      trades: 0,
      payments: 0,
      drafts: 0,
      posts: 0,
    },
  };
}

export function markCycle(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastCycleAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      cycleCount: next.counters.cycleCount + 1,
    },
  };
}

export function markRegistryCheck(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastRegistryCheckAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      registryChecks: next.counters.registryChecks + 1,
    },
  };
}

export function markRegistryRegister(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastRegistryRegisterAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      registryRegistrations: next.counters.registryRegistrations + 1,
    },
  };
}

export function markBalanceCheck(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastBalanceCheckAt: new Date().toISOString(),
  };
}

export function markX402PaymentAttempt(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    counters: {
      ...next.counters,
      x402PaymentsAttempted: next.counters.x402PaymentsAttempted + 1,
    },
  };
}

export function markX402PaymentSuccess(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastX402PaymentAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      x402PaymentsSucceeded: next.counters.x402PaymentsSucceeded + 1,
    },
    daily: {
      ...next.daily,
      payments: next.daily.payments + 1,
    },
  };
}

export function markJupiterSwapAttempt(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    counters: {
      ...next.counters,
      jupiterSwapsAttempted: next.counters.jupiterSwapsAttempted + 1,
    },
  };
}

export function markJupiterSwapSuccess(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastJupiterSwapAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      jupiterSwapsSucceeded: next.counters.jupiterSwapsSucceeded + 1,
    },
    daily: {
      ...next.daily,
      trades: next.daily.trades + 1,
    },
  };
}

export function markDraftCreated(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastDraftAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      draftsCreated: next.counters.draftsCreated + 1,
    },
    daily: {
      ...next.daily,
      drafts: next.daily.drafts + 1,
    },
  };
}

export function markXPostAttempt(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    counters: {
      ...next.counters,
      xPostsAttempted: next.counters.xPostsAttempted + 1,
    },
  };
}

export function markXPostSuccess(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    lastXPostAt: new Date().toISOString(),
    counters: {
      ...next.counters,
      xPostsSucceeded: next.counters.xPostsSucceeded + 1,
    },
    daily: {
      ...next.daily,
      posts: next.daily.posts + 1,
    },
  };
}

export function markError(memory: AgentMemory): AgentMemory {
  const next = rotateDailyIfNeeded(memory);

  return {
    ...next,
    counters: {
      ...next.counters,
      errors: next.counters.errors + 1,
    },
  };
}

export function getAgentMemoryPath(agentId: string): string {
  return memoryPathForAgent(agentId);
}
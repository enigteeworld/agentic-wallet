import fs from "fs";
import path from "path";
import {
  type AgentActionLogEntry,
  type AgentReputation,
  createDefaultReputation,
} from "./types";

function ensureDir(dirpath: string) {
  if (!fs.existsSync(dirpath)) {
    fs.mkdirSync(dirpath, { recursive: true });
  }
}

function reputationDir(): string {
  return path.resolve(process.cwd(), "memory");
}

function reputationPathForAgent(agentId: string): string {
  return path.join(reputationDir(), `${agentId}-reputation.json`);
}

export function loadAgentReputation(agentId: string): AgentReputation {
  ensureDir(reputationDir());
  const filepath = reputationPathForAgent(agentId);

  if (!fs.existsSync(filepath)) {
    const fresh = createDefaultReputation(agentId);
    saveAgentReputation(fresh);
    return fresh;
  }

  const raw = fs.readFileSync(filepath, "utf8");
  return JSON.parse(raw) as AgentReputation;
}

export function saveAgentReputation(reputation: AgentReputation): void {
  ensureDir(reputationDir());
  const filepath = reputationPathForAgent(reputation.agentId);

  const next: AgentReputation = {
    ...reputation,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filepath, JSON.stringify(next, null, 2), "utf8");
}

export function applyActionToReputation(params: {
  reputation: AgentReputation;
  entry: AgentActionLogEntry;
}): AgentReputation {
  const { reputation, entry } = params;

  let score = reputation.score;
  let successfulTrades = reputation.successfulTrades;
  let successfulPayments = reputation.successfulPayments;
  let failedActions = reputation.failedActions;
  let uptimeCycles = reputation.uptimeCycles;

  if (entry.ok && entry.action === "boot") {
    score += 1;
  }

  if (entry.ok && entry.action === "summary") {
    uptimeCycles += 1;
    score += 1;
  }

  if (entry.ok && entry.action === "jupiter_swap") {
    successfulTrades += 1;
    score += 2;
  }

  if (entry.ok && entry.action === "x402_payment") {
    successfulPayments += 1;
    score += 1;
  }

  if (!entry.ok) {
    failedActions += 1;
    score -= 2;
  }

  if (score < 0) {
    score = 0;
  }

  return {
    ...reputation,
    updatedAt: new Date().toISOString(),
    score,
    successfulTrades,
    successfulPayments,
    failedActions,
    uptimeCycles,
  };
}

export function recomputeReputationFromLogs(params: {
  agentId: string;
  entries: AgentActionLogEntry[];
}): AgentReputation {
  let reputation = createDefaultReputation(params.agentId);

  for (const entry of params.entries) {
    reputation = applyActionToReputation({ reputation, entry });
  }

  return reputation;
}

export function getAgentReputationPath(agentId: string): string {
  return reputationPathForAgent(agentId);
}
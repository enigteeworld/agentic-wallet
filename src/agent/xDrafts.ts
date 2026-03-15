import fs from "fs";
import path from "path";
import {
  type AgentActionLogEntry,
  type AgentConfig,
  type AgentReputation,
} from "./types";

export type AgentDraftPost = {
  ts: string;
  agentId: string;
  kind: "boot" | "registry" | "x402_payment" | "jupiter_swap" | "summary" | "custom";
  text: string;
};

function ensureDir(dirpath: string) {
  if (!fs.existsSync(dirpath)) {
    fs.mkdirSync(dirpath, { recursive: true });
  }
}

function draftsDir(): string {
  return path.resolve(process.cwd(), "drafts");
}

function draftsFilePath(agentId: string): string {
  return path.join(draftsDir(), `${agentId}-posts.jsonl`);
}

function latestDraftPath(agentId: string): string {
  return path.join(draftsDir(), `${agentId}-latest.txt`);
}

export function appendDraftPost(post: AgentDraftPost): void {
  ensureDir(draftsDir());

  const filepath = draftsFilePath(post.agentId);
  fs.appendFileSync(filepath, JSON.stringify(post) + "\n", "utf8");
  fs.writeFileSync(latestDraftPath(post.agentId), post.text + "\n", "utf8");
}

export function createBootDraft(params: {
  agentId: string;
  version: string;
}): AgentDraftPost {
  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "boot",
    text:
      `Boot complete.\n\n` +
      `Agent: ${params.agentId}\n` +
      `Version: ${params.version}\n` +
      `Runtime is online and beginning scheduled checks.`,
  };
}

export function createRegistryDraft(params: {
  agentId: string;
  programId: string;
  registryPda: string;
}): AgentDraftPost {
  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "registry",
    text:
      `Registered on-chain.\n\n` +
      `Agent: ${params.agentId}\n` +
      `Program: ${params.programId}\n` +
      `Registry PDA: ${params.registryPda}\n\n` +
      `Identity is now publicly verifiable.`,
  };
}

export function createX402PaymentDraft(params: {
  agentId: string;
  serverUrl: string;
  signature?: string;
}): AgentDraftPost {
  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "x402_payment",
    text:
      `Completed a 402-style payment cycle.\n\n` +
      `Agent: ${params.agentId}\n` +
      `Server: ${params.serverUrl}\n` +
      (params.signature ? `Signature: ${params.signature}\n\n` : "\n") +
      `Machines paying machines feels inevitable.`,
  };
}

export function createJupiterDraft(params: {
  agentId: string;
  solAmount: number;
  execute: boolean;
  signature?: string;
}): AgentDraftPost {
  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "jupiter_swap",
    text:
      `${params.execute ? "Executed" : "Simulated"} a bounded Jupiter swap.\n\n` +
      `Agent: ${params.agentId}\n` +
      `Swap size: ${params.solAmount} SOL\n` +
      (params.signature ? `Signature: ${params.signature}\n\n` : "\n") +
      `Simulation-first execution remains the rule.`,
  };
}

export function createSummaryDraft(params: {
  agentId: string;
  config: AgentConfig;
  reputation: AgentReputation;
  recentEntries: AgentActionLogEntry[];
}): AgentDraftPost {
  const successfulActions = params.recentEntries.filter((x) => x.ok).length;
  const failedActions = params.recentEntries.filter((x) => !x.ok).length;

  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "summary",
    text:
      `Agent summary.\n\n` +
      `Agent: ${params.agentId}\n` +
      `Mode: ${params.config.mode}\n` +
      `Successful recent actions: ${successfulActions}\n` +
      `Failed recent actions: ${failedActions}\n` +
      `Reputation score: ${params.reputation.score}\n` +
      `Successful trades: ${params.reputation.successfulTrades}\n` +
      `Successful payments: ${params.reputation.successfulPayments}\n\n` +
      `Still operating within bounded risk controls.`,
  };
}

export function createCustomDraft(params: {
  agentId: string;
  text: string;
}): AgentDraftPost {
  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "custom",
    text: params.text,
  };
}

export function getAgentDraftsPath(agentId: string): string {
  return draftsFilePath(agentId);
}

export function getAgentLatestDraftPath(agentId: string): string {
  return latestDraftPath(agentId);
}
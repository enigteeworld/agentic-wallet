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

function displayName(config: AgentConfig): string {
  return config.persona.publicName || config.agentId;
}

export function appendDraftPost(post: AgentDraftPost): void {
  ensureDir(draftsDir());

  const filepath = draftsFilePath(post.agentId);
  fs.appendFileSync(filepath, JSON.stringify(post) + "\n", "utf8");
  fs.writeFileSync(latestDraftPath(post.agentId), post.text + "\n", "utf8");
}

export function createBootDraft(params: {
  agentId: string;
  config: AgentConfig;
}): AgentDraftPost {
  const name = displayName(params.config);

  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "boot",
    text:
      `${name} is online.\n\n` +
      `Mode: ${params.config.mode}\n` +
      `Version: ${params.config.version}\n\n` +
      `Autonomous checks have started.`,
  };
}

export function createRegistryDraft(params: {
  agentId: string;
  config: AgentConfig;
  programId: string;
  registryPda: string;
}): AgentDraftPost {
  const name = displayName(params.config);

  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "registry",
    text:
      `${name} is now registered on-chain.\n\n` +
      `Program: ${params.programId}\n` +
      `PDA: ${params.registryPda}\n\n` +
      `Identity is publicly verifiable.`,
  };
}

export function createX402PaymentDraft(params: {
  agentId: string;
  config: AgentConfig;
  serverUrl: string;
  amountSol?: number;
  signature?: string;
  explorerUrl?: string;
}): AgentDraftPost {
  const name = displayName(params.config);
  const amount = typeof params.amountSol === "number"
    ? params.amountSol.toFixed(2)
    : "0.01";

  const proofLine = params.explorerUrl
    ? `Proof: ${params.explorerUrl}\n\n`
    : "";

  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "x402_payment",
    text:
      `${name} executed an on-chain payment.\n\n` +
      `${amount} SOL sent.\n` +
      `Status: verified\n\n` +
      proofLine +
      `Machines paying machines.`,
  };
}

export function createJupiterDraft(params: {
  agentId: string;
  config: AgentConfig;
  solAmount: number;
  execute: boolean;
  signature?: string;
  explorerUrl?: string;
}): AgentDraftPost {
  const name = displayName(params.config);
  const status = params.execute ? "executed" : "simulated";
  const proofLine = params.explorerUrl
    ? `Proof: ${params.explorerUrl}\n\n`
    : "";

  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "jupiter_swap",
    text:
      `${name} ${status} a Jupiter swap.\n\n` +
      `Size: ${params.solAmount} SOL\n\n` +
      proofLine +
      `Bounded execution on Solana.`,
  };
}

export function createSummaryDraft(params: {
  agentId: string;
  config: AgentConfig;
  reputation: AgentReputation;
  recentEntries: AgentActionLogEntry[];
}): AgentDraftPost {
  const successfulActions = params.recentEntries.filter((x) => x.ok).length;
  const name = displayName(params.config);

  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    kind: "summary",
    text:
      `${name} update.\n\n` +
      `Recent successes: ${successfulActions}\n` +
      `Reputation: ${params.reputation.score}\n` +
      `Trades: ${params.reputation.successfulTrades}\n` +
      `Payments: ${params.reputation.successfulPayments}\n\n` +
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
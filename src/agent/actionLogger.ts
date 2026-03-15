import fs from "fs";
import path from "path";
import { type AgentActionLogEntry } from "./types";

function ensureDir(dirpath: string) {
  if (!fs.existsSync(dirpath)) {
    fs.mkdirSync(dirpath, { recursive: true });
  }
}

function logsDir(): string {
  return path.resolve(process.cwd(), "logs");
}

function logFilePath(agentId: string): string {
  return path.join(logsDir(), `${agentId}-actions.log`);
}

export function appendActionLog(entry: AgentActionLogEntry): void {
  ensureDir(logsDir());

  const filepath = logFilePath(entry.agentId);
  const line = JSON.stringify(entry);

  fs.appendFileSync(filepath, line + "\n", "utf8");
}

export function createActionLog(params: {
  agentId: string;
  action: AgentActionLogEntry["action"];
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
  signature?: string;
  explorerUrl?: string;
}): AgentActionLogEntry {
  return {
    ts: new Date().toISOString(),
    agentId: params.agentId,
    action: params.action,
    ok: params.ok,
    reason: params.reason,
    details: params.details,
    signature: params.signature,
    explorerUrl: params.explorerUrl,
  };
}

export function logInfo(params: {
  agentId: string;
  action: AgentActionLogEntry["action"];
  reason?: string;
  details?: Record<string, unknown>;
}): void {
  const entry = createActionLog({
    agentId: params.agentId,
    action: params.action,
    ok: true,
    reason: params.reason,
    details: params.details,
  });

  appendActionLog(entry);
}

export function logError(params: {
  agentId: string;
  action: AgentActionLogEntry["action"];
  reason: string;
  details?: Record<string, unknown>;
}): void {
  const entry = createActionLog({
    agentId: params.agentId,
    action: params.action,
    ok: false,
    reason: params.reason,
    details: params.details,
  });

  appendActionLog(entry);
}

export function getAgentLogPath(agentId: string): string {
  return logFilePath(agentId);
}
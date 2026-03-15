import fs from "fs";
import path from "path";
import { type AgentConfig } from "./types";

function configPathForAgent(agentId: string): string {
  return path.resolve(process.cwd(), "config", `${agentId}.json`);
}

export function getAgentConfigPath(agentId: string): string {
  return configPathForAgent(agentId);
}

export function loadAgentConfig(params: {
  agentId: string;
  forceLive?: boolean;
}): AgentConfig {
  const filepath = configPathForAgent(params.agentId);

  if (!fs.existsSync(filepath)) {
    throw new Error(
      `Missing agent config at ${filepath}. Create config/${params.agentId}.json first.`
    );
  }

  const raw = fs.readFileSync(filepath, "utf8");
  const parsed = JSON.parse(raw) as AgentConfig;

  if (parsed.agentId !== params.agentId) {
    throw new Error(
      `Agent config mismatch: expected agentId=${params.agentId}, found ${parsed.agentId}`
    );
  }

  if (params.forceLive) {
    return {
      ...parsed,
      mode: "live",
    };
  }

  return parsed;
}
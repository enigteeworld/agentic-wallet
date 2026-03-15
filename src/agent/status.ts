import fs from "fs";
import { Connection } from "@solana/web3.js";
import { WalletManager } from "../wallet/walletManager";
import { isAgentRegistered } from "../registry/agentRegistry";
import { loadAgentMemory } from "./memory";
import { loadAgentReputation } from "./reputation";
import { loadAgentConfig, getAgentConfigPath } from "./config";
import { getAgentLogPath } from "./actionLogger";
import { getAgentLatestDraftPath } from "./xDrafts";

export type AgentStatus = {
  agentId: string;
  wallet: string;
  rpcUrl: string;
  configPath: string;
  logPath: string;
  latestDraftPath: string;
  registered: boolean;
  registryPda: string;
  programId: string;
  solBalance: number;
  configMode: string;
  version: string;
  memory: ReturnType<typeof loadAgentMemory>;
  reputation: ReturnType<typeof loadAgentReputation>;
};

export async function getAgentStatus(params: {
  agentId: string;
  rpcUrl: string;
}): Promise<AgentStatus> {
  const config = loadAgentConfig({ agentId: params.agentId });
  const connection = new Connection(params.rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);
  const agentKeypair = walletManager.loadOrCreateEncryptedKeypairOrThrow(params.agentId);

  const [solLamports, registryStatus] = await Promise.all([
    connection.getBalance(agentKeypair.publicKey, "confirmed"),
    isAgentRegistered({
      connection,
      agent: agentKeypair.publicKey,
    }),
  ]);

  const memory = loadAgentMemory({
    agentId: params.agentId,
    version: config.version,
  });

  const reputation = loadAgentReputation(params.agentId);

  return {
    agentId: params.agentId,
    wallet: agentKeypair.publicKey.toBase58(),
    rpcUrl: params.rpcUrl,
    configPath: getAgentConfigPath(params.agentId),
    logPath: getAgentLogPath(params.agentId),
    latestDraftPath: getAgentLatestDraftPath(params.agentId),
    registered: registryStatus.registered,
    registryPda: registryStatus.registry.toBase58(),
    programId: registryStatus.programId.toBase58(),
    solBalance: solLamports / 1_000_000_000,
    configMode: config.mode,
    version: config.version,
    memory,
    reputation,
  };
}

export function agentStatusFilesExist(agentId: string): {
  logExists: boolean;
  latestDraftExists: boolean;
} {
  return {
    logExists: fs.existsSync(getAgentLogPath(agentId)),
    latestDraftExists: fs.existsSync(getAgentLatestDraftPath(agentId)),
  };
}
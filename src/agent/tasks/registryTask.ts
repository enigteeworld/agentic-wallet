import { Connection } from "@solana/web3.js";
import { WalletManager } from "../../wallet/walletManager";
import {
  isAgentRegistered,
  registerAgentOnChain,
} from "../../registry/agentRegistry";
import { loadAgentConfig } from "../config";
import {
  loadAgentMemory,
  markRegistryCheck,
  markRegistryRegister,
  saveAgentMemory,
} from "../memory";
import { appendDraftPost, createRegistryDraft } from "../xDrafts";
import { appendActionLog, createActionLog } from "../actionLogger";

export type RegistryTaskResult =
  | {
      ok: true;
      registered: boolean;
      alreadyRegistered: boolean;
      registryPda: string;
      programId: string;
      signature?: string;
      explorerUrl?: string;
    }
  | {
      ok: false;
      error: string;
    };

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export async function runRegistryTask(params: {
  rpcUrl: string;
  agentId: string;
  version: string;
}): Promise<RegistryTaskResult> {
  const { rpcUrl, agentId, version } = params;

  try {
    const config = loadAgentConfig({ agentId });
    const connection = new Connection(rpcUrl, "confirmed");
    const walletManager = new WalletManager(connection);
    const agentKeypair = walletManager.loadOrCreateEncryptedKeypairOrThrow(agentId);

    let memory = loadAgentMemory({ agentId, version });

    const status = await isAgentRegistered({
      connection,
      agent: agentKeypair.publicKey,
    });

    memory = markRegistryCheck(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "registry_check",
        ok: true,
        reason: status.registered
          ? "Agent already registered"
          : "Agent not yet registered",
        details: {
          registryPda: status.registry.toBase58(),
          programId: status.programId.toBase58(),
        },
      })
    );

    if (status.registered) {
      return {
        ok: true,
        registered: true,
        alreadyRegistered: true,
        registryPda: status.registry.toBase58(),
        programId: status.programId.toBase58(),
      };
    }

    const result = await registerAgentOnChain({
      connection,
      agentKeypair,
      agentId,
      version,
    });

    memory = markRegistryRegister(memory);
    saveAgentMemory(memory);

    const explorerUrl = explorerTxUrl(result.signature);

    appendActionLog(
      createActionLog({
        agentId,
        action: "registry_register",
        ok: true,
        reason: "Agent registered successfully on-chain",
        details: {
          registryPda: result.registry.toBase58(),
          programId: result.programId.toBase58(),
        },
        signature: result.signature,
        explorerUrl,
      })
    );

    appendDraftPost(
      createRegistryDraft({
        agentId,
        config,
        programId: result.programId.toBase58(),
        registryPda: result.registry.toBase58(),
      })
    );

    return {
      ok: true,
      registered: true,
      alreadyRegistered: false,
      registryPda: result.registry.toBase58(),
      programId: result.programId.toBase58(),
      signature: result.signature,
      explorerUrl,
    };
  } catch (error: any) {
    appendActionLog(
      createActionLog({
        agentId,
        action: "registry_register",
        ok: false,
        reason: String(error?.message ?? error),
      })
    );

    return {
      ok: false,
      error: String(error?.message ?? error),
    };
  }
}
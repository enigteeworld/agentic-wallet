import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletManager } from "../wallet/walletManager";
import { SplTokenService } from "../token/splTokenService";
import { StateStore } from "../state/stateStore";
import { loadAgentConfig } from "./config";
import {
  type AgentActionLogEntry,
  type AgentReputation,
} from "./types";
import {
  decideNextAction,
  normalizeMemoryForPolicy,
} from "./policy";
import {
  loadAgentMemory,
  markBalanceCheck,
  markCycle,
  markDraftCreated,
  markError,
  saveAgentMemory,
} from "./memory";
import {
  appendActionLog,
  createActionLog,
  getAgentLogPath,
} from "./actionLogger";
import {
  appendDraftPost,
  createBootDraft,
  createSummaryDraft,
} from "./xDrafts";
import {
  loadAgentReputation,
  recomputeReputationFromLogs,
  saveAgentReputation,
} from "./reputation";
import { runRegistryTask } from "./tasks/registryTask";
import { runX402Task } from "./tasks/x402Task";
import { runJupiterTask } from "./tasks/jupiterTask";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRecentActionLogs(agentId: string, limit = 50): AgentActionLogEntry[] {
  const filepath = getAgentLogPath(agentId);
  if (!fs.existsSync(filepath)) return [];

  const lines = fs
    .readFileSync(filepath, "utf8")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  return lines
    .slice(-limit)
    .map((line) => JSON.parse(line) as AgentActionLogEntry);
}

async function readBalances(params: {
  rpcUrl: string;
  agentId: string;
}): Promise<{
  sol: number;
  mintAddress: string | null;
  ata: string | null;
  tokenRaw: string | null;
  tokenUi: number | null;
}> {
  const connection = new Connection(params.rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);
  const tokenService = new SplTokenService(connection);
  const stateStore = new StateStore();

  const kp = walletManager.loadOrCreateEncryptedKeypairOrThrow(params.agentId);
  const solLamports = await connection.getBalance(kp.publicKey, "confirmed");
  const sol = solLamports / 1_000_000_000;

  const state = stateStore.load();
  const mintAddress = state.mint?.address ?? null;
  const decimals = state.mint?.decimals ?? 6;
  const ata = state.atas?.[params.agentId] ?? null;

  let tokenRaw: string | null = null;
  let tokenUi: number | null = null;

  if (ata) {
    try {
      const amt = await tokenService.getTokenAccountAmountRaw({
        ata: new PublicKey(ata),
      });
      tokenRaw = amt.toString();
      tokenUi = Number(amt) / 10 ** decimals;
    } catch {
      tokenRaw = null;
      tokenUi = null;
    }
  }

  return {
    sol,
    mintAddress,
    ata,
    tokenRaw,
    tokenUi,
  };
}

function saveReputationFromLogs(agentId: string): AgentReputation {
  const entries = readRecentActionLogs(agentId, 5000);
  const reputation = recomputeReputationFromLogs({ agentId, entries });
  saveAgentReputation(reputation);
  return reputation;
}

export async function runAgentRuntime(params: {
  agentId: string;
  rpcUrl: string;
  live?: boolean;
}): Promise<void> {
  const config = loadAgentConfig({
    agentId: params.agentId,
    forceLive: params.live,
  });

  appendActionLog(
    createActionLog({
      agentId: params.agentId,
      action: "boot",
      ok: true,
      reason: "Agent runtime booted",
      details: {
        mode: config.mode,
        version: config.version,
        rpcUrl: params.rpcUrl,
      },
    })
  );

  appendDraftPost(
    createBootDraft({
      agentId: params.agentId,
      version: config.version,
    })
  );

  console.log(`\n🤖 Agent runtime started`);
  console.log(`Agent:   ${params.agentId}`);
  console.log(`Mode:    ${config.mode}`);
  console.log(`Version: ${config.version}`);
  console.log(`RPC:     ${params.rpcUrl}`);
  console.log(`Loop:    every ${config.runtime.loopIntervalSeconds}s`);

  while (true) {
    let memory = loadAgentMemory({
      agentId: params.agentId,
      version: config.version,
    });

    try {
      memory = markCycle(memory);
      saveAgentMemory(memory);

      const balances = await readBalances({
        rpcUrl: params.rpcUrl,
        agentId: params.agentId,
      });

      memory = markBalanceCheck(memory);
      saveAgentMemory(memory);

      console.log(
        `\n[cycle ${memory.counters.cycleCount}] SOL=${balances.sol.toFixed(4)} TOKEN=${
          balances.tokenUi ?? "—"
        }`
      );

      const registryResult = await runRegistryTask({
        rpcUrl: params.rpcUrl,
        agentId: params.agentId,
        version: config.version,
      });

      const registered = registryResult.ok ? registryResult.registered : false;

      memory = loadAgentMemory({
        agentId: params.agentId,
        version: config.version,
      });

      memory = normalizeMemoryForPolicy(memory);
      saveAgentMemory(memory);

      const decision = decideNextAction({
        config,
        memory,
        registered,
        solBalance: balances.sol,
        preferX402: memory.counters.cycleCount % 2 === 1,
        preferJupiter: memory.counters.cycleCount % 2 === 0,
        preferDraft: true,
      });

      console.log(`Decision: ${decision.action} — ${decision.reason}`);

      if (decision.action === "x402_payment") {
        await runX402Task({
          agentId: params.agentId,
          version: config.version,
          serverUrl: config.x402.serverUrl,
        });
      } else if (decision.action === "jupiter_swap") {
        await runJupiterTask({
          agentId: params.agentId,
          version: config.version,
          solAmount: config.jupiter.solPerTrade,
          slippageBps: config.jupiter.slippageBps,
          cluster: config.jupiter.cluster,
          execute: config.jupiter.execute && config.mode === "live",
        });
      } else if (decision.action === "draft_post") {
        const recentEntries = readRecentActionLogs(params.agentId, 25);
        const currentReputation = loadAgentReputation(params.agentId);

        appendDraftPost(
          createSummaryDraft({
            agentId: params.agentId,
            config,
            reputation: currentReputation,
            recentEntries,
          })
        );

        memory = loadAgentMemory({
          agentId: params.agentId,
          version: config.version,
        });
        memory = markDraftCreated(memory);
        saveAgentMemory(memory);

        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "draft_post",
            ok: true,
            reason: "Created summary draft",
          })
        );
      } else {
        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "noop",
            ok: true,
            reason: decision.reason,
          })
        );
      }

      const reputation = saveReputationFromLogs(params.agentId);

      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "summary",
          ok: true,
          reason: "Cycle summary written",
          details: {
            reputationScore: reputation.score,
            successfulTrades: reputation.successfulTrades,
            successfulPayments: reputation.successfulPayments,
            failedActions: reputation.failedActions,
          },
        })
      );
    } catch (error: any) {
      memory = loadAgentMemory({
        agentId: params.agentId,
        version: config.version,
      });
      memory = markError(memory);
      saveAgentMemory(memory);

      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "error",
          ok: false,
          reason: String(error?.message ?? error),
        })
      );

      saveReputationFromLogs(params.agentId);

      console.error(`Runtime cycle error: ${String(error?.message ?? error)}`);
    }

    await sleep(config.runtime.loopIntervalSeconds * 1000);
  }
}
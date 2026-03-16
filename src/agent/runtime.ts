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
import { postLatestDraft } from "./xPoster";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

function color(text: string, ...styles: string[]): string {
  return `${styles.join("")}${text}${ansi.reset}`;
}

function line(char = "─", width = 72): string {
  return char.repeat(width);
}

function banner(title: string): string {
  return color(`┌${line("─", 70)}┐`, ansi.magenta) +
    `\n` +
    color(`│ ${title.padEnd(68, " ")} │`, ansi.magenta, ansi.bold) +
    `\n` +
    color(`└${line("─", 70)}┘`, ansi.magenta);
}

function section(text: string): string {
  return color(text, ansi.cyan, ansi.bold);
}

function success(text: string): string {
  return color(text, ansi.green, ansi.bold);
}

function warn(text: string): string {
  return color(text, ansi.yellow, ansi.bold);
}

function errText(text: string): string {
  return color(text, ansi.red, ansi.bold);
}

function subtle(text: string): string {
  return color(text, ansi.gray);
}

function value(text: string): string {
  return color(text, ansi.white);
}

function keyValue(label: string, val: string): string {
  return `${subtle(label)} ${value(val)}`;
}

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
  const sol = solLamports / 1000000000;

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

async function maybeAutoPost(params: {
  agentId: string;
  enabled: boolean;
  reason: string;
}): Promise<void> {
  if (!params.enabled) return;

  const result = await postLatestDraft({ agentId: params.agentId });

  if (result.ok) {
    console.log(success(`Auto-post check complete (${params.reason})`));
    console.log(keyValue("Dry run: ", result.dryRun ? "yes" : "no"));
    console.log(keyValue("Posted:  ", result.posted ? "yes" : "no"));
    if (result.tweetId) {
      console.log(keyValue("Tweet ID:", result.tweetId));
    }
  } else {
    console.log(errText(`Auto-post failed: ${result.error}`));
  }
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
      config,
    })
  );

  console.log("");
  console.log(banner("AGENT RUNTIME ONLINE"));
  console.log(keyValue("Agent:   ", params.agentId));
  console.log(keyValue("Public:  ", config.persona.publicName));
  console.log(keyValue("Mode:    ", config.mode));
  console.log(keyValue("Version: ", config.version));
  console.log(keyValue("RPC:     ", params.rpcUrl));
  console.log(keyValue("Loop:    ", `every ${config.runtime.loopIntervalSeconds}s`));
  console.log(color(line("─", 72), ansi.gray));

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

      console.log("");
      console.log(banner(`CYCLE ${memory.counters.cycleCount}`));
      console.log(
        keyValue(
          "Balances:",
          `SOL=${balances.sol.toFixed(4)} | TOKEN=${balances.tokenUi ?? "—"}`
        )
      );
      if (balances.mintAddress) {
        console.log(keyValue("Mint:    ", balances.mintAddress));
      }
      if (balances.ata) {
        console.log(keyValue("ATA:     ", balances.ata));
      }
      console.log("");

      console.log(section("Registry check"));
      const registryResult = await runRegistryTask({
        rpcUrl: params.rpcUrl,
        agentId: params.agentId,
        version: config.version,
      });

      const registered = registryResult.ok ? registryResult.registered : false;

      if (registryResult.ok) {
        console.log(
          `${success("Registry status:")} ${registered ? value("registered") : warn("not registered")}`
        );
        if (registryResult.registryPda) {
          console.log(keyValue("Registry: ", registryResult.registryPda));
        }
      } else {
        console.log(`${errText("Registry error:")} ${registryResult.error}`);
      }

      if (
        registryResult.ok &&
        !registryResult.alreadyRegistered &&
        config.x.autoPost
      ) {
        await maybeAutoPost({
          agentId: params.agentId,
          enabled: true,
          reason: "registry registration",
        });
      }

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

      console.log("");
      console.log(section("Policy decision"));
      console.log(`${subtle("Action:")} ${value(decision.action)}`);
      console.log(`${subtle("Reason:")} ${value(decision.reason)}`);
      console.log(color(line("─", 72), ansi.gray));

      if (decision.action === "x402_payment") {
        const paymentResult = await runX402Task({
          agentId: params.agentId,
          version: config.version,
          serverUrl: config.x402.serverUrl,
        });

        if (paymentResult.ok) {
          console.log(success("x402 payment task completed"));
          if (paymentResult.signature) {
            console.log(keyValue("Signature:", paymentResult.signature));
          }
          if (paymentResult.explorerUrl) {
            console.log(keyValue("Proof:    ", paymentResult.explorerUrl));
          }

          if (config.x.autoPost) {
            await maybeAutoPost({
              agentId: params.agentId,
              enabled: true,
              reason: "x402 payment",
            });
          }
        } else {
          console.log(errText(`x402 payment task failed: ${paymentResult.error}`));
        }
      } else if (decision.action === "jupiter_swap") {
        const swapResult = await runJupiterTask({
          agentId: params.agentId,
          version: config.version,
          solAmount: config.jupiter.solPerTrade,
          slippageBps: config.jupiter.slippageBps,
          cluster: config.jupiter.cluster,
          execute: config.jupiter.execute && config.mode === "live",
        });

        if (swapResult.ok) {
          console.log(success("Jupiter task completed"));
          if (swapResult.signature) {
            console.log(keyValue("Signature:", swapResult.signature));
          }

          if (config.x.autoPost) {
            await maybeAutoPost({
              agentId: params.agentId,
              enabled: true,
              reason: "jupiter swap",
            });
          }
        } else {
          console.log(errText(`Jupiter task failed: ${swapResult.error}`));
        }
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

        console.log(success("Summary draft created"));

        if (config.x.autoPost) {
          await maybeAutoPost({
            agentId: params.agentId,
            enabled: true,
            reason: "summary draft",
          });
        }
      } else {
        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "noop",
            ok: true,
            reason: decision.reason,
          })
        );

        console.log(warn("No action executed this cycle"));
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

      console.log("");
      console.log(section("Cycle summary"));
      console.log(keyValue("Reputation:", String(reputation.score)));
      console.log(keyValue("Trades:    ", String(reputation.successfulTrades)));
      console.log(keyValue("Payments:  ", String(reputation.successfulPayments)));
      console.log(keyValue("Failures:  ", String(reputation.failedActions)));
      console.log(color(line("─", 72), ansi.gray));
      console.log(subtle(`Sleeping ${config.runtime.loopIntervalSeconds}s until next cycle...`));
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

      console.log("");
      console.log(errText("Runtime cycle error"));
      console.log(color(String(error?.message ?? error), ansi.red));
      console.log(color(line("─", 72), ansi.gray));
    }

    await sleep(config.runtime.loopIntervalSeconds * 1000);
  }
}
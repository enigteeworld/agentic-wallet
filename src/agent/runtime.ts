import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletManager } from "../wallet/walletManager";
import { SplTokenService } from "../token/splTokenService";
import { StateStore } from "../state/stateStore";
import { executeStrategyIntent } from "../strategy/execution/executor";
import { fetchVaultPrices } from "../strategy/market/prices";
import { generateIntent } from "../strategy/engine";
import { validateIntent } from "../strategy/risk";
import {
  type BalanceSnapshot,
  type PositionRecord,
  type StrategyConfig,
  type StrategyContext,
  type TradeRecord,
} from "../strategy/types";
import { RangerVaultAdapter } from "../vault/adapter";
import { loadAgentConfig } from "./config";
import {
  type AgentActionLogEntry,
  type AgentConfig,
  type AgentReputation,
  type StrategyRuntimeConfig,
  type VaultConfig,
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
import {
  updateAccountingFromExecution,
  loadAccountingState,
} from "./tasks/accounting";
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

const MIN_NAV_USD_TO_EXECUTE = 5;
const MIN_TRADE_NOTIONAL_USD = 0.2;

type VaultRuntimeResolvedConfig = {
  enabled: boolean;
  vaultId: string;
  source: "local" | "ranger";
  rangerVaultPubkey?: string;
  managerAuthority?: string;
  adminAuthority?: string;
  assetMint?: string;
  listed: boolean;
  strategyId: string;
  baseAsset: string;
  allowedAssets: string[];
  minUsdcReservePct: number;
  maxPositionPct: number;
  maxTradePct: number;
  maxConcurrentPositions: number;
  minConfidence: number;
  cooldownMinutes: number;
  maxDailyTrades: number;
  softDrawdownPct: number;
  hardDrawdownPct: number;
  maxSlippageBps: number;
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
    .map((logLine) => JSON.parse(logLine) as AgentActionLogEntry);
}

function resolveVaultRuntimeConfig(config: AgentConfig): VaultRuntimeResolvedConfig {
  const vault: VaultConfig | undefined = config.vault;
  const strategy: StrategyRuntimeConfig | undefined = config.strategy;

  const enabled =
    vault?.enabled === true ||
    strategy?.mode === "vault";

  const rawAssetMint = (vault as any)?.assetMint as string | undefined;
  const strategyBaseAsset = strategy?.baseAsset ?? "USDC";
  const inferredAssetMint =
    strategyBaseAsset.toUpperCase() === "USDC"
      ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      : undefined;

  return {
    enabled,
    vaultId: vault?.vaultId ?? "ranger-vault-001",
    source: vault?.source ?? "local",
    rangerVaultPubkey: vault?.rangerVaultPubkey,
    managerAuthority: vault?.managerAuthority,
    adminAuthority: vault?.adminAuthority,
    assetMint: rawAssetMint ?? inferredAssetMint,
    listed: vault?.listed ?? false,
    strategyId: strategy?.strategyId ?? "carv-1",
    baseAsset: strategyBaseAsset,
    allowedAssets: strategy?.allowedAssets ?? ["SOL", "JUP"],
    minUsdcReservePct: strategy?.minUsdcReservePct ?? 0.4,
    maxPositionPct: strategy?.maxPositionPct ?? 0.25,
    maxTradePct: strategy?.maxTradePct ?? 0.1,
    maxConcurrentPositions: strategy?.maxConcurrentPositions ?? 2,
    minConfidence: strategy?.minConfidence ?? 0.65,
    cooldownMinutes: strategy?.cooldownMinutes ?? 360,
    maxDailyTrades: strategy?.maxDailyTrades ?? 4,
    softDrawdownPct: strategy?.softDrawdownPct ?? 0.05,
    hardDrawdownPct: strategy?.hardDrawdownPct ?? 0.08,
    maxSlippageBps: strategy?.maxSlippageBps ?? 50,
  };
}

function toStrategyConfig(
  resolved: VaultRuntimeResolvedConfig
): StrategyConfig {
  return {
    mode: "vault",
    strategyId: resolved.strategyId,
    vaultId: resolved.vaultId,
    baseAssetMint: resolved.baseAsset,
    allowedAssets: resolved.allowedAssets,
    minUsdcReservePct: resolved.minUsdcReservePct,
    maxPositionPct: resolved.maxPositionPct,
    maxTradePct: resolved.maxTradePct,
    maxConcurrentPositions: resolved.maxConcurrentPositions,
    minConfidence: resolved.minConfidence,
    cooldownMinutes: resolved.cooldownMinutes,
    maxDailyTrades: resolved.maxDailyTrades,
    softDrawdownPct: resolved.softDrawdownPct,
    hardDrawdownPct: resolved.hardDrawdownPct,
    maxSlippageBps: resolved.maxSlippageBps,
  };
}

function buildStrategyBalances(params: {
  balances: {
    sol: number;
    mintAddress: string | null;
    ata: string | null;
    tokenRaw: string | null;
    tokenUi: number | null;
  };
}): BalanceSnapshot[] {
  const result: BalanceSnapshot[] = [
    {
      mint: "SOL",
      symbol: "SOL",
      amount: params.balances.sol,
      valueUsd: 0,
    },
  ];

  if (params.balances.tokenUi !== null && params.balances.tokenUi !== undefined) {
    result.push({
      mint: params.balances.mintAddress ?? "TOKEN",
      symbol: "TOKEN",
      amount: params.balances.tokenUi,
      valueUsd: 0,
    });
  }

  return result;
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

async function runVaultCycle(params: {
  agentId: string;
  rpcUrl: string;
  config: AgentConfig;
  balances: {
    sol: number;
    mintAddress: string | null;
    ata: string | null;
    tokenRaw: string | null;
    tokenUi: number | null;
  };
  cycleCount: number;
}): Promise<void> {
  const vaultConfig = resolveVaultRuntimeConfig(params.config);
  const strategyConfig = toStrategyConfig(vaultConfig);

  const vaultAdapter = new RangerVaultAdapter({
    agentId: params.agentId,
    vaultId: vaultConfig.vaultId,
    baseAssetMint: vaultConfig.assetMint ?? vaultConfig.baseAsset,
    minReservePct: vaultConfig.minUsdcReservePct,
    source: vaultConfig.source,
    rangerVaultPubkey: vaultConfig.rangerVaultPubkey,
    managerAuthority: vaultConfig.managerAuthority,
    adminAuthority: vaultConfig.adminAuthority,
    listed: vaultConfig.listed,
    rpcUrl: params.rpcUrl,
  });

  const vaultIdentity = await vaultAdapter.getVaultIdentity();
  const vaultState = await vaultAdapter.getVaultState();
  const accountingState = loadAccountingState(params.agentId);

  const strategyBalances = buildStrategyBalances({
    balances: params.balances,
  });

  const prices = await fetchVaultPrices([
    vaultConfig.baseAsset,
    ...vaultConfig.allowedAssets,
  ]);

  const recentTrades: TradeRecord[] = accountingState.trades;
  const openPositions: PositionRecord[] = accountingState.positions;

  const context: StrategyContext = {
    agentId: params.agentId,
    vault: vaultState,
    balances: strategyBalances,
    prices,
    recentTrades,
    openPositions,
    now: new Date().toISOString(),
    config: strategyConfig,
  };

  const intent = await generateIntent(context);

  const navUsd = Number(vaultState.totalValueUsd ?? 0);
  if (navUsd < MIN_NAV_USD_TO_EXECUTE) {
    intent.action = "HOLD";
    intent.reason = "NAV below execution threshold";
  }

  const policyDecision = validateIntent(intent, context);

  console.log(section("Vault identity"));
  console.log(keyValue("Source:    ", vaultIdentity.source));
  console.log(keyValue("Vault ID:  ", vaultIdentity.vaultId));
  console.log(keyValue("Base:      ", vaultIdentity.baseAssetMint));
  console.log(keyValue("Listed:    ", vaultIdentity.listed ? "yes" : "no"));
  if (vaultIdentity.rangerVaultPubkey) {
    console.log(keyValue("Ranger PK: ", vaultIdentity.rangerVaultPubkey));
  }
  if (vaultIdentity.managerAuthority) {
    console.log(keyValue("Manager:   ", vaultIdentity.managerAuthority));
  }
  if (vaultIdentity.adminAuthority) {
    console.log(keyValue("Admin:     ", vaultIdentity.adminAuthority));
  }
  console.log("");

  console.log(section("Vault strategy"));
  console.log(keyValue("Strategy: ", vaultConfig.strategyId));
  console.log(keyValue("Vault ID: ", vaultConfig.vaultId));
  console.log(keyValue("Base:     ", vaultConfig.baseAsset));
  if (vaultConfig.assetMint) {
    console.log(keyValue("Mint:     ", vaultConfig.assetMint));
  }
  console.log(keyValue("Universe: ", vaultConfig.allowedAssets.join(", ")));
  console.log(keyValue("Reserve:  ", `${(vaultConfig.minUsdcReservePct * 100).toFixed(0)}%`));
  console.log(keyValue("Max pos:  ", `${(vaultConfig.maxPositionPct * 100).toFixed(0)}%`));
  console.log(keyValue("Max trade:", `${(vaultConfig.maxTradePct * 100).toFixed(0)}%`));
  console.log(keyValue("Cooldown: ", `${vaultConfig.cooldownMinutes}m`));
  console.log(keyValue("Max/day:  ", String(vaultConfig.maxDailyTrades)));
  console.log(keyValue("Soft DD:  ", `${(vaultConfig.softDrawdownPct * 100).toFixed(1)}%`));
  console.log(keyValue("Hard DD:  ", `${(vaultConfig.hardDrawdownPct * 100).toFixed(1)}%`));
  console.log(keyValue("Slippage: ", `${vaultConfig.maxSlippageBps} bps`));
  console.log(keyValue("Min NAV:  ", `${MIN_NAV_USD_TO_EXECUTE} USD`));
  console.log(keyValue("Min exec: ", `${MIN_TRADE_NOTIONAL_USD} USD`));
  console.log("");

  console.log(section("Vault state"));
  console.log(keyValue("NAV USD:      ", String(vaultState.totalValueUsd)));
  console.log(keyValue("Available USD:", String(vaultState.availableCapitalUsd)));
  console.log(keyValue("Drawdown:     ", `${(vaultState.drawdownPct * 100).toFixed(2)}%`));
  console.log(keyValue("Positions:    ", String(openPositions.length)));
  console.log(keyValue("Recent trades:", String(recentTrades.length)));
  console.log(keyValue("Updated:      ", vaultState.lastSyncAt));
  console.log("");

  console.log(section("Market snapshot"));
  console.log(keyValue("USDC: ", String(prices.USDC ?? 1)));
  console.log(keyValue("SOL:  ", prices.SOL !== undefined ? String(prices.SOL) : "—"));
  console.log(keyValue("JUP:  ", prices.JUP !== undefined ? String(prices.JUP) : "—"));
  console.log("");

  console.log(section("Strategy decision"));
  console.log(keyValue("Action:    ", intent.action));
  console.log(keyValue("Reason:    ", intent.reason));
  console.log(keyValue("Confidence:", intent.confidence.toFixed(2)));
  console.log(
    keyValue(
      "Notional:  ",
      intent.targetNotionalUsd !== undefined
        ? String(intent.targetNotionalUsd)
        : "—"
    )
  );
  console.log(keyValue("Approved:  ", policyDecision.approved ? "yes" : "no"));
  if (policyDecision.violations?.length) {
    console.log(keyValue("Violations:", policyDecision.violations.join(", ")));
  }
  console.log("");

  appendActionLog(
    createActionLog({
      agentId: params.agentId,
      action: "vault_cycle",
      ok: true,
      reason: "Vault strategy cycle executed",
      details: {
        rpcUrl: params.rpcUrl,
        cycleCount: params.cycleCount,
        vaultIdentity,
        strategyId: vaultConfig.strategyId,
        vaultId: vaultConfig.vaultId,
        baseAsset: vaultConfig.baseAsset,
        assetMint: vaultConfig.assetMint,
        allowedAssets: vaultConfig.allowedAssets,
        balances: {
          sol: params.balances.sol,
          mintAddress: params.balances.mintAddress,
          ata: params.balances.ata,
          tokenRaw: params.balances.tokenRaw,
          tokenUi: params.balances.tokenUi,
        },
        vaultState,
        strategyContext: {
          balances: strategyBalances,
          prices,
          recentTradesCount: recentTrades.length,
          openPositionsCount: openPositions.length,
        },
        intent,
        policyDecision,
      },
    })
  );

  if (intent.action === "HOLD") {
    if (intent.reason === "NAV below execution threshold") {
      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "vault_skip_execution",
          ok: true,
          reason: `NAV too small for execution (${navUsd.toFixed(4)} < ${MIN_NAV_USD_TO_EXECUTE})`,
          details: {
            navUsd,
            minNavUsdToExecute: MIN_NAV_USD_TO_EXECUTE,
            targetNotionalUsd: Number(intent.targetNotionalUsd ?? 0),
            intent,
          },
        })
      );

      console.log(warn(`Vault execution skipped: NAV too small for execution (${navUsd.toFixed(4)} < ${MIN_NAV_USD_TO_EXECUTE})`));
      return;
    }

    console.log(warn("Vault strategy is holding"));
    return;
  }

  if (!policyDecision.approved) {
    console.log(warn("Vault intent rejected by policy"));
    return;
  }

  const targetNotionalUsd = Number(intent.targetNotionalUsd ?? 0);

  if (targetNotionalUsd < MIN_TRADE_NOTIONAL_USD) {
    const reason = `Trade notional too small (${targetNotionalUsd.toFixed(6)} < ${MIN_TRADE_NOTIONAL_USD})`;

    appendActionLog(
      createActionLog({
        agentId: params.agentId,
        action: "vault_skip_execution",
        ok: true,
        reason,
        details: {
          navUsd,
          targetNotionalUsd,
          minTradeNotionalUsd: MIN_TRADE_NOTIONAL_USD,
          intent,
        },
      })
    );

    console.log(warn(`Vault execution skipped: ${reason}`));
    return;
  }

  const execution = await executeStrategyIntent({
    agentId: params.agentId,
    version: params.config.version,
    intent,
    context,
    cluster: params.config.jupiter.cluster,
    execute: params.config.jupiter.execute && params.config.mode === "live",
    maxSlippageBps: vaultConfig.maxSlippageBps,
  });

  if (!execution.ok) {
    console.log(errText(`Vault execution failed: ${execution.error}`));
    return;
  }

  const accounting = updateAccountingFromExecution({
    agentId: params.agentId,
    execution: execution.executionResult,
    vaultState,
    prices,
    reason: intent.reason,
    side: intent.action === "SELL" ? "SELL" : "BUY",
  });

  await vaultAdapter.recordExecution(execution.executionResult);

  console.log(success("Vault intent executed and recorded"));
  console.log(keyValue("Signature: ", execution.executionResult.txSignature ?? "—"));
  console.log(keyValue("Input:     ", execution.inputSymbol));
  console.log(keyValue("Output:    ", execution.outputSymbol));
  console.log(keyValue("Exec UI:   ", String(execution.executionAmountUi)));
  console.log(keyValue("Trades:    ", String(accounting.trades.length)));
  console.log(keyValue("Positions: ", String(accounting.positions.length)));
  console.log(keyValue("Realized:  ", String(accounting.realizedPnlUsd)));

  if (params.config.x.autoPost) {
    await maybeAutoPost({
      agentId: params.agentId,
      enabled: true,
      reason: "vault strategy execution",
    });
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

  const vaultConfig = resolveVaultRuntimeConfig(config);

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
        vaultEnabled: vaultConfig.enabled,
        vaultId: vaultConfig.vaultId,
        vaultSource: vaultConfig.source,
        rangerVaultPubkey: vaultConfig.rangerVaultPubkey,
        strategyId: vaultConfig.strategyId,
        assetMint: vaultConfig.assetMint,
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
  console.log(keyValue("Mode:    ", String(config.mode)));
  console.log(keyValue("Version: ", String(config.version)));
  console.log(keyValue("RPC:     ", params.rpcUrl));
  console.log(keyValue("Loop:    ", `every ${config.runtime.loopIntervalSeconds}s`));

  if (vaultConfig.enabled) {
    console.log(keyValue("Vault:   ", "enabled"));
    console.log(keyValue("Source:  ", vaultConfig.source));
    console.log(keyValue("Strategy:", vaultConfig.strategyId));
    console.log(keyValue("Vault ID:", vaultConfig.vaultId));
    if (vaultConfig.assetMint) {
      console.log(keyValue("Mint:    ", vaultConfig.assetMint));
    }
    if (vaultConfig.rangerVaultPubkey) {
      console.log(keyValue("Ranger:  ", vaultConfig.rangerVaultPubkey));
    }
  } else {
    console.log(keyValue("Vault:   ", "disabled"));
  }

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

      if (vaultConfig.enabled) {
        await runVaultCycle({
          agentId: params.agentId,
          rpcUrl: params.rpcUrl,
          config,
          balances,
          cycleCount: memory.counters.cycleCount,
        });

        const reputation = saveReputationFromLogs(params.agentId);

        appendActionLog(
          createActionLog({
            agentId: params.agentId,
            action: "summary",
            ok: true,
            reason: "Vault cycle summary written",
            details: {
              vaultEnabled: true,
              vaultSource: vaultConfig.source,
              rangerVaultPubkey: vaultConfig.rangerVaultPubkey,
              strategyId: vaultConfig.strategyId,
              vaultId: vaultConfig.vaultId,
              assetMint: vaultConfig.assetMint,
              reputationScore: reputation.score,
              successfulTrades: reputation.successfulTrades,
              successfulPayments: reputation.successfulPayments,
              failedActions: reputation.failedActions,
            },
          })
        );

        console.log("");
        console.log(section("Cycle summary"));
        console.log(keyValue("Vault:     ", "enabled"));
        console.log(keyValue("Source:    ", vaultConfig.source));
        console.log(keyValue("Strategy:  ", vaultConfig.strategyId));
        console.log(keyValue("Reputation:", String(reputation.score)));
        console.log(keyValue("Trades:    ", String(reputation.successfulTrades)));
        console.log(keyValue("Payments:  ", String(reputation.successfulPayments)));
        console.log(keyValue("Failures:  ", String(reputation.failedActions)));
        console.log(color(line("─", 72), ansi.gray));
        console.log(subtle(`Sleeping ${config.runtime.loopIntervalSeconds}s until next cycle...`));

        await sleep(config.runtime.loopIntervalSeconds * 1000);
        continue;
      }

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
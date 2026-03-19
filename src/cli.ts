import "dotenv/config";
import { Command } from "commander";
import { Connection } from "@solana/web3.js";
import { runStep3 } from "./demos/step3";
import { runStep4 } from "./demos/step4";
import { runStep5 } from "./demos/step5";
import { runStep6 } from "./demos/step6";
import { runX402Client } from "./addons/x402/client";
import { WalletManager } from "./wallet/walletManager";
import { isAgentRegistered, registerAgentOnChain } from "./registry/agentRegistry";
import { runAgentRuntime } from "./agent/runtime";
import { getAgentStatus, agentStatusFilesExist } from "./agent/status";
import { postLatestDraft, postTextToX } from "./agent/xPoster";
import { appendDraftPost, createCustomDraft } from "./agent/xDrafts";
import {
  buildAgentTelemetry,
  buildTelemetrySummaryText,
  writeAgentTelemetryArtifacts,
} from "./telemetry/report";
import { serveTelemetry } from "./telemetry/server";
import { depositToVault } from "./vault/deposit";
import { withdrawFromVault } from "./vault/withdraw";

const program = new Command();

function resolveRpcUrl(override?: string): string {
  if (override) return override;
  const envRpc = process.env.RPC_URL;
  if (envRpc) return envRpc;
  throw new Error("Missing RPC URL. Provide --rpc <url> or set RPC_URL in .env");
}

program
  .name("agentic-wallet")
  .description("Agentic Wallet demos and agent runtime")
  .option("--rpc <url>", "Override RPC URL (otherwise uses .env RPC_URL)");

program
  .command("step3")
  .description("Auto-sign SOL transfer agent-001 -> agent-002")
  .option("--amount <sol>", "Amount of SOL to transfer", "0.05")
  .action(async (opts) => {
    const rpcUrl = program.opts().rpc as string | undefined;
    await runStep3({ rpcUrl, amountSol: Number(opts.amount) });
  });

program
  .command("step4")
  .description("Create SPL mint, mint tokens, transfer tokens agent-001 -> agent-002")
  .action(async () => {
    const rpcUrl = program.opts().rpc as string | undefined;
    await runStep4({ rpcUrl });
  });

program
  .command("step5")
  .description("Run AgentBrain policy using persisted state (keystore/state.json)")
  .action(async () => {
    const rpcUrl = program.opts().rpc as string | undefined;
    await runStep5({ rpcUrl });
  });

program
  .command("step6")
  .description("Run multi-agent harness (creates N agents + autonomous token transfers)")
  .option("--agents <n>", "Number of agents", "5")
  .option("--rounds <n>", "Number of rounds", "3")
  .option("--seed <n>", "Seed tokens per agent if balance is 0", "25")
  .action(async (opts) => {
    const rpcUrl = program.opts().rpc as string | undefined;
    await runStep6({
      rpcUrl,
      agents: Number(opts.agents),
      rounds: Number(opts.rounds),
      seed: Number(opts.seed),
    });
  });

program
  .command("x402:server")
  .description("Run x402-style payment server (HTTP 402 -> on-chain pay -> verify -> serve)")
  .action(async () => {
    console.log("Run with: ts-node src/addons/x402/server.ts");
    console.log("Tip: use npm run x402:server");
  });

program
  .command("x402:client")
  .description("Run x402-style payment client (agent pays then retries request)")
  .option("--server <url>", "Server URL", "http://localhost:8787")
  .option("--agent <id>", "Agent ID", "agent-001")
  .action(async (opts) => {
    await runX402Client({ serverUrl: opts.server, agentId: opts.agent });
  });

program
  .command("vault:deposit")
  .description("Deposit asset tokens into a Ranger vault and receive LP tokens")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .requiredOption("--amount <uiAmount>", "Deposit amount in UI units (e.g. 5 or 0.94)")
  .option(
    "--mint <pubkey>",
    "Override vault asset mint (otherwise uses config.vault.assetMint or inferred USDC)",
  )
  .action(async (opts) => {
    const rpcUrl = resolveRpcUrl(program.opts().rpc as string | undefined);

    await depositToVault({
      agentId: String(opts.agent),
      rpcUrl,
      amountUi: String(opts.amount),
      vaultAssetMint: opts.mint ? String(opts.mint) : undefined,
    });
  });

program
  .command("vault:withdraw")
  .description("Withdraw asset tokens from a Ranger vault by burning LP tokens")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .requiredOption("--amount <uiAmount>", "Withdraw amount in asset UI units (e.g. 5 or 0.5)")
  .option(
    "--mint <pubkey>",
    "Override vault asset mint (otherwise uses config.vault.assetMint or inferred USDC)",
  )
  .action(async (opts) => {
    const rpcUrl = resolveRpcUrl(program.opts().rpc as string | undefined);

    await withdrawFromVault({
      agentId: String(opts.agent),
      rpcUrl,
      amountUi: String(opts.amount),
      vaultAssetMint: opts.mint ? String(opts.mint) : undefined,
    });
  });

program
  .command("registry:status")
  .description("Check if an agent has an on-chain registry PDA")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .action(async (opts) => {
    const rpcUrl = resolveRpcUrl(program.opts().rpc as string | undefined);
    const connection = new Connection(rpcUrl, "confirmed");
    const walletManager = new WalletManager(connection);
    const kp = walletManager.loadOrCreateEncryptedKeypairOrThrow(opts.agent);
    const out = await isAgentRegistered({ connection, agent: kp.publicKey });

    console.log("\n-- Agent Registry Status");
    console.log(`RPC:     ${rpcUrl}`);
    console.log(`Program: ${out.programId.toBase58()}`);
    console.log(`Agent:   ${kp.publicKey.toBase58()}`);
    console.log(`PDA:     ${out.registry.toBase58()}`);
    console.log(`Status:  ${out.registered ? "registered" : "not registered"}`);
  });

program
  .command("registry:register")
  .description("Register an agent on-chain (creates PDA + stores agentId/version)")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .requiredOption("--agentId <string>", "Agent identifier to store on-chain (e.g. agent-001)")
  .requiredOption("--version <string>", "Version string (e.g. 0.1.0)")
  .action(async (opts) => {
    const rpcUrl = resolveRpcUrl(program.opts().rpc as string | undefined);
    const connection = new Connection(rpcUrl, "confirmed");
    const walletManager = new WalletManager(connection);
    const kp = walletManager.loadOrCreateEncryptedKeypairOrThrow(opts.agent);

    const res = await registerAgentOnChain({
      connection,
      agentKeypair: kp,
      agentId: String(opts.agentId),
      version: String(opts.version),
    });

    console.log("\nRegistered on-chain");
    console.log(`RPC:      ${rpcUrl}`);
    console.log(`Program:  ${res.programId.toBase58()}`);
    console.log(`Agent:    ${kp.publicKey.toBase58()}`);
    console.log(`PDA:      ${res.registry.toBase58()}`);
    console.log(`Sig:      ${res.signature}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${res.signature}`);
  });

program
  .command("agent:run")
  .description("Run the always-on agent runtime loop")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .option("--live", "Force live mode (overrides config mode=safe)", false)
  .action(async (opts) => {
    const rpcUrl = resolveRpcUrl(program.opts().rpc as string | undefined);
    await runAgentRuntime({
      agentId: String(opts.agent),
      rpcUrl,
      live: Boolean(opts.live),
    });
  });

program
  .command("agent:status")
  .description("Show status for the always-on agent")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .action(async (opts) => {
    const rpcUrl = resolveRpcUrl(program.opts().rpc as string | undefined);
    const status = await getAgentStatus({
      agentId: String(opts.agent),
      rpcUrl,
    });
    const files = agentStatusFilesExist(String(opts.agent));

    console.log("\n-- Agent Runtime Status");
    console.log(`Agent:          ${status.agentId}`);
    console.log(`Wallet:         ${status.wallet}`);
    console.log(`RPC:            ${status.rpcUrl}`);
    console.log(`Mode:           ${status.configMode}`);
    console.log(`Version:        ${status.version}`);
    console.log(`SOL Balance:    ${status.solBalance}`);
    console.log(`Registered:     ${status.registered ? "yes" : "no"}`);
    console.log(`Registry PDA:   ${status.registryPda}`);
    console.log(`Program ID:     ${status.programId}`);
    console.log(`Config Path:    ${status.configPath}`);
    console.log(`Log Path:       ${status.logPath} ${files.logExists ? "[ok]" : "[missing]"}`);
    console.log(`Latest Draft:   ${status.latestDraftPath} ${files.latestDraftExists ? "[ok]" : "[missing]"}`);
    console.log(`Cycles:         ${status.memory.counters.cycleCount}`);
    console.log(`Trade Success:  ${status.memory.counters.jupiterSwapsSucceeded}`);
    console.log(`Pay Success:    ${status.memory.counters.x402PaymentsSucceeded}`);
    console.log(`Drafts Created: ${status.memory.counters.draftsCreated}`);
    console.log(`X Posts:        ${status.memory.counters.xPostsSucceeded}`);
    console.log(`Errors:         ${status.memory.counters.errors}`);
    console.log(`Reputation:     ${status.reputation.score}`);
  });

program
  .command("agent:post-latest")
  .description("Post the latest generated draft to X (safe mode supported)")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .action(async (opts) => {
    const result = await postLatestDraft({
      agentId: String(opts.agent),
    });

    if (!result.ok) {
      console.error("\nX post failed");
      console.error(result.error);
      process.exit(1);
    }

    console.log("\nX post layer executed");
    console.log(`Dry run: ${result.dryRun ? "yes" : "no"}`);
    console.log(`Posted:  ${result.posted ? "yes" : "no"}`);
    if (result.tweetId) {
      console.log(`Tweet ID: ${result.tweetId}`);
    }
    console.log("\nText:\n");
    console.log(result.text);
  });

program
  .command("telemetry:build")
  .description("Build telemetry JSON + HTML dashboard artifacts for an agent")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .action(async (opts) => {
    const agentId = String(opts.agent);
    const telemetry = buildAgentTelemetry(agentId);
    const out = writeAgentTelemetryArtifacts(telemetry);

    console.log("\nTelemetry artifacts built");
    console.log(`Agent:      ${agentId}`);
    console.log(`Root dir:   ${out.rootDir}`);
    console.log(`Dashboard:  ${out.dashboardPath}`);
    console.log(`Trades:     ${out.tradesPath}`);
    console.log(`Reputation: ${out.reputationPath}`);
    console.log(`JSON:       ${out.jsonPath}`);
  });

program
  .command("telemetry:serve")
  .description("Serve generated telemetry pages locally")
  .option("--port <n>", "Port to serve on", "8080")
  .action(async (opts) => {
    const port = Number(opts.port);
    await serveTelemetry({ port });
  });

program
  .command("agent:draft-report")
  .description("Build a telemetry summary and save it as the latest X draft")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .action(async (opts) => {
    const agentId = String(opts.agent);
    const text = buildTelemetrySummaryText(agentId);

    appendDraftPost(
      createCustomDraft({
        agentId,
        text,
      })
    );

    console.log("\nTelemetry summary drafted");
    console.log(text);
  });

program
  .command("agent:post-report")
  .description("Build a telemetry summary and post it to X")
  .requiredOption("--agent <id>", "Agent keystore id (e.g. agent-001)")
  .action(async (opts) => {
    const agentId = String(opts.agent);
    const text = buildTelemetrySummaryText(agentId);

    appendDraftPost(
      createCustomDraft({
        agentId,
        text,
      })
    );

    const result = await postTextToX({
      agentId,
      text,
    });

    if (!result.ok) {
      console.error("\nReport post failed");
      console.error(result.error);
      process.exit(1);
    }

    console.log("\nReport post executed");
    console.log(`Dry run: ${result.dryRun ? "yes" : "no"}`);
    console.log(`Posted:  ${result.posted ? "yes" : "no"}`);
    if (result.tweetId) {
      console.log(`Tweet ID: ${result.tweetId}`);
    }
    console.log("\nText:\n");
    console.log(result.text);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("CLI fatal error:", err);
  process.exit(1);
});
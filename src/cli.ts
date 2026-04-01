import "dotenv/config";
import { Command } from "commander";
import { Connection } from "@solana/web3.js";
import { runStep3 } from "./demos/step3";
import { runStep4 } from "./demos/step4";
import { runStep5 } from "./demos/step5";
import { runStep6 } from "./demos/step6";
import { runX402Client } from "./addons/x402/client";
import { WalletManager } from "./wallet/walletManager";
import {
  isAgentRegistered,
  registerAgentOnChain,
} from "./registry/agentRegistry";
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
import { createManagedStrategyRuntime } from "./strategy/managed";
import {
  getManagedOverviewStatus,
  getManagedPositionsStatus,
  getManagedTradesStatus,
  getManagedWalletPositionStatus,
} from "./strategy/managed/status";

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
    "Override vault asset mint (otherwise uses config.vault.assetMint or inferred USDC)"
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
    "Override vault asset mint (otherwise uses config.vault.assetMint or inferred USDC)"
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

// =============================
// MANAGED STRATEGY COMMANDS
// =============================

program
  .command("managed:overview")
  .description("Show managed strategy overview")
  .requiredOption("--agent <id>", "Agent id")
  .action(async (opts) => {
    const overview = getManagedOverviewStatus();

    console.log("\n-- Managed Strategy Overview");
    console.log(`Agent:                  ${String(opts.agent)}`);
    console.log(`Total Users:            ${overview.totalUsers}`);
    console.log(`Total Deposited:        ${overview.totalDeposited}`);
    console.log(`Total Withdrawn:        ${overview.totalWithdrawn}`);
    console.log(`Total Shares:           ${overview.totalShares}`);
    console.log(`Total Value:            ${overview.totalValue}`);
    console.log(`Liquid Value:           ${overview.liquidValue}`);
    console.log(`Invested Value:         ${overview.investedValue}`);
    console.log(`Reserved Withdrawals:   ${overview.reservedForWithdrawals}`);
    console.log(`Share Price:            ${overview.sharePrice}`);
    console.log(`Pending Withdrawal Amt: ${overview.pendingWithdrawalAmount}`);
    console.log(`Pending Withdrawal Cnt: ${overview.pendingWithdrawalCount}`);
    console.log(`Updated At:             ${overview.updatedAt}`);
  });

program
  .command("managed:positions")
  .description("Show managed market positions")
  .requiredOption("--agent <id>", "Agent id")
  .action(async (opts) => {
    const rows = getManagedPositionsStatus(String(opts.agent));

    console.log("\n-- Managed Market Positions");

    if (rows.length === 0) {
      console.log("No managed positions found.");
      return;
    }

    rows.forEach((row, index) => {
      console.log(`\n[${index + 1}] ${row.symbol}`);
      console.log(`Mint:             ${row.mint}`);
      console.log(`Quantity:         ${row.quantity}`);
      console.log(`Avg Entry USD:    ${row.avgEntryPriceUsd}`);
      console.log(`Current Price USD:${row.currentPriceUsd}`);
      console.log(`Market Value USD: ${row.marketValueUsd}`);
      console.log(`Unrealized PnL:   ${row.unrealizedPnlUsd}`);
      console.log(`Updated At:       ${row.updatedAt}`);
    });
  });

program
  .command("managed:trades")
  .description("Show recent managed market trades")
  .requiredOption("--agent <id>", "Agent id")
  .option("--limit <n>", "Number of recent trades", "10")
  .action(async (opts) => {
    const rows = getManagedTradesStatus(String(opts.agent), Number(opts.limit));

    console.log("\n-- Managed Market Trades");

    if (rows.length === 0) {
      console.log("No managed trades found.");
      return;
    }

    rows.forEach((row, index) => {
      console.log(`\n[${index + 1}] ${row.side} ${row.outputMint}`);
      console.log(`ID:               ${row.id}`);
      console.log(`Timestamp:        ${row.timestamp}`);
      console.log(`Input Mint:       ${row.inputMint}`);
      console.log(`Output Mint:      ${row.outputMint}`);
      console.log(`Input Amount:     ${row.inputAmount}`);
      console.log(`Output Amount:    ${row.outputAmount}`);
      console.log(`Execution USD:    ${row.executionPriceUsd}`);
      console.log(`Fees USD:         ${row.feesUsd}`);
      console.log(`Slippage Bps:     ${row.slippageBps}`);
      console.log(`Tx Signature:     ${row.txSignature}`);
      console.log(`Reason:           ${row.strategyReason}`);
      console.log(`Realized PnL USD: ${row.realizedPnlUsd ?? 0}`);
    });
  });

program
  .command("managed:position")
  .description("Show a wallet's managed strategy position")
  .requiredOption("--agent <id>", "Agent id")
  .requiredOption("--wallet <address>", "User wallet address")
  .action(async (opts) => {
    const position = getManagedWalletPositionStatus(String(opts.wallet));

    if (!position) {
      console.log(`No managed position found for wallet ${opts.wallet}`);
      return;
    }

    console.log("\n-- Managed Strategy Position");
    console.log(`Agent:                  ${String(opts.agent)}`);
    console.log(`Wallet:                 ${position.wallet}`);
    console.log(`Shares:                 ${position.shares}`);
    console.log(`Share Price:            ${position.sharePrice}`);
    console.log(`Current Value:          ${position.currentValue}`);
    console.log(`Total Deposited:        ${position.totalDeposited}`);
    console.log(`Total Withdrawn:        ${position.totalWithdrawn}`);
    console.log(`Net Deposited:          ${position.netDeposited}`);
    console.log(`PnL Absolute:           ${position.pnlAbsolute}`);
    console.log(`PnL Percent:            ${position.pnlPercent}%`);
    console.log(`Pending Withdrawal Amt: ${position.pendingWithdrawalAmount}`);
    console.log(`Pending Withdrawal Shr: ${position.pendingWithdrawalShares}`);
    console.log(`Created At:             ${position.createdAt ?? "-"}`);
    console.log(`Updated At:             ${position.updatedAt ?? "-"}`);
  });

program
  .command("managed:deposit")
  .description("Register a managed strategy deposit for a wallet")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--wallet <address>", "User wallet address")
  .requiredOption("--amount <uiAmount>", "Deposit amount in UI units")
  .option("--tx <hash>", "Deposit transaction hash")
  .option("--notes <text>", "Optional notes")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.registerDeposit({
      wallet: String(opts.wallet),
      amount: Number(opts.amount),
      txHash: opts.tx ? String(opts.tx) : undefined,
      notes: opts.notes ? String(opts.notes) : undefined,
    });

    console.log("\n-- Managed Deposit Registered");
    console.log(`Wallet:                ${result.wallet}`);
    console.log(`Amount:                ${result.amount}`);
    console.log(`Minted Shares:         ${result.mintedShares}`);
    console.log(`Share Price:           ${result.sharePrice}`);
    console.log(`User Total Shares:     ${result.totalUserShares}`);
    console.log(`Strategy Total Shares: ${result.totalStrategyShares}`);
    console.log(`Strategy Total Value:  ${result.totalStrategyValue}`);
    console.log(`Liquid Value:          ${result.liquidValue}`);
    console.log(`Invested Value:        ${result.investedValue}`);
    console.log(`Tx Hash:               ${result.txHash ?? "-"}`);
    console.log(`Notes:                 ${result.notes ?? "-"}`);
    console.log(`Created At:            ${result.createdAt}`);
  });

program
  .command("managed:withdraw")
  .description("Request a managed strategy withdrawal by amount")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--wallet <address>", "User wallet address")
  .requiredOption("--amount <uiAmount>", "Withdrawal amount in UI units")
  .option("--destination <address>", "Destination wallet (defaults to source wallet)")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.requestWithdrawalByAmount({
      wallet: String(opts.wallet),
      amount: Number(opts.amount),
      destinationWallet: opts.destination ? String(opts.destination) : undefined,
    });

    console.log("\n-- Managed Withdrawal Requested");
    console.log(`Request ID:           ${result.request.id}`);
    console.log(`Wallet:               ${result.request.wallet}`);
    console.log(`Destination Wallet:   ${result.request.destinationWallet}`);
    console.log(`Requested Amount:     ${result.request.requestedAmount ?? "-"}`);
    console.log(`Reserved Amount:      ${result.request.reservedAmount}`);
    console.log(`Reserved Shares:      ${result.request.reservedShares}`);
    console.log(`Status:               ${result.request.status}`);
    console.log(`Reserved Withdrawals: ${result.reservedForWithdrawals}`);
    console.log(`Liquid Value:         ${result.liquidValue}`);
    console.log(`Invested Value:       ${result.investedValue}`);
    console.log(`Total Strategy Value: ${result.totalStrategyValue}`);
    console.log(`Created At:           ${result.request.createdAt}`);
  });

program
  .command("managed:withdraw-shares")
  .description("Request a managed strategy withdrawal by shares")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--wallet <address>", "User wallet address")
  .requiredOption("--shares <amount>", "Number of shares to redeem")
  .option("--destination <address>", "Destination wallet (defaults to source wallet)")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.requestWithdrawalByShares({
      wallet: String(opts.wallet),
      shares: Number(opts.shares),
      destinationWallet: opts.destination ? String(opts.destination) : undefined,
    });

    console.log("\n-- Managed Withdrawal Requested By Shares");
    console.log(`Request ID:           ${result.request.id}`);
    console.log(`Wallet:               ${result.request.wallet}`);
    console.log(`Destination Wallet:   ${result.request.destinationWallet}`);
    console.log(`Requested Shares:     ${result.request.requestedShares ?? "-"}`);
    console.log(`Reserved Amount:      ${result.request.reservedAmount}`);
    console.log(`Reserved Shares:      ${result.request.reservedShares}`);
    console.log(`Status:               ${result.request.status}`);
    console.log(`Reserved Withdrawals: ${result.reservedForWithdrawals}`);
    console.log(`Liquid Value:         ${result.liquidValue}`);
    console.log(`Invested Value:       ${result.investedValue}`);
    console.log(`Total Strategy Value: ${result.totalStrategyValue}`);
    console.log(`Created At:           ${result.request.createdAt}`);
  });

program
  .command("managed:withdraw-complete")
  .description("Complete a managed withdrawal request after funds are sent/unwound")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--request <id>", "Withdrawal request id")
  .option("--tx <hash>", "Withdrawal transaction hash")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.completeWithdrawal({
      requestId: String(opts.request),
      txHash: opts.tx ? String(opts.tx) : undefined,
    });

    console.log("\n-- Managed Withdrawal Completed");
    console.log(`Request ID:         ${result.id}`);
    console.log(`Wallet:             ${result.wallet}`);
    console.log(`Destination Wallet: ${result.destinationWallet}`);
    console.log(`Reserved Amount:    ${result.reservedAmount}`);
    console.log(`Reserved Shares:    ${result.reservedShares}`);
    console.log(`Status:             ${result.status}`);
    console.log(`Tx Hash:            ${result.txHash ?? "-"}`);
    console.log(`Updated At:         ${result.updatedAt}`);
  });

program
  .command("managed:withdraw-reject")
  .description("Reject a managed withdrawal request")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--request <id>", "Withdrawal request id")
  .requiredOption("--reason <text>", "Reason for rejection")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.rejectWithdrawal(
      String(opts.request),
      String(opts.reason)
    );

    console.log("\n-- Managed Withdrawal Rejected");
    console.log(`Request ID:         ${result.id}`);
    console.log(`Wallet:             ${result.wallet}`);
    console.log(`Destination Wallet: ${result.destinationWallet}`);
    console.log(`Status:             ${result.status}`);
    console.log(`Reason:             ${result.reason ?? "-"}`);
    console.log(`Updated At:         ${result.updatedAt}`);
  });

program
  .command("managed:deploy")
  .description("Move capital from liquid to invested")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--amount <uiAmount>", "Amount to deploy")
  .option("--reason <text>", "Optional reason")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.deployCapital({
      amount: Number(opts.amount),
      reason: opts.reason ? String(opts.reason) : undefined,
    });

    console.log("\n-- Managed Capital Deployed");
    console.log(`Total Value:            ${result.totalValue}`);
    console.log(`Liquid Value:           ${result.liquidValue}`);
    console.log(`Invested Value:         ${result.investedValue}`);
    console.log(`Reserved Withdrawals:   ${result.reservedForWithdrawals}`);
    console.log(`Share Price:            ${result.sharePrice}`);
    console.log(`Reason:                 ${result.reason ?? "-"}`);
    console.log(`Updated At:             ${result.updatedAt}`);
  });

program
  .command("managed:return")
  .description("Move capital from invested back to liquid")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--amount <uiAmount>", "Amount to return")
  .option("--reason <text>", "Optional reason")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.returnCapital({
      amount: Number(opts.amount),
      reason: opts.reason ? String(opts.reason) : undefined,
    });

    console.log("\n-- Managed Capital Returned");
    console.log(`Total Value:            ${result.totalValue}`);
    console.log(`Liquid Value:           ${result.liquidValue}`);
    console.log(`Invested Value:         ${result.investedValue}`);
    console.log(`Reserved Withdrawals:   ${result.reservedForWithdrawals}`);
    console.log(`Share Price:            ${result.sharePrice}`);
    console.log(`Reason:                 ${result.reason ?? "-"}`);
    console.log(`Updated At:             ${result.updatedAt}`);
  });

program
  .command("managed:reconcile")
  .description("Reconcile managed NAV from actual runtime balances")
  .requiredOption("--agent <id>", "Agent id (currently informational)")
  .requiredOption("--liquid <uiAmount>", "Actual liquid value")
  .requiredOption("--invested <uiAmount>", "Actual invested value")
  .option("--reserved <uiAmount>", "Reserved withdrawals amount", "0")
  .option("--source <name>", "Source label for reconciliation")
  .option("--notes <text>", "Optional notes")
  .action(async (opts) => {
    const runtime = createManagedStrategyRuntime();

    const result = runtime.reconcileNav({
      liquidValue: Number(opts.liquid),
      investedValue: Number(opts.invested),
      reservedForWithdrawals: Number(opts.reserved),
      source: opts.source ? String(opts.source) : undefined,
      notes: opts.notes ? String(opts.notes) : undefined,
    });

    console.log("\n-- Managed NAV Reconciled");
    console.log(`Previous Total Value:          ${result.previousTotalValue}`);
    console.log(`Next Total Value:              ${result.nextTotalValue}`);
    console.log(`Previous Liquid Value:         ${result.previousLiquidValue}`);
    console.log(`Next Liquid Value:             ${result.nextLiquidValue}`);
    console.log(`Previous Invested Value:       ${result.previousInvestedValue}`);
    console.log(`Next Invested Value:           ${result.nextInvestedValue}`);
    console.log(`Previous Reserved Withdrawals: ${result.previousReservedForWithdrawals}`);
    console.log(`Next Reserved Withdrawals:     ${result.nextReservedForWithdrawals}`);
    console.log(`PnL Delta:                     ${result.pnlDelta}`);
    console.log(`Share Price:                   ${result.sharePrice}`);
    console.log(`Source:                        ${result.source ?? "-"}`);
    console.log(`Notes:                         ${result.notes ?? "-"}`);
    console.log(`Updated At:                    ${result.updatedAt}`);
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
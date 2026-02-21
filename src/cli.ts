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

const program = new Command();

function resolveRpcUrl(override?: string): string {
  // Prefer CLI override
  if (override) return override;

  // Then .env RPC_URL
  const envRpc = process.env.RPC_URL;
  if (envRpc) return envRpc;

  // If your project has a failover list elsewhere, keep this strict for now:
  throw new Error("Missing RPC URL. Provide --rpc <url> or set RPC_URL in .env");
}

program
  .name("agentic-wallet")
  .description("Agentic Wallet demos (devnet)")
  .option("--rpc <url>", "Override RPC URL (otherwise uses .env RPC_URL)");

program
  .command("step3")
  .description("Auto-sign SOL transfer agent-001 → agent-002")
  .option("--amount <sol>", "Amount of SOL to transfer", "0.05")
  .action(async (opts) => {
    const rpcUrl = program.opts().rpc as string | undefined;
    await runStep3({ rpcUrl, amountSol: Number(opts.amount) });
  });

program
  .command("step4")
  .description("Create SPL mint, mint tokens, transfer tokens agent-001 → agent-002")
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

/**
 * =========================
 * Agent Registry (On-chain)
 * =========================
 *
 * Commands:
 *   npm run dev -- registry:status   --agent agent-001
 *   npm run dev -- registry:register --agent agent-001 --agentId agent-001 --version 0.1.0
 */

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

    console.log("\n— Agent Registry Status");
    console.log(`RPC:     ${rpcUrl}`);
    console.log(`Program: ${out.programId.toBase58()}`);
    console.log(`Agent:   ${kp.publicKey.toBase58()}`);
    console.log(`PDA:     ${out.registry.toBase58()}`);
    console.log(`Status:  ${out.registered ? "✅ Registered" : "❌ Not registered"}`);
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

    console.log("\n✅ Registered on-chain");
    console.log(`RPC:     ${rpcUrl}`);
    console.log(`Program: ${res.programId.toBase58()}`);
    console.log(`Agent:   ${kp.publicKey.toBase58()}`);
    console.log(`PDA:     ${res.registry.toBase58()}`);
    console.log(`Sig:     ${res.signature}`);
    console.log(`Explorer: https://explorer.solana.com/tx/${res.signature}?cluster=devnet`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error("CLI fatal error:", err);
  process.exit(1);
});
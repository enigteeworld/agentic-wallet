import "dotenv/config";
import { Command } from "commander";
import { runStep3 } from "./demos/step3";
import { runStep4 } from "./demos/step4";
import { runStep5 } from "./demos/step5";
import { runStep6 } from "./demos/step6";
import { runX402Client } from "./addons/x402/client";


const program = new Command();

program
  .name("agentic-wallet")
  .description("Agentic Wallet demos (Solana devnet)")
  .option("--rpc <url>", "Override RPC URL (otherwise uses .env RPC_URL, then failover list)");

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


program.parseAsync(process.argv).catch((err) => {
  console.error("CLI fatal error:", err);
  process.exit(1);
});

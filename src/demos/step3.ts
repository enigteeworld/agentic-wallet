import chalk from "chalk";
import { TxService } from "../tx/txService";
import { header, infoLine, section, explorerAddressUrl, explorerTxUrl } from "../ui/print";
import { ensureAgentWallet, setupOrExit } from "./common";
import { Guardrails, PROGRAMS } from "../security/guardrails";

export async function runStep3(params?: { rpcUrl?: string; amountSol?: number }) {
  header("Demo Step 3 — Auto-Sign SOL Transfer (Devnet, v0 Tx)");

  const { connection, rpcName, rpcUrl, walletManager, passphrase } = await setupOrExit({
    rpcUrl: params?.rpcUrl,
  });

  infoLine("RPC Selected:", rpcName);
  infoLine("RPC URL:", rpcUrl);

  const guardrails = Guardrails.fromEnv();
  const txService = new TxService(connection);

  section("Agent Wallets");
  const agent1 = ensureAgentWallet({ agentId: "agent-001", walletManager, passphrase });
  const agent2 = ensureAgentWallet({ agentId: "agent-002", walletManager, passphrase });

  console.log(chalk.green("✅ agent-001:"), agent1.publicKey.toBase58());
  console.log(chalk.green("✅ agent-002:"), agent2.publicKey.toBase58());
  console.log(chalk.gray("Agent-001 explorer:"), explorerAddressUrl(agent1.publicKey.toBase58()));
  console.log(chalk.gray("Agent-002 explorer:"), explorerAddressUrl(agent2.publicKey.toBase58()));

  section("Balances");
  const bal1 = await walletManager.getSolBalance(agent1.publicKey);
  const bal2 = await walletManager.getSolBalance(agent2.publicKey);
  console.log(chalk.yellow("💰 agent-001 SOL:"), bal1.toFixed(4));
  console.log(chalk.yellow("💰 agent-002 SOL:"), bal2.toFixed(4));

  const transferAmount = params?.amountSol ?? 0.05;

  // Guardrails: program allowlist + spend cap
  guardrails.assertProgramsAllowed("step3:sol-transfer", [PROGRAMS.SYSTEM]);
  guardrails.assertSolTransfer("step3:sol-transfer", transferAmount);

  section("Transfer Plan");
  console.log(
    chalk.white("Will transfer"),
    chalk.bold(`${transferAmount} SOL`),
    chalk.white("from agent-001 → agent-002")
  );

  const ix = txService.buildSolTransferIx({
    from: agent1.publicKey,
    to: agent2.publicKey,
    solAmount: transferAmount,
  });

  const built = await txService.buildV0Tx({
    feePayer: agent1.publicKey,
    instructions: [ix],
    commitment: "confirmed",
  });

  if (bal1 < transferAmount + 0.01) {
    console.log(chalk.red("\n⚠️ agent-001 is not funded enough to send this transaction yet."));
    try {
      const sim = await txService.simulateV0Tx(built.tx, "confirmed");
      console.log(chalk.gray("🧪 Simulation logs:"), sim.value.logs ?? []);
      console.log(chalk.gray("🧪 Simulation error:"), sim.value.err);
    } catch (e) {
      console.log(chalk.gray("Simulation failed (RPC may be rate-limited):"), String(e));
    }
    console.log(chalk.gray("Fund agent-001:"), agent1.publicKey.toBase58());
    console.log(chalk.bold.green("\nStep 3 complete (simulation mode) ✅"));
    return;
  }

  section("Execute Transfer (Auto-Sign)");
  console.log(chalk.gray("🧪 Simulating before send..."));
  const sim = await txService.simulateV0Tx(built.tx, "confirmed");
  if (sim.value.err) {
    console.log(chalk.red("Simulation error:"), sim.value.err);
    console.log(chalk.gray("Logs:"), sim.value.logs ?? []);
    process.exit(1);
  } else {
    console.log(chalk.green("✅ Simulation OK"));
  }

  console.log(chalk.gray("✍️ Signing + sending..."));
  const sig = await txService.signSendConfirmV0Tx({
    tx: built.tx,
    signer: agent1,
    blockhash: built.blockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
    commitment: "confirmed",
  });

  console.log(chalk.green("✅ Transfer confirmed!"));
  console.log(chalk.magenta("Tx signature:"), sig);
  console.log(chalk.gray("Explorer:"), explorerTxUrl(sig));

  console.log(chalk.bold.green("\nStep 3 complete ✅"));
}

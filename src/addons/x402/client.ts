import "dotenv/config";
import chalk from "chalk";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getHealthyConnection } from "../../rpc/rpcManager";
import { WalletManager } from "../../wallet/walletManager";
import { ensureAgentWallet, setupOrExit } from "../../demos/common";
import { Guardrails, PROGRAMS } from "../../security/guardrails";
import { TxService } from "../../tx/txService";

/**
 * Client flow:
 * 1) GET /resource
 * 2) If 402: parse recipient + price
 * 3) Pay with agent wallet (SOL transfer)
 * 4) Retry with x-payment-signature header
 */

async function fetchJson(url: string, opts?: any) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return { status: res.status, json, text };
}

export async function runX402Client(params?: {
  serverUrl?: string;
  agentId?: string;
}) {
  const serverUrl = params?.serverUrl ?? process.env.X402_SERVER_URL ?? "http://localhost:8787";
  const agentId = params?.agentId ?? "agent-001";

  console.log(chalk.bold("\n🔌 x402-style client"));
  console.log(chalk.gray("Server:"), serverUrl);
  console.log(chalk.gray("Agent:"), agentId);

  const { connection, walletManager, passphrase } = await setupOrExit({
    rpcUrl: process.env.RPC_URL,
  });

  const agent = ensureAgentWallet({ agentId, walletManager, passphrase });

  const guardrails = Guardrails.fromEnv();
  guardrails.assertProgramsAllowed("x402:sol-transfer", [PROGRAMS.SYSTEM]);

  const txService = new TxService(connection);

  // 1) initial request
  console.log(chalk.cyan("\n1) Requesting /resource..."));
  const first = await fetchJson(`${serverUrl}/resource`);

  if (first.status === 200) {
    console.log(chalk.green("Already paid / no payment required."));
    console.log(first.json ?? first.text);
    return;
  }

  if (first.status !== 402) {
    console.log(chalk.red("Unexpected status:"), first.status);
    console.log(first.json ?? first.text);
    return;
  }

  console.log(chalk.yellow("402 Payment Required received."));
  const recipientStr = first.json?.recipient;
  const requiredSol = Number(first.json?.price?.sol ?? "0");
  if (!recipientStr || !requiredSol) {
    console.log(chalk.red("Malformed 402 response:"), first.json ?? first.text);
    return;
  }

  const recipient = new PublicKey(recipientStr);

  console.log(chalk.gray("Recipient:"), recipient.toBase58());
  console.log(chalk.gray("Price (SOL):"), requiredSol);

  // Guardrails: enforce spend cap
  guardrails.assertSolTransfer("x402:pay", requiredSol);

  // 2) Pay on-chain
  console.log(chalk.cyan("\n2) Paying on-chain..."));
  const ix = txService.buildSolTransferIx({
    from: agent.publicKey,
    to: recipient,
    solAmount: requiredSol,
  });

  const built = await txService.buildV0Tx({
    feePayer: agent.publicKey,
    instructions: [ix],
    commitment: "confirmed",
  });

  console.log(chalk.gray("Simulating..."));
  const sim = await txService.simulateV0Tx(built.tx, "confirmed");
  if (sim.value.err) {
    console.log(chalk.red("Simulation error:"), sim.value.err);
    console.log(chalk.gray("Logs:"), sim.value.logs ?? []);
    return;
  }
  console.log(chalk.green("Simulation OK. Sending..."));

  const sig = await txService.signSendConfirmV0Tx({
    tx: built.tx,
    signer: agent,
    blockhash: built.blockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
    commitment: "confirmed",
  });

  console.log(chalk.green("Payment tx confirmed:"), sig);

  // 3) Retry request with payment signature
  console.log(chalk.cyan("\n3) Retrying /resource with payment proof..."));
  const second = await fetchJson(`${serverUrl}/resource`, {
    headers: {
      "x-payment-signature": sig,
    },
  });

  console.log(chalk.gray("Status:"), second.status);
  console.log(second.json ?? second.text);
}

// Allow running directly
if (process.argv[1]?.includes("client.ts")) {
  runX402Client().catch((e) => {
    console.error("x402 client fatal:", e);
    process.exit(1);
  });
}

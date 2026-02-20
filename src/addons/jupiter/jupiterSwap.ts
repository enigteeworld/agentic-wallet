import "dotenv/config";
import { request } from "undici";
import {
  Connection,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import { WalletManager } from "../../wallet/walletManager";

/**
 * Jupiter Metis Swap API
 * - Quote: GET  /swap/v1/quote
 * - Swap : POST /swap/v1/swap
 *
 * NOTE:
 * Jupiter swap routing is effectively mainnet-oriented.
 * Devnet token mints (like devnet USDC) are not tradable on Jupiter routes.
 */

const JUP_BASE = process.env.JUP_BASE_URL ?? "https://api.jup.ag";
const JUP_API_KEY = process.env.JUP_API_KEY; // optional

// Mainnet mints (used by Jupiter routes)
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type QuoteResponse = any;

async function httpGetJson(url: string): Promise<any> {
  const headers: Record<string, string> = {};
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await request(url, { method: "GET", headers });
  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`GET ${url} failed (${res.statusCode}): ${text}`);
  }
  return JSON.parse(text);
}

async function httpPostJson(url: string, body: any): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (JUP_API_KEY) headers["x-api-key"] = JUP_API_KEY;

  const res = await request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`POST ${url} failed (${res.statusCode}): ${text}`);
  }
  return JSON.parse(text);
}

function getArg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const agentId = getArg("--agent", "agent-001")!;
  const solAmountStr = getArg("--sol", "0.02")!;
  const slippageBpsStr = getArg("--slippageBps", "100")!;

  // IMPORTANT: Jupiter trade demo is MAINNET by nature.
  // We keep devnet wallet system elsewhere, but this add-on demonstrates the trade pipeline.
  const cluster = getArg("--cluster", "mainnet-beta")!;
  const execute = hasFlag("--execute"); // explicit opt-in for real trade
  const rpcUrl =
    getArg("--rpc") ??
    (cluster === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");

  const solAmount = Number(solAmountStr);
  const slippageBps = Number(slippageBpsStr);

  if (!process.env.KEYSTORE_PASSPHRASE) throw new Error("Missing KEYSTORE_PASSPHRASE in environment");
  if (!Number.isFinite(solAmount) || solAmount <= 0) throw new Error("--sol must be > 0");
  if (!Number.isFinite(slippageBps) || slippageBps < 0) throw new Error("--slippageBps must be >= 0");

  console.log("\n🪐 Jupiter Swap Add-on");
  console.log("Cluster:", cluster);
  console.log("RPC:", rpcUrl);
  console.log("Agent:", agentId);
  console.log(`Trade: SOL → USDC | amount=${solAmount} SOL | slippage=${slippageBps} bps`);
  console.log("Mode:", execute ? "EXECUTE (real send)" : "DRY-RUN (quote + build + simulate only)");
  if (!execute) {
    console.log("Tip: add --execute ONLY if you intentionally want to trade real funds on mainnet.\n");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);
  const signer = walletManager.loadOrCreateEncryptedKeypairOrThrow(agentId);
  const userPublicKey = signer.publicKey.toBase58();

  console.log("\n✅ Agent pubkey:", userPublicKey);

  const amountLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)).toString();

  // 1) Quote (mainnet mints)
  const quoteUrl =
    `${JUP_BASE}/swap/v1/quote?` +
    new URLSearchParams({
      inputMint: WSOL_MINT,
      outputMint: MAINNET_USDC_MINT,
      amount: amountLamports,
      slippageBps: String(slippageBps),
      swapMode: "ExactIn",
    }).toString();

  console.log("\n1) Getting quote...");
  const quote: QuoteResponse = await httpGetJson(quoteUrl);

  if (!quote?.outAmount) {
    console.log("Quote response:", quote);
    throw new Error("Quote missing outAmount (pair not tradable / API limitations / liquidity)");
  }

  console.log("✅ Quote OK");
  console.log("   inAmount (lamports):", quote.inAmount);
  console.log("   outAmount (raw USDC):", quote.outAmount);
  console.log("   route hops:", Array.isArray(quote.routePlan) ? quote.routePlan.length : "unknown");

  // 2) Build swap tx
  console.log("\n2) Building swap transaction...");
  const swapResp = await httpPostJson(`${JUP_BASE}/swap/v1/swap`, {
    userPublicKey,
    quoteResponse: quote,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: { priorityLevel: "high", maxLamports: 1_000_000 },
    },
  });

  const swapTxB64: string | undefined = swapResp?.swapTransaction;
  if (!swapTxB64) {
    console.log("Swap response:", swapResp);
    throw new Error("Swap response missing swapTransaction");
  }

  console.log("✅ Received serialized swap transaction");
  console.log("   swapTransaction(base64) length:", swapTxB64.length);

  // 3) Sign (always) and simulate (safe)
  console.log("\n3) Signing + simulating...");
  const txBuf = Buffer.from(swapTxB64, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([signer]);

  const sim = await connection.simulateTransaction(tx, {
    commitment: "confirmed",
    sigVerify: false,
  });

  console.log("✅ Simulation complete");
  if (sim.value.err) {
    console.log("⚠️ Simulation err:", sim.value.err);
  }
  // avoid dumping huge logs by default, but show if present
  if (sim.value.logs?.length) {
    console.log("🧾 Logs (first 10):");
    for (const l of sim.value.logs.slice(0, 10)) console.log("  ", l);
  }

  // 4) Execute only if explicitly requested
  if (!execute) {
    console.log("\nDRY-RUN finished ✅ (no on-chain swap sent)");
    return;
  }

  console.log("\n4) Sending real swap (mainnet funds will be used)...");
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  console.log("⏳ Confirming:", sig);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed"
  );

  console.log("\n✅ Swap confirmed!");
  console.log("Tx signature:", sig);
  console.log("Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`);
  console.log("\nDone ✅");
}

main().catch((e) => {
  console.error("\nFatal:", e?.message ?? e);
  process.exit(1);
});
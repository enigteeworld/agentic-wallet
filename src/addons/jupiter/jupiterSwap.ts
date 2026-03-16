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
 * This version supports:
 * - legacy SOL -> USDC flow via --sol
 * - generic swaps via:
 *   --inputMint
 *   --outputMint
 *   --amountRaw
 *   OR
 *   --amountUi + --inputDecimals
 *
 * Important:
 * We print both RAW and UI amounts so upstream accounting can use UI amounts.
 */

const JUP_BASE = process.env.JUP_BASE_URL ?? "https://api.jup.ag";
const JUP_API_KEY = process.env.JUP_API_KEY;

// Common mainnet mints
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAINNET_JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const MINT_DECIMALS: Record<string, number> = {
  [WSOL_MINT]: 9,
  [MAINNET_USDC_MINT]: 6,
  [MAINNET_JUP_MINT]: 6,
};

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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
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

function toRawAmountFromUi(amountUi: number, decimals: number): string {
  const scaled = Math.floor(amountUi * 10 ** decimals);
  return String(scaled);
}

function toUiAmount(rawAmount: string | number, decimals: number): number {
  const numeric = typeof rawAmount === "string" ? Number(rawAmount) : rawAmount;
  if (!Number.isFinite(numeric)) return 0;
  return numeric / 10 ** decimals;
}

function shortenMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function resolveDecimals(mint: string, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return MINT_DECIMALS[mint] ?? 6;
}

function parseSwapArgs(): {
  agentId: string;
  cluster: "devnet" | "mainnet-beta";
  execute: boolean;
  rpcUrl: string;
  slippageBps: number;
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  inputDecimals: number;
  outputDecimals: number;
  displayAmount: string;
  displayPair: string;
} {
  const agentId = getArg("--agent", "agent-001")!;
  const slippageBps = Number(getArg("--slippageBps", "100")!);

  const clusterArg = getArg("--cluster", "mainnet-beta")!;
  if (clusterArg !== "devnet" && clusterArg !== "mainnet-beta") {
    throw new Error(`Unsupported --cluster value: ${clusterArg}`);
  }
  const cluster = clusterArg;

  const execute = hasFlag("--execute");
  const rpcUrl =
    getArg("--rpc") ??
    (cluster === "mainnet-beta"
      ? "https://api.mainnet-beta.solana.com"
      : "https://api.devnet.solana.com");

  if (!Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error("--slippageBps must be >= 0");
  }

  const legacySolAmountStr = getArg("--sol");
  if (legacySolAmountStr) {
    const solAmount = Number(legacySolAmountStr);
    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      throw new Error("--sol must be > 0");
    }

    return {
      agentId,
      cluster,
      execute,
      rpcUrl,
      slippageBps,
      inputMint: WSOL_MINT,
      outputMint: MAINNET_USDC_MINT,
      amountRaw: String(Math.floor(solAmount * LAMPORTS_PER_SOL)),
      inputDecimals: 9,
      outputDecimals: 6,
      displayAmount: `${solAmount} SOL`,
      displayPair: "SOL -> USDC",
    };
  }

  const inputMint = getArg("--inputMint");
  const outputMint = getArg("--outputMint");
  const amountRaw = getArg("--amountRaw");
  const amountUi = getArg("--amountUi");
  const inputDecimalsArg = getArg("--inputDecimals");
  const outputDecimalsArg = getArg("--outputDecimals");

  if (!inputMint) {
    throw new Error("Missing --inputMint (or use legacy --sol)");
  }

  if (!outputMint) {
    throw new Error("Missing --outputMint (or use legacy --sol)");
  }

  const resolvedInputDecimals = resolveDecimals(
    inputMint,
    inputDecimalsArg !== undefined ? Number(inputDecimalsArg) : undefined
  );
  const resolvedOutputDecimals = resolveDecimals(
    outputMint,
    outputDecimalsArg !== undefined ? Number(outputDecimalsArg) : undefined
  );

  if (amountRaw) {
    if (!/^\d+$/.test(amountRaw)) {
      throw new Error("--amountRaw must be an integer string");
    }

    return {
      agentId,
      cluster,
      execute,
      rpcUrl,
      slippageBps,
      inputMint,
      outputMint,
      amountRaw,
      inputDecimals: resolvedInputDecimals,
      outputDecimals: resolvedOutputDecimals,
      displayAmount: `${amountRaw} raw`,
      displayPair: `${shortenMint(inputMint)} -> ${shortenMint(outputMint)}`,
    };
  }

  if (amountUi && inputDecimalsArg) {
    const parsedUi = Number(amountUi);
    const parsedInputDecimals = Number(inputDecimalsArg);

    if (!Number.isFinite(parsedUi) || parsedUi <= 0) {
      throw new Error("--amountUi must be > 0");
    }

    if (!Number.isFinite(parsedInputDecimals) || parsedInputDecimals < 0) {
      throw new Error("--inputDecimals must be >= 0");
    }

    return {
      agentId,
      cluster,
      execute,
      rpcUrl,
      slippageBps,
      inputMint,
      outputMint,
      amountRaw: toRawAmountFromUi(parsedUi, parsedInputDecimals),
      inputDecimals: parsedInputDecimals,
      outputDecimals: resolvedOutputDecimals,
      displayAmount: `${parsedUi} ui`,
      displayPair: `${shortenMint(inputMint)} -> ${shortenMint(outputMint)}`,
    };
  }

  throw new Error(
    "Provide either legacy --sol, or generic --inputMint --outputMint with --amountRaw OR --amountUi + --inputDecimals"
  );
}

async function main() {
  if (!process.env.KEYSTORE_PASSPHRASE) {
    throw new Error("Missing KEYSTORE_PASSPHRASE in environment");
  }

  const {
    agentId,
    cluster,
    execute,
    rpcUrl,
    slippageBps,
    inputMint,
    outputMint,
    amountRaw,
    inputDecimals,
    outputDecimals,
    displayAmount,
    displayPair,
  } = parseSwapArgs();

  console.log("\n🪐 Jupiter Swap Add-on");
  console.log("Cluster:", cluster);
  console.log("RPC:", rpcUrl);
  console.log("Agent:", agentId);
  console.log(`Trade: ${displayPair} | amount=${displayAmount} | slippage=${slippageBps} bps`);
  console.log("Input Mint:", inputMint);
  console.log("Output Mint:", outputMint);
  console.log("Amount Raw:", amountRaw);
  console.log("Input Decimals:", inputDecimals);
  console.log("Output Decimals:", outputDecimals);
  console.log("Mode:", execute ? "EXECUTE (real send)" : "DRY-RUN (quote + build + simulate only)");
  if (!execute) {
    console.log("Tip: add --execute ONLY if you intentionally want to trade real funds.\n");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);
  const signer = walletManager.loadOrCreateEncryptedKeypairOrThrow(agentId);
  const userPublicKey = signer.publicKey.toBase58();

  console.log("\n✅ Agent pubkey:", userPublicKey);

  const quoteUrl =
    `${JUP_BASE}/swap/v1/quote?` +
    new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountRaw,
      slippageBps: String(slippageBps),
      swapMode: "ExactIn",
    }).toString();

  console.log("\n1) Getting quote...");
  const quote: QuoteResponse = await httpGetJson(quoteUrl);

  if (!quote?.outAmount) {
    console.log("Quote response:", quote);
    throw new Error("Quote missing outAmount (pair not tradable / API limitations / liquidity)");
  }

  const inAmountRaw = String(quote.inAmount);
  const outAmountRaw = String(quote.outAmount);
  const inAmountUi = toUiAmount(inAmountRaw, inputDecimals);
  const outAmountUi = toUiAmount(outAmountRaw, outputDecimals);

  console.log("✅ Quote OK");
  console.log("Input Mint:", inputMint);
  console.log("Output Mint:", outputMint);
  console.log("Input Amount Raw:", inAmountRaw);
  console.log("Output Amount Raw:", outAmountRaw);
  console.log("Input Amount UI:", inAmountUi);
  console.log("Output Amount UI:", outAmountUi);
  console.log("Route Hops:", Array.isArray(quote.routePlan) ? quote.routePlan.length : "unknown");

  console.log("\n2) Building swap transaction...");
  const swapResp = await httpPostJson(`${JUP_BASE}/swap/v1/swap`, {
    userPublicKey,
    quoteResponse: quote,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    dynamicSlippage: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        priorityLevel: "high",
        maxLamports: 1_000_000,
      },
    },
  });

  const swapTxB64: string | undefined = swapResp?.swapTransaction;
  if (!swapTxB64) {
    console.log("Swap response:", swapResp);
    throw new Error("Swap response missing swapTransaction");
  }

  console.log("✅ Received serialized swap transaction");
  console.log("swapTransaction(base64) length:", swapTxB64.length);

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
    console.log("Simulation Error:", JSON.stringify(sim.value.err));
  }

  if (sim.value.logs?.length) {
    console.log("Logs (first 10):");
    for (const logLine of sim.value.logs.slice(0, 10)) {
      console.log(" ", logLine);
    }
  }

  if (!execute) {
    console.log("\nDRY-RUN finished ✅ (no on-chain swap sent)");
    console.log("Input Mint:", inputMint);
    console.log("Output Mint:", outputMint);
    console.log("Input Amount:", inAmountUi);
    console.log("Output Amount:", outAmountUi);
    return;
  }

  console.log("\n4) Sending real swap...");
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  console.log("Confirming:", sig);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  const explorer =
    cluster === "mainnet-beta"
      ? `https://explorer.solana.com/tx/${sig}`
      : `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

  console.log("\n✅ Swap confirmed!");
  console.log("Signature:", sig);
  console.log("Explorer:", explorer);
  console.log("Input Mint:", inputMint);
  console.log("Output Mint:", outputMint);
  console.log("Input Amount:", inAmountUi);
  console.log("Output Amount:", outAmountUi);
  console.log("\nDone ✅");
}

main().catch((e) => {
  console.error("\nFatal:", e?.message ?? e);
  process.exit(1);
});
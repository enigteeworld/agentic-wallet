import "dotenv/config";
import fs from "fs";
import chalk from "chalk";
import { Keypair } from "@solana/web3.js";
import { loadEnv } from "../config/env";
import { getHealthyConnection } from "../rpc/rpcManager";
import { WalletManager } from "../wallet/walletManager";

export async function setupOrExit(params?: { rpcUrl?: string }) {
  const env = loadEnv();
  const passphrase = env.KEYSTORE_PASSPHRASE;
  if (!passphrase) {
    console.log(
      chalk.red(
        "Missing KEYSTORE_PASSPHRASE. Add it to your .env file (at least 8 characters)."
      )
    );
    process.exit(1);
  }

  // If CLI passes --rpc, use that. Otherwise .env RPC_URL. Otherwise failover list.
  const preferred = params?.rpcUrl ?? env.RPC_URL;
  const { connection, rpcName, rpcUrl } = await getHealthyConnection(preferred);

  const walletManager = new WalletManager(connection);

  return { connection, rpcName, rpcUrl, walletManager, passphrase };
}

export function ensureAgentWallet(params: {
  agentId: string;
  walletManager: WalletManager;
  passphrase: string;
}): Keypair {
  const { agentId, walletManager, passphrase } = params;
  const keystorePath = walletManager.keystorePathForAgent(agentId);

  if (fs.existsSync(keystorePath)) {
    return walletManager.loadEncryptedKeypair(agentId, passphrase);
  }

  const kp = walletManager.createKeypair();
  walletManager.saveEncryptedKeypair(agentId, kp, passphrase);
  return kp;
}

export function formatTokens(raw: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

// ----------------- START deposit.ts -----------------
import fs from "fs";
import path from "path";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import crypto from "crypto";
import { BN } from "@coral-xyz/anchor";
import 'dotenv/config';

import { VoltrClient } from "@voltr/vault-sdk";

// --- CONFIG ---
const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

// Paths
const KEYSTORE_PATH = path.resolve(__dirname, "../keystore/agent-001.json");
const AGENT_CONFIG_PATH = path.resolve(__dirname, "../config/agent-001.json");

// Load agent config
const agentConfig = JSON.parse(fs.readFileSync(AGENT_CONFIG_PATH, "utf8"));
const VAULT = new PublicKey(agentConfig.vault?.rangerVaultPubkey);

// USDC mint on mainnet
const USDC_MINT = new PublicKey("Es9vMFrzaCER2vC6NWBxqXyCJVx2po2k6i6FGgHj7Cx");

// Load keystore passphrase from .env
const PASSPHRASE = process.env.KEYSTORE_PASSPHRASE;
if (!PASSPHRASE) throw new Error("KEYSTORE_PASSPHRASE not set in .env");

// --- Helper to decrypt keystore ---
function base64ToBuffer(b64: string) { return Buffer.from(b64, "base64"); }

function decryptKeystore(keystore: any, password: string): Uint8Array {
  const salt = base64ToBuffer(keystore.salt_b64);
  const key = crypto.scryptSync(password, salt, 32);
  const iv = base64ToBuffer(keystore.iv_b64);
  const tag = base64ToBuffer(keystore.tag_b64);
  const ciphertext = base64ToBuffer(keystore.ciphertext_b64);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(decrypted);
}

// --- Load agent wallet ---
const keystore = JSON.parse(fs.readFileSync(KEYSTORE_PATH, "utf8"));
const wallet = Keypair.fromSecretKey(decryptKeystore(keystore, PASSPHRASE));

// Initialize Voltr SDK client
const client = new VoltrClient(connection);

async function main() {
  console.log("Agent wallet:", wallet.publicKey.toBase58());
  console.log("Vault:", VAULT.toBase58());

  // Amount to deposit: 0.94 USDC = 940_000 (6 decimals)
  const amountBN = new BN(940_000);

  // Create the deposit instruction using Voltr SDK
  const depositIx = await client.createDepositVaultIx(amountBN, {
    userTransferAuthority: wallet.publicKey,
    vault: VAULT,
    vaultAssetMint: USDC_MINT,
    assetTokenProgram: TOKEN_PROGRAM_ID,
  });

  // Build the transaction
  const tx = new Transaction().add(depositIx);

  console.log("Sending deposit transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: "confirmed" });

  console.log("✅ Deposit confirmed! Signature:", sig);
}

main().catch(err => {
  console.error("Error during deposit:", err);
});
// ----------------- END deposit.ts -----------------
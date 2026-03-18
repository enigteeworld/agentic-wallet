// ----------------- START deposit.ts -----------------
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";
import dotenv from "dotenv";
import { TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import { VoltrClient } from "../src/voltr"; // adjust path
import BN from "bn.js";

dotenv.config();

// --- CONFIG ---
const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

const KEYSTORE_PATH = "../keystore/agent-001.json";
const PASSPHRASE = process.env.KEYSTORE_PASSPHRASE || "";

const VAULT = new PublicKey("EUjtN36p8jwsdghVhK4S3Wp7AU3CYQrhLyww37ZBYi7o");
const USDC_MINT = new PublicKey("Es9vMFrzaCER2vC6NWBxqXyCJVx2po2k6i6FGgHj7Cx");
const DEPOSIT_AMOUNT = 940_000; // 0.94 USDC (6 decimals)

// --- Load & decrypt agent wallet ---
function loadAgentWallet(): Keypair {
  const encrypted = JSON.parse(fs.readFileSync(KEYSTORE_PATH, "utf8"));
  const secretKey = decryptKeyStore(encrypted, PASSPHRASE); // your existing decrypt function
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

async function main() {
  const wallet = loadAgentWallet();
  console.log("Manager wallet:", wallet.publicKey.toBase58());

  const client = new VoltrClient(connection, wallet);

  // --- Vault asset mint PDA ---
  const vaultAssetMintPDA = await client.findVaultAssetMintPda(VAULT, USDC_MINT);
  const accountInfo = await connection.getAccountInfo(vaultAssetMintPDA);

  // --- Prepare instructions ---
  const tx = new Transaction();

  // Initialize vault asset mint if missing
  if (!accountInfo) {
    console.log("Vault asset mint not initialized. Adding initialization instruction...");
    const initIx = await client.createInitVaultAssetMintInstruction(
      VAULT,
      USDC_MINT,
      wallet.publicKey
    );
    tx.add(initIx);
  }

  // Get token accounts
  const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    USDC_MINT,
    wallet.publicKey
  );
  const vaultTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    USDC_MINT,
    VAULT
  );

  // Add deposit instruction
  console.log(`Adding deposit of ${DEPOSIT_AMOUNT / 1_000_000} USDC...`);
  const depositIx = transfer(
    connection,
    wallet,
    fromTokenAccount.address,
    vaultTokenAccount.address,
    wallet.publicKey,
    DEPOSIT_AMOUNT
  );
  tx.add(depositIx);

  // --- Send transaction ---
  console.log("Sending transaction...");
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log("Transaction successful! Signature:", sig);
}

main().catch((err) => {
  console.error("Error during deposit:", err);
});
// ----------------- END deposit.ts -----------------
import "dotenv/config";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { WalletManager } from "../wallet/walletManager";

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  const passphrase = process.env.KEYSTORE_PASSPHRASE;
  if (!passphrase) throw new Error("Missing KEYSTORE_PASSPHRASE");

  const fromAgent = process.argv[2]; // e.g. agent-004
  const toPubkeyStr = process.argv[3]; // receiver pubkey
  const amountSol = Number(process.argv[4]); // e.g. 0.02

  if (!fromAgent || !toPubkeyStr || !Number.isFinite(amountSol)) {
    throw new Error("Usage: npx ts-node src/scripts/solTransfer.ts agent-004 <TO_PUBKEY> 0.02");
  }

  const toPubkey = new PublicKey(toPubkeyStr);

  const connection = new Connection(rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);

  // decrypt agent wallet (agent-004)
  const fromKp: Keypair = walletManager.loadEncryptedKeypair(fromAgent, passphrase);

  const lamports = Math.round(amountSol * 1_000_000_000);

  const ix = SystemProgram.transfer({
    fromPubkey: fromKp.publicKey,
    toPubkey,
    lamports,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = fromKp.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [fromKp], {
    commitment: "confirmed",
  });

  console.log("✅ sent", sig);
  console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((e) => {
  console.error("❌", e?.message ?? e);
  process.exit(1);
});
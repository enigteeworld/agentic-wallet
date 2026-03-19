import fs from "fs";
import path from "path";
import { BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SendTransactionError,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { VoltrClient } from "@voltr/vault-sdk";
import { WalletManager } from "../wallet/walletManager";

type AgentConfig = {
  agentId?: string;
  vault?: {
    enabled?: boolean;
    rangerVaultPubkey?: string;
    assetMint?: string;
  };
  strategy?: {
    baseAsset?: string;
  };
};

export type WithdrawFromVaultParams = {
  agentId: string;
  rpcUrl: string;
  amountUi: string;
  vaultAssetMint?: string;
};

function loadAgentConfig(agentId: string): AgentConfig {
  const configPath = path.join(process.cwd(), "config", `${agentId}.json`);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  return JSON.parse(fs.readFileSync(configPath, "utf8")) as AgentConfig;
}

function requireVaultPubkey(config: AgentConfig, agentId: string): PublicKey {
  const value = config.vault?.rangerVaultPubkey;

  if (!value) {
    throw new Error(
      `Missing vault.rangerVaultPubkey in config/${agentId}.json`,
    );
  }

  return new PublicKey(value);
}

function resolveVaultAssetMint(
  config: AgentConfig,
  override?: string,
): PublicKey {
  if (override) {
    return new PublicKey(override);
  }

  if (config.vault?.assetMint) {
    return new PublicKey(config.vault.assetMint);
  }

  const baseAsset = config.strategy?.baseAsset?.toUpperCase();

  if (!baseAsset || baseAsset === "USDC") {
    return new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  }

  throw new Error(
    `Could not infer vault asset mint from strategy.baseAsset=${config.strategy?.baseAsset}. Pass --mint explicitly or set vault.assetMint in config.`,
  );
}

function uiToBaseUnits(amountUi: string, decimals: number): bigint {
  const normalized = amountUi.trim();

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid amount: ${amountUi}`);
  }

  const [whole, frac = ""] = normalized.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const full = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, "");

  return BigInt(full || "0");
}

export async function withdrawFromVault({
  agentId,
  rpcUrl,
  amountUi,
  vaultAssetMint: vaultAssetMintOverride,
}: WithdrawFromVaultParams): Promise<void> {
  const connection = new Connection(rpcUrl, "confirmed");
  const walletManager = new WalletManager(connection);
  const wallet = walletManager.loadOrCreateEncryptedKeypairOrThrow(agentId);

  const config = loadAgentConfig(agentId);

  if (!config.vault?.enabled) {
    throw new Error(`Vault is not enabled in config/${agentId}.json`);
  }

  const vault = requireVaultPubkey(config, agentId);
  const vaultAssetMint = resolveVaultAssetMint(
    config,
    vaultAssetMintOverride,
  );

  const assetMintInfo = await getMint(
    connection,
    vaultAssetMint,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );

  const amountBaseUnits = uiToBaseUnits(amountUi, assetMintInfo.decimals);

  if (amountBaseUnits <= BigInt(0)) {
    throw new Error("Withdraw amount must be greater than 0");
  }

  const client = new VoltrClient(connection);
  const amountBn = new BN(amountBaseUnits.toString());

  const {
    vaultLpMint,
    vaultAssetIdleAuth,
  } = client.findVaultAddresses(vault);

  const lpMintInfo = await getMint(
    connection,
    vaultLpMint,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );

  const userAssetAta = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    vaultAssetMint,
    wallet.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const userLpAta = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    vaultLpMint,
    wallet.publicKey,
    false,
    "confirmed",
    { commitment: "confirmed" },
    TOKEN_PROGRAM_ID,
  );

  const vaultAssetIdleAta = getAssociatedTokenAddressSync(
    vaultAssetMint,
    vaultAssetIdleAuth,
    true,
    TOKEN_PROGRAM_ID,
  );

  console.log("\n-- Ranger Vault Withdraw");
  console.log(`Agent: ${agentId}`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Vault: ${vault.toBase58()}`);
  console.log(`Vault asset mint: ${vaultAssetMint.toBase58()}`);
  console.log(`Vault LP mint: ${vaultLpMint.toBase58()}`);
  console.log(`Amount UI (asset): ${amountUi}`);
  console.log(`Amount base units (asset): ${amountBaseUnits.toString()}`);
  console.log(`Asset decimals: ${assetMintInfo.decimals}`);
  console.log(`LP decimals: ${lpMintInfo.decimals}`);
  console.log(`User asset ATA: ${userAssetAta.address.toBase58()}`);
  console.log(`User LP ATA: ${userLpAta.address.toBase58()}`);
  console.log(`Vault asset idle auth: ${vaultAssetIdleAuth.toBase58()}`);
  console.log(`Vault asset idle ATA: ${vaultAssetIdleAta.toBase58()}`);

  const withdrawIx = await (client as any).createWithdrawVaultIx(amountBn, {
  userTransferAuthority: wallet.publicKey,

  vault,
  vaultLpMint,

  // 🔑 correct naming
  userLpTokenAccount: userLpAta.address,
  userAssetTokenAccount: userAssetAta.address,

  vaultAssetTokenAccount: vaultAssetIdleAta,
  vaultAssetIdleAuth,

  assetTokenProgram: TOKEN_PROGRAM_ID,
});

  const tx = new Transaction().add(withdrawIx);
  tx.feePayer = wallet.publicKey;

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
      skipPreflight: false,
    });

    console.log("\nWithdraw confirmed");
    console.log(`Signature: ${sig}`);
    console.log(
      `Explorer: https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`,
    );
  } catch (err) {
    if (err instanceof SendTransactionError) {
      console.error("\nWithdraw simulation failed");
      console.error(`Message: ${err.message}`);

      if (typeof err.getLogs === "function") {
        try {
          const logs = await err.getLogs(connection);
          console.error("Logs:");
          for (const line of logs) {
            console.error(line);
          }
        } catch {
          if (
            "transactionLogs" in err &&
            Array.isArray((err as any).transactionLogs)
          ) {
            console.error("Logs:");
            for (const line of (err as any).transactionLogs) {
              console.error(line);
            }
          }
        }
      }

      throw err;
    }

    throw err;
  }
}
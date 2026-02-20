import chalk from "chalk";
import { PublicKey } from "@solana/web3.js";
import { SplTokenService } from "../token/splTokenService";
import { header, infoLine, section, explorerAddressUrl, explorerTxUrl } from "../ui/print";
import { ensureAgentWallet, setupOrExit } from "./common";

export async function runStep4(params?: { rpcUrl?: string }) {
  header("Demo Step 4 — SPL Token Mint + Mint + Transfer (Devnet)");

  const { connection, rpcName, rpcUrl, walletManager, passphrase } = await setupOrExit({
    rpcUrl: params?.rpcUrl,
  });

  infoLine("RPC Selected:", rpcName);
  infoLine("RPC URL:", rpcUrl);

  const tokenService = new SplTokenService(connection);

  section("Agent Wallets");
  const agent1 = ensureAgentWallet({ agentId: "agent-001", walletManager, passphrase });
  const agent2 = ensureAgentWallet({ agentId: "agent-002", walletManager, passphrase });

  console.log(chalk.green("✅ agent-001:"), agent1.publicKey.toBase58());
  console.log(chalk.green("✅ agent-002:"), agent2.publicKey.toBase58());
  console.log(chalk.gray("Agent-001 explorer:"), explorerAddressUrl(agent1.publicKey.toBase58()));
  console.log(chalk.gray("Agent-002 explorer:"), explorerAddressUrl(agent2.publicKey.toBase58()));

  section("SOL Balances (needed for fees)");
  const sol1 = await walletManager.getSolBalance(agent1.publicKey);
  const sol2 = await walletManager.getSolBalance(agent2.publicKey);
  console.log(chalk.yellow("💰 agent-001 SOL:"), sol1.toFixed(4));
  console.log(chalk.yellow("💰 agent-002 SOL:"), sol2.toFixed(4));

  if (sol1 < 0.02) {
    console.log(chalk.red("\n⚠️ agent-001 needs a bit more SOL to pay mint/account fees."));
    process.exit(1);
  }

  section("Create SPL Mint");
  const decimals = 6;
  const mint = await tokenService.createMint({
    payer: agent1,
    mintAuthority: agent1.publicKey,
    freezeAuthority: null,
    decimals,
  });

  console.log(chalk.green("✅ Mint created:"), mint.toBase58());
  console.log(chalk.gray("Mint explorer:"), explorerAddressUrl(mint.toBase58()));

  section("Create/Fetch Token Accounts (ATAs)");
  const agent1Ata = await tokenService.getOrCreateAta({
    payer: agent1,
    mint,
    owner: agent1.publicKey,
  });

  const agent2Ata = await tokenService.getOrCreateAta({
    payer: agent1,
    mint,
    owner: agent2.publicKey,
  });

  console.log(chalk.green("✅ agent-001 ATA:"), agent1Ata.toBase58());
  console.log(chalk.green("✅ agent-002 ATA:"), agent2Ata.toBase58());

  section("Mint tokens to agent-001");
  const mintAmountTokens = 100;
  const mintAmountRaw = BigInt(mintAmountTokens) * BigInt(10 ** decimals);

  const mintSig = await tokenService.mintTo({
    payer: agent1,
    mint,
    destinationAta: agent1Ata,
    mintAuthority: agent1,
    amountRaw: mintAmountRaw,
  });

  console.log(chalk.green("✅ Minted tokens | Tx:"), mintSig);
  console.log(chalk.gray("Explorer:"), explorerTxUrl(mintSig));

  section("Transfer tokens agent-001 → agent-002");
  const transferTokens = 25;
  const transferRaw = BigInt(transferTokens) * BigInt(10 ** decimals);

  const transferSig = await tokenService.transfer({
    payer: agent1,
    sourceAta: agent1Ata,
    destinationAta: agent2Ata,
    owner: agent1,
    amountRaw: transferRaw,
  });

  console.log(chalk.green("✅ Transfer complete | Tx:"), transferSig);
  console.log(chalk.gray("Explorer:"), explorerTxUrl(transferSig));

  section("Token Balances (raw)");
  const a1Amt = await tokenService.getTokenAccountAmountRaw({ ata: agent1Ata });
  const a2Amt = await tokenService.getTokenAccountAmountRaw({ ata: agent2Ata });

  console.log(chalk.yellow("🪙 agent-001 ATA raw:"), a1Amt.toString());
  console.log(chalk.yellow("🪙 agent-002 ATA raw:"), a2Amt.toString());

  console.log(chalk.bold.green("\nStep 4 complete ✅"));
}

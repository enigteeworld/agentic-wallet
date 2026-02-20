import chalk from "chalk";
import { PublicKey } from "@solana/web3.js";
import { SplTokenService } from "../token/splTokenService";
import { StateStore } from "../state/stateStore";
import { AgentBrain } from "../agent/agentBrain";
import { header, infoLine, section, explorerAddressUrl, explorerTxUrl } from "../ui/print";
import { ensureAgentWallet, formatTokens, setupOrExit } from "./common";
import { Guardrails, PROGRAMS } from "../security/guardrails";

export async function runStep5(params?: { rpcUrl?: string }) {
  header("Demo Step 5 — Agent Brain + Persistent State (Devnet)");

  const { connection, rpcName, rpcUrl, walletManager, passphrase } = await setupOrExit({
    rpcUrl: params?.rpcUrl,
  });

  infoLine("RPC Selected:", rpcName);
  infoLine("RPC URL:", rpcUrl);

  const guardrails = Guardrails.fromEnv();
  const tokenService = new SplTokenService(connection);
  const stateStore = new StateStore();
  const state = stateStore.load();

  section("Agent Wallets");
  const agent1 = ensureAgentWallet({ agentId: "agent-001", walletManager, passphrase });
  const agent2 = ensureAgentWallet({ agentId: "agent-002", walletManager, passphrase });

  console.log(chalk.green("✅ agent-001:"), agent1.publicKey.toBase58());
  console.log(chalk.green("✅ agent-002:"), agent2.publicKey.toBase58());
  console.log(chalk.gray("Agent-001 explorer:"), explorerAddressUrl(agent1.publicKey.toBase58()));
  console.log(chalk.gray("Agent-002 explorer:"), explorerAddressUrl(agent2.publicKey.toBase58()));
  console.log(chalk.gray("State file:"), stateStore.getPath());

  // Guardrails: token + ATA programs must be allowed for token actions
  guardrails.assertProgramsAllowed("step5:token-programs", [PROGRAMS.TOKEN, PROGRAMS.ATA]);

  section("Ensure Mint + ATAs (persisted)");
  let mintPubkey: PublicKey;
  let decimals: number;

  if (state.mint?.address) {
    mintPubkey = new PublicKey(state.mint.address);
    decimals = state.mint.decimals;
    console.log(chalk.green("✅ Reusing mint from state:"), mintPubkey.toBase58());
  } else {
    decimals = 6;
    mintPubkey = await tokenService.createMint({
      payer: agent1,
      mintAuthority: agent1.publicKey,
      freezeAuthority: null,
      decimals,
    });

    state.mint = { address: mintPubkey.toBase58(), decimals };
    stateStore.save(state);

    console.log(chalk.green("✅ Created new mint:"), mintPubkey.toBase58());
    console.log(chalk.gray("Mint explorer:"), explorerAddressUrl(mintPubkey.toBase58()));
  }

  state.atas = state.atas ?? {};

  if (!state.atas["agent-001"]) {
    const ata = await tokenService.getOrCreateAta({
      payer: agent1,
      mint: mintPubkey,
      owner: agent1.publicKey,
    });
    state.atas["agent-001"] = ata.toBase58();
    stateStore.save(state);
  }

  if (!state.atas["agent-002"]) {
    const ata = await tokenService.getOrCreateAta({
      payer: agent1,
      mint: mintPubkey,
      owner: agent2.publicKey,
    });
    state.atas["agent-002"] = ata.toBase58();
    stateStore.save(state);
  }

  const agent1Ata = new PublicKey(state.atas["agent-001"]);
  const agent2Ata = new PublicKey(state.atas["agent-002"]);

  console.log(chalk.green("✅ agent-001 ATA:"), agent1Ata.toBase58());
  console.log(chalk.green("✅ agent-002 ATA:"), agent2Ata.toBase58());

  section("Read Token Balances");
  const a1Raw = await tokenService.getTokenAccountAmountRaw({ ata: agent1Ata });
  const a2Raw = await tokenService.getTokenAccountAmountRaw({ ata: agent2Ata });

  console.log(chalk.yellow("🪙 agent-001 tokens:"), formatTokens(a1Raw, decimals));
  console.log(chalk.yellow("🪙 agent-002 tokens:"), formatTokens(a2Raw, decimals));

  section("Agent Brain Plan");
  const brain = new AgentBrain();
  const plan = brain.createPlan();
  console.log(chalk.gray("Policy: keep agent-001 >= 50 tokens; keep agent-002 >= 10 tokens"));

  for (const action of plan.actions) {
    if (action.type === "MINT_IF_LOW") {
      const minRaw = BigInt(action.minTokens) * BigInt(10 ** decimals);
      if (a1Raw < minRaw) {
        const topUpRaw = BigInt(action.topUpTokens) * BigInt(10 ** decimals);

        // Guardrails: token cap + action cap
        guardrails.assertTokenAmount("step5:mint", topUpRaw, decimals);

        const sig = await tokenService.mintTo({
          payer: agent1,
          mint: mintPubkey,
          destinationAta: agent1Ata,
          mintAuthority: agent1,
          amountRaw: topUpRaw,
        });
        console.log(chalk.green(`✅ Mint action executed (+${action.topUpTokens} tokens)`));
        console.log(chalk.gray("Tx:"), sig);
        console.log(chalk.gray("Explorer:"), explorerTxUrl(sig));
      } else {
        console.log(chalk.gray("Mint action skipped (agent-001 balance healthy)."));
      }
    }

    if (action.type === "TRANSFER_IF_OTHER_LOW") {
      const otherMinRaw = BigInt(action.otherMinTokens) * BigInt(10 ** decimals);
      if (a2Raw < otherMinRaw) {
        const transferRaw = BigInt(action.transferTokens) * BigInt(10 ** decimals);

        // Guardrails: token cap + action cap
        guardrails.assertTokenAmount("step5:transfer", transferRaw, decimals);

        const sig = await tokenService.transfer({
          payer: agent1,
          sourceAta: agent1Ata,
          destinationAta: agent2Ata,
          owner: agent1,
          amountRaw: transferRaw,
        });
        console.log(
          chalk.green(`✅ Transfer action executed (+${action.transferTokens} tokens to agent-002)`)
        );
        console.log(chalk.gray("Tx:"), sig);
        console.log(chalk.gray("Explorer:"), explorerTxUrl(sig));
      } else {
        console.log(chalk.gray("Transfer action skipped (agent-002 balance healthy)."));
      }
    }
  }

  section("Done");
  console.log(chalk.bold.green("Step 5 complete ✅"));
}

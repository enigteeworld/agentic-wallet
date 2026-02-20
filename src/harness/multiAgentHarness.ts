import fs from "fs";
import chalk from "chalk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { WalletManager } from "../wallet/walletManager";
import { SplTokenService } from "../token/splTokenService";
import { StateStore } from "../state/stateStore";
import { Guardrails, PROGRAMS } from "../security/guardrails";

export type HarnessConfig = {
  agentCount: number;
  rounds: number;
  seedTokensPerAgent: number;
};

function formatTokens(raw: bigint, decimals: number): string {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

export class MultiAgentHarness {
  private readonly walletManager: WalletManager;
  private readonly tokenService: SplTokenService;
  private readonly stateStore: StateStore;
  private readonly passphrase: string;

  constructor(params: {
    walletManager: WalletManager;
    tokenService: SplTokenService;
    stateStore: StateStore;
    passphrase: string;
  }) {
    this.walletManager = params.walletManager;
    this.tokenService = params.tokenService;
    this.stateStore = params.stateStore;
    this.passphrase = params.passphrase;
  }

  private ensureAgent(agentId: string): Keypair {
    const keystorePath = this.walletManager.keystorePathForAgent(agentId);
    if (fs.existsSync(keystorePath)) {
      return this.walletManager.loadEncryptedKeypair(agentId, this.passphrase);
    }
    const kp = this.walletManager.createKeypair();
    this.walletManager.saveEncryptedKeypair(agentId, kp, this.passphrase);
    return kp;
  }

  async run(cfg: HarnessConfig) {
    const guardrails = Guardrails.fromEnv();

    // Guardrails: only token programs allowed in harness
    guardrails.assertProgramsAllowed("step6:token-programs", [PROGRAMS.TOKEN, PROGRAMS.ATA]);

    const state = this.stateStore.load();
    if (!state.mint?.address) {
      throw new Error(
        `state.json has no mint. Run Step 5 once first to create/persist the mint. Path: ${this.stateStore.getPath()}`
      );
    }

    const mint = new PublicKey(state.mint.address);
    const decimals = state.mint.decimals;
    state.atas = state.atas ?? {};

    // Bank agent: payer/mint authority for fees + minting
    const bank = this.ensureAgent("agent-001");

    console.log(chalk.gray("Using mint:"), mint.toBase58());
    console.log(chalk.gray("Decimals:"), String(decimals));
    console.log(chalk.gray("Bank agent (payer):"), bank.publicKey.toBase58());

    const agents: { id: string; kp: Keypair; ata: PublicKey }[] = [];
    for (let i = 1; i <= cfg.agentCount; i++) {
      const id = `agent-${String(i).padStart(3, "0")}`;
      const kp = this.ensureAgent(id);

      if (!state.atas[id]) {
        const ata = await this.tokenService.getOrCreateAta({
          payer: bank,
          mint,
          owner: kp.publicKey,
        });
        state.atas[id] = ata.toBase58();
        this.stateStore.save(state);
      }

      agents.push({ id, kp, ata: new PublicKey(state.atas[id]) });
    }

    // Seed tokens once (if agent has 0)
    const seedRaw = BigInt(cfg.seedTokensPerAgent) * BigInt(10 ** decimals);
    if (seedRaw > BigInt(0)) {
      // Guardrails: cap seed amount too (prevents accidental massive mints)
      guardrails.assertTokenAmount("step6:seed-mint", seedRaw, decimals);
    }

    for (const a of agents) {
      const balRaw = await this.tokenService.getTokenAccountAmountRaw({ ata: a.ata });
      if (balRaw === BigInt(0) && seedRaw > BigInt(0)) {
        const sig = await this.tokenService.mintTo({
          payer: bank,
          mint,
          destinationAta: a.ata,
          mintAuthority: bank,
          amountRaw: seedRaw,
        });
        console.log(
          chalk.green(`Seeded ${a.id} +${cfg.seedTokensPerAgent} tokens`),
          chalk.gray(sig)
        );
      }
    }

    for (let round = 1; round <= cfg.rounds; round++) {
      console.log("\n" + chalk.bold(`===== Round ${round}/${cfg.rounds} =====`));

      for (let idx = 0; idx < agents.length; idx++) {
        const agent = agents[idx];
        const next = agents[(idx + 1) % agents.length];

        const balRaw = await this.tokenService.getTokenAccountAmountRaw({ ata: agent.ata });

        const thresholdRaw = BigInt(20) * BigInt(10 ** decimals);
        const sendRaw = BigInt(2) * BigInt(10 ** decimals);

        if (balRaw > thresholdRaw) {
          // Guardrails: cap each transfer amount
          guardrails.assertTokenAmount("step6:agent-transfer", sendRaw, decimals);

          const sig = await this.tokenService.transfer({
            payer: bank, // bank pays fee (we can upgrade later so agents pay their own fees)
            sourceAta: agent.ata,
            destinationAta: next.ata,
            owner: agent.kp, // agent signs (autonomous)
            amountRaw: sendRaw,
          });

          console.log(
            chalk.blue(`🤖 ${agent.id} → ${next.id}`),
            chalk.white(`sent 2 tokens`),
            chalk.gray(sig)
          );
        }
      }

      console.log(chalk.bold("\nBalances:"));
      for (const a of agents) {
        const balRaw = await this.tokenService.getTokenAccountAmountRaw({ ata: a.ata });
        console.log(
          chalk.gray(a.id.padEnd(10)),
          chalk.yellow(formatTokens(balRaw, decimals).padStart(10)),
          chalk.gray(a.kp.publicKey.toBase58().slice(0, 6) + "…" + a.kp.publicKey.toBase58().slice(-6))
        );
      }
    }

    console.log(chalk.bold.green("\nStep 6 complete ✅ Multi-agent harness ran successfully."));
  }
}

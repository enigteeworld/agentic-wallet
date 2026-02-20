import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

// Common program IDs
export const PROGRAMS = {
  SYSTEM: SystemProgram.programId,
  // SPL Token Program (Tokenkeg...)
  TOKEN: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  // Associated Token Account Program
  ATA: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
};

export type GuardrailsConfig = {
  enabled: boolean;
  killSwitch: boolean;

  maxSolPerTx: number;       // e.g. 0.1
  maxTokensPerTx: number;    // whole tokens (based on mint decimals)
  maxActionsPerRun: number;  // e.g. 20

  allowPrograms: PublicKey[];
};

export class Guardrails {
  private actions = 0;
  constructor(private readonly cfg: GuardrailsConfig) {}

  static fromEnv(): Guardrails {
    const enabled = (process.env.GUARDRAILS_ENABLED ?? "1") !== "0";
    const killSwitch = (process.env.KILL_SWITCH ?? "0") === "1";

    const maxSolPerTx = Number(process.env.MAX_SOL_PER_TX ?? "0.1");
    const maxTokensPerTx = Number(process.env.MAX_TOKENS_PER_TX ?? "50");
    const maxActionsPerRun = Number(process.env.MAX_ACTIONS_PER_RUN ?? "25");

    return new Guardrails({
      enabled,
      killSwitch,
      maxSolPerTx,
      maxTokensPerTx,
      maxActionsPerRun,
      allowPrograms: [PROGRAMS.SYSTEM, PROGRAMS.TOKEN, PROGRAMS.ATA],
    });
  }

  private bumpActionOrThrow(label: string) {
    if (!this.cfg.enabled) return;
    if (this.cfg.killSwitch) throw new Error(`[GUARDRAILS] KILL_SWITCH active. Blocked: ${label}`);

    this.actions += 1;
    if (this.actions > this.cfg.maxActionsPerRun) {
      throw new Error(
        `[GUARDRAILS] Max actions per run exceeded (${this.cfg.maxActionsPerRun}). Blocked: ${label}`
      );
    }
  }

  assertProgramsAllowed(label: string, programIds: PublicKey[]) {
    if (!this.cfg.enabled) return;
    this.bumpActionOrThrow(label);

    for (const pid of programIds) {
      const ok = this.cfg.allowPrograms.some((a) => a.equals(pid));
      if (!ok) {
        throw new Error(`[GUARDRAILS] Program not allowed: ${pid.toBase58()} (${label})`);
      }
    }
  }

  assertSolTransfer(label: string, solAmount: number) {
    if (!this.cfg.enabled) return;
    this.bumpActionOrThrow(label);

    if (!Number.isFinite(solAmount) || solAmount <= 0) {
      throw new Error(`[GUARDRAILS] Invalid SOL amount: ${solAmount} (${label})`);
    }
    if (solAmount > this.cfg.maxSolPerTx) {
      throw new Error(
        `[GUARDRAILS] SOL amount ${solAmount} exceeds MAX_SOL_PER_TX ${this.cfg.maxSolPerTx} (${label})`
      );
    }
  }

  assertTokenAmount(label: string, amountRaw: bigint, decimals: number) {
    if (!this.cfg.enabled) return;
    this.bumpActionOrThrow(label);

    if (amountRaw <= BigInt(0)) {
      throw new Error(`[GUARDRAILS] Invalid token amountRaw: ${amountRaw.toString()} (${label})`);
    }

    const base = BigInt(10) ** BigInt(decimals);
    const wholeTokens = Number(amountRaw / base);

    if (wholeTokens > this.cfg.maxTokensPerTx) {
      throw new Error(
        `[GUARDRAILS] Token amount ${wholeTokens} exceeds MAX_TOKENS_PER_TX ${this.cfg.maxTokensPerTx} (${label})`
      );
    }
  }

  // Helpers if you want lamport-level checks later
  solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }
}

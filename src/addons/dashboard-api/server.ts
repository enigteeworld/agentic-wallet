import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { Connection, PublicKey } from "@solana/web3.js";

import { WalletManager } from "../../wallet/walletManager";
import { SplTokenService } from "../../token/splTokenService";
import { StateStore } from "../../state/stateStore";

import { runStep3 } from "../../demos/step3";
import { runStep4 } from "../../demos/step4";
import { runStep5 } from "../../demos/step5";
import { runStep6 } from "../../demos/step6";

import { isAgentRegistered, registerAgentOnChain } from "../../registry/agentRegistry";

const exec = promisify(execCb);

type StatusResponse = {
  ok: true;
  network: "devnet";
  rpcUrl: string;
  mint: { address: string; decimals: number } | null;

  registry: {
    programId: string | null;
    enabled: boolean;
  };

  agents: Array<{
    id: string;
    address: string;
    sol: number | null;
    ata: string | null;
    tokenRaw: string | null;

    registryPda: string | null;
    registryRegistered: boolean | null;

    errors?: string[];
  }>;

  warnings: string[];
  updatedAt: string;
};

type ActionOk<T> = { ok: true } & T;
type ActionErr = { ok: false; error: string };

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.DASH_API_PORT ?? "8899");
const AGENT_COUNT = Number(process.env.DASH_AGENT_COUNT ?? "5");

function agentId(i: number) {
  return `agent-${String(i).padStart(3, "0")}`;
}

function requirePassphraseOrThrow() {
  const passphrase = process.env.KEYSTORE_PASSPHRASE;
  if (!passphrase) throw new Error("Missing KEYSTORE_PASSPHRASE in .env");
  return passphrase;
}

function rpcUrlOrThrow() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
  return rpcUrl;
}

function ensureAgentKeypair(params: {
  id: string;
  walletManager: WalletManager;
  passphrase: string;
}) {
  const { id, walletManager, passphrase } = params;

  const filepath = walletManager.keystorePathForAgent(id);
  if (fs.existsSync(filepath)) {
    return walletManager.loadEncryptedKeypair(id, passphrase);
  }

  const kp = walletManager.createKeypair();
  walletManager.saveEncryptedKeypair(id, kp, passphrase);
  return kp;
}

function getRegistryProgramId(): PublicKey | null {
  const v = process.env.AGENT_REGISTRY_PROGRAM_ID;
  if (!v) return null;

  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
}

function registryPda(programId: PublicKey, agent: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agent.toBuffer()],
    programId
  );
  return pda;
}

function explorerTx(sig: string) {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/api/status", async (_req: Request, res: Response) => {
  const warnings: string[] = [];

  try {
    const passphrase = requirePassphraseOrThrow();
    const rpcUrl = rpcUrlOrThrow();
    const connection = new Connection(rpcUrl, "confirmed");

    // Lightweight RPC sanity check
    try {
      await connection.getLatestBlockhash("confirmed");
    } catch (e: any) {
      warnings.push(`RPC health check failed (continuing): ${String(e?.message ?? e)}`);
    }

    const walletManager = new WalletManager(connection);
    const tokenService = new SplTokenService(connection);
    const stateStore = new StateStore();
    const state = stateStore.load();

    const mint = state.mint?.address
      ? { address: state.mint.address, decimals: state.mint.decimals }
      : null;

    const registryProgramId = getRegistryProgramId();
    if (process.env.AGENT_REGISTRY_PROGRAM_ID && !registryProgramId) {
      warnings.push("AGENT_REGISTRY_PROGRAM_ID is set but invalid (not a PublicKey). Registry disabled.");
    }

    const agents: StatusResponse["agents"] = [];

    for (let i = 1; i <= AGENT_COUNT; i++) {
      const id = agentId(i);
      const agentErrors: string[] = [];

      const kp = ensureAgentKeypair({ id, walletManager, passphrase });
      const address = kp.publicKey.toBase58();

      // SOL
      let sol: number | null = null;
      try {
        const solLamports = await connection.getBalance(kp.publicKey, "confirmed");
        sol = solLamports / 1_000_000_000;
      } catch (e: any) {
        sol = null;
        agentErrors.push(`getBalance failed: ${String(e?.message ?? e)}`);
      }

      // Tokens
      let ata: string | null = null;
      let tokenRaw: string | null = null;

      if (mint && state.atas?.[id]) {
        ata = state.atas[id];
        try {
          const amt = await tokenService.getTokenAccountAmountRaw({ ata: new PublicKey(ata) });
          tokenRaw = amt.toString();
        } catch (e: any) {
          tokenRaw = null;
          agentErrors.push(`getTokenAccountAmountRaw failed: ${String(e?.message ?? e)}`);
        }
      }

      // Registry check
      let registryPdaAddr: string | null = null;
      let registryRegistered: boolean | null = null;

      if (registryProgramId) {
        try {
          const pda = registryPda(registryProgramId, kp.publicKey);
          registryPdaAddr = pda.toBase58();
          const info = await connection.getAccountInfo(pda, "confirmed");
          registryRegistered = !!info;
        } catch (e: any) {
          registryRegistered = null;
          agentErrors.push(`registry check failed: ${String(e?.message ?? e)}`);
        }
      }

      agents.push({
        id,
        address,
        sol,
        ata,
        tokenRaw,
        registryPda: registryPdaAddr,
        registryRegistered,
        ...(agentErrors.length ? { errors: agentErrors } : {}),
      });
    }

    const payload: StatusResponse = {
      ok: true,
      network: "devnet",
      rpcUrl,
      mint,
      registry: {
        programId: registryProgramId ? registryProgramId.toBase58() : null,
        enabled: !!registryProgramId,
      },
      agents,
      warnings,
      updatedAt: new Date().toISOString(),
    };

    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/**
 * =========================
 * ACTIONS (Local App)
 * =========================
 * IMPORTANT: this is local-only. The UI triggers actions, but signing stays here.
 */

app.post("/api/actions/step3", async (req: Request, res: Response) => {
  try {
    requirePassphraseOrThrow(); // ensures .env set
    const rpcUrl = rpcUrlOrThrow();
    const amountSol = Number(req.body?.amountSol ?? 0.05);

    await runStep3({ rpcUrl, amountSol });

    const out: ActionOk<{ ran: "step3"; amountSol: number }> = { ok: true, ran: "step3", amountSol };
    return res.status(200).json(out);
  } catch (e: any) {
    const out: ActionErr = { ok: false, error: String(e?.message ?? e) };
    return res.status(500).json(out);
  }
});

app.post("/api/actions/step4", async (_req: Request, res: Response) => {
  try {
    requirePassphraseOrThrow();
    const rpcUrl = rpcUrlOrThrow();

    await runStep4({ rpcUrl });

    const out: ActionOk<{ ran: "step4" }> = { ok: true, ran: "step4" };
    return res.status(200).json(out);
  } catch (e: any) {
    const out: ActionErr = { ok: false, error: String(e?.message ?? e) };
    return res.status(500).json(out);
  }
});

app.post("/api/actions/step5", async (_req: Request, res: Response) => {
  try {
    requirePassphraseOrThrow();
    const rpcUrl = rpcUrlOrThrow();

    await runStep5({ rpcUrl });

    const out: ActionOk<{ ran: "step5" }> = { ok: true, ran: "step5" };
    return res.status(200).json(out);
  } catch (e: any) {
    const out: ActionErr = { ok: false, error: String(e?.message ?? e) };
    return res.status(500).json(out);
  }
});

app.post("/api/actions/step6", async (req: Request, res: Response) => {
  try {
    requirePassphraseOrThrow();
    const rpcUrl = rpcUrlOrThrow();

    const agents = Number(req.body?.agents ?? 5);
    const rounds = Number(req.body?.rounds ?? 1);
    const seed = Number(req.body?.seed ?? 25);

    await runStep6({ rpcUrl, agents, rounds, seed });

    const out: ActionOk<{ ran: "step6"; agents: number; rounds: number; seed: number }> = {
      ok: true,
      ran: "step6",
      agents,
      rounds,
      seed,
    };
    return res.status(200).json(out);
  } catch (e: any) {
    const out: ActionErr = { ok: false, error: String(e?.message ?? e) };
    return res.status(500).json(out);
  }
});

// Registry: register single agent
app.post("/api/actions/registry/register", async (req: Request, res: Response) => {
  try {
    const passphrase = requirePassphraseOrThrow();
    const rpcUrl = rpcUrlOrThrow();
    const connection = new Connection(rpcUrl, "confirmed");

    const registryProgramId = getRegistryProgramId();
    if (!registryProgramId) {
      const out: ActionErr = { ok: false, error: "Registry not enabled. Set AGENT_REGISTRY_PROGRAM_ID in .env" };
      return res.status(400).json(out);
    }

    const { agent, agentId: agentIdString, version } = (req.body ?? {}) as {
      agent?: string;
      agentId?: string;
      version?: string;
    };

    if (!agent || !agentIdString || !version) {
      const out: ActionErr = { ok: false, error: "Missing body fields. Required: { agent, agentId, version }" };
      return res.status(400).json(out);
    }

    const walletManager = new WalletManager(connection);
    const kp = ensureAgentKeypair({ id: agent, walletManager, passphrase });

    const status = await isAgentRegistered({ connection, agent: kp.publicKey });
    if (status.registered) {
      const out: ActionOk<{ already: true; registry: string; programId: string }> = {
        ok: true,
        already: true,
        registry: status.registry.toBase58(),
        programId: status.programId.toBase58(),
      };
      return res.status(200).json(out);
    }

    const result = await registerAgentOnChain({
      connection,
      agentKeypair: kp,
      agentId: String(agentIdString),
      version: String(version),
    });

    const out: ActionOk<{ signature: string; explorer: string; registry: string; programId: string }> = {
      ok: true,
      signature: result.signature,
      explorer: explorerTx(result.signature),
      registry: result.registry.toBase58(),
      programId: result.programId.toBase58(),
    };
    return res.status(200).json(out);
  } catch (e: any) {
    const out: ActionErr = { ok: false, error: String(e?.message ?? e) };
    return res.status(500).json(out);
  }
});

// Jupiter swap pipeline (dry-run by default)
app.post("/api/actions/jupiter/dryrun", async (req: Request, res: Response) => {
  try {
    requirePassphraseOrThrow();

    const agent = String(req.body?.agent ?? "agent-001");
    const sol = Number(req.body?.sol ?? 0.02);
    const slippageBps = Number(req.body?.slippageBps ?? 100);
    const cluster = String(req.body?.cluster ?? "mainnet-beta");

    // repo root (server.ts is in src/addons/dashboard-api)
    const cwd = path.resolve(__dirname, "../../..");

    // dry-run = no --execute
    const cmd = `npx ts-node src/addons/jupiter/jupiterSwap.ts --agent ${agent} --sol ${sol} --slippageBps ${slippageBps} --cluster ${cluster}`;

    const { stdout, stderr } = await exec(cmd, {
      cwd,
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });

    const out: ActionOk<{ ran: "jupiter:dryrun"; agent: string; sol: number; slippageBps: number; cluster: string; stdout: string; stderr: string }> =
      {
        ok: true,
        ran: "jupiter:dryrun",
        agent,
        sol,
        slippageBps,
        cluster,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
      };

    return res.status(200).json(out);
  } catch (e: any) {
    const out: ActionErr = { ok: false, error: String(e?.message ?? e) };
    return res.status(500).json(out);
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard API running: http://localhost:${PORT}`);
  console.log(`GET  /api/status`);
  console.log(`POST /api/actions/step3`);
  console.log(`POST /api/actions/step4`);
  console.log(`POST /api/actions/step5`);
  console.log(`POST /api/actions/step6`);
  console.log(`POST /api/actions/registry/register`);
  console.log(`POST /api/actions/jupiter/dryrun`);
});
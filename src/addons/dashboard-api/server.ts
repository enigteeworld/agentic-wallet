import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import fs from "fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { WalletManager } from "../../wallet/walletManager";
import { SplTokenService } from "../../token/splTokenService";
import { StateStore } from "../../state/stateStore";

type StatusResponse = {
  ok: true;
  network: "devnet";
  rpcUrl: string;
  mint: { address: string; decimals: number } | null;

  // ✅ New: registry metadata (if configured)
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

    // ✅ New: registry proof per agent
    registryPda: string | null;
    registryRegistered: boolean | null;

    errors?: string[];
  }>;
  warnings: string[];
  updatedAt: string;
};

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.DASH_API_PORT ?? "8899");
const AGENT_COUNT = Number(process.env.DASH_AGENT_COUNT ?? "5");

function agentId(i: number) {
  return `agent-${String(i).padStart(3, "0")}`;
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

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/api/status", async (_req: Request, res: Response) => {
  const warnings: string[] = [];

  try {
    const passphrase = process.env.KEYSTORE_PASSPHRASE;
    if (!passphrase) {
      return res.status(500).json({ ok: false, error: "Missing KEYSTORE_PASSPHRASE in .env" });
    }

    // Deterministic: use ENV RPC only
    const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    // Lightweight RPC sanity check (but don't crash the endpoint)
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

      // SOL balance (safe)
      let sol: number | null = null;
      try {
        const solLamports = await connection.getBalance(kp.publicKey, "confirmed");
        sol = solLamports / 1_000_000_000;
      } catch (e: any) {
        sol = null;
        agentErrors.push(`getBalance failed: ${String(e?.message ?? e)}`);
      }

      // Token amount (safe)
      let ata: string | null = null;
      let tokenRaw: string | null = null;

      if (mint && state.atas?.[id]) {
        ata = state.atas[id];
        try {
          const amt = await tokenService.getTokenAccountAmountRaw({
            ata: new PublicKey(ata),
          });
          tokenRaw = amt.toString();
        } catch (e: any) {
          tokenRaw = null;
          agentErrors.push(`getTokenAccountAmountRaw failed: ${String(e?.message ?? e)}`);
        }
      }

      // ✅ Registry status (safe)
      let registryPdaAddr: string | null = null;
      let registryRegistered: boolean | null = null;

      if (registryProgramId) {
        try {
          const pda = registryPda(registryProgramId, kp.publicKey);
          registryPdaAddr = pda.toBase58();

          const info = await connection.getAccountInfo(pda, "confirmed");
          registryRegistered = !!info;
        } catch (e: any) {
          registryPdaAddr = registryPdaAddr ?? null;
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

    // ✅ ALWAYS return 200 for transient RPC issues (read-only dashboard)
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard API running: http://localhost:${PORT}`);
  console.log(`GET /api/status -> mint + balances + agent list (read-only)`);
});
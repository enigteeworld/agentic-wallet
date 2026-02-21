import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export function getRegistryProgramIdOrThrow(): PublicKey {
  const v = process.env.AGENT_REGISTRY_PROGRAM_ID;
  if (!v) throw new Error("Missing AGENT_REGISTRY_PROGRAM_ID in .env");
  return new PublicKey(v);
}

export function registryPda(programId: PublicKey, agent: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agent.toBuffer()],
    programId
  );
  return pda;
}

// Cache the fetched IDL so we only pull it once per process
let _cachedProgram: anchor.Program | null = null;

async function getRegistryProgramOrThrow(connection: Connection, signer: Keypair) {
  if (_cachedProgram) return _cachedProgram;

  const programId = getRegistryProgramIdOrThrow();

  const wallet = new anchor.Wallet(signer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // ✅ Pull the IDL from chain (the one anchor deploy created)
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) {
    throw new Error(
      `Unable to fetch IDL for program ${programId.toBase58()}. ` +
        `This usually means the IDL account was not created or the RPC cannot read it.`
    );
  }

  // Anchor 0.32+ constructor style
  _cachedProgram = new anchor.Program(idl, provider);
  return _cachedProgram;
}

export async function registerAgentOnChain(params: {
  connection: Connection;
  agentKeypair: Keypair;
  agentId: string;
  version: string;
}): Promise<{ signature: string; registry: PublicKey; programId: PublicKey }> {
  const programId = getRegistryProgramIdOrThrow();
  const agent = params.agentKeypair.publicKey;
  const registry = registryPda(programId, agent);

  const program = await getRegistryProgramOrThrow(params.connection, params.agentKeypair);

  // IMPORTANT:
  // With fetched IDL, the method names will match whatever was deployed.
  // Your Rust uses register_agent, so this should exist.
  const signature = await program.methods
  .registerAgent(params.agentId, params.version)
    .accounts({
      agent,
      registry,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  return { signature, registry, programId };
}

export async function isAgentRegistered(params: {
  connection: Connection;
  agent: PublicKey;
}): Promise<{ registered: boolean; registry: PublicKey; programId: PublicKey }> {
  const programId = getRegistryProgramIdOrThrow();
  const registry = registryPda(programId, params.agent);

  // This is a plain account existence check (no Anchor needed)
  const info = await params.connection.getAccountInfo(registry, "confirmed");
  return { registered: !!info, registry, programId };
}
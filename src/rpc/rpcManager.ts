import { Connection } from "@solana/web3.js";

type RpcCandidate = {
  name: string;
  url: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canUseRpc(url: string): Promise<boolean> {
  try {
    const conn = new Connection(url, "confirmed");
    // Very lightweight call; if provider blocks it, we’ll know immediately.
    await conn.getLatestBlockhash("confirmed");
    return true;
  } catch {
    return false;
  }
}

export async function getHealthyConnection(preferredUrl?: string) {
  const candidates: RpcCandidate[] = [];

  // 1) User-specified RPC first (if provided)
  if (preferredUrl) {
    candidates.push({ name: "ENV_RPC_URL", url: preferredUrl });
  }

  // 2) Known public Solana devnet endpoint
  candidates.push({ name: "SOLANA_PUBLIC_DEVNET", url: "https://api.devnet.solana.com" });

  // 3) A couple extra public endpoints people commonly use (may vary over time)
  // If these ever become flaky, we can replace them.
  candidates.push({ name: "ANKR_DEVNET", url: "https://rpc.ankr.com/solana_devnet" });
  candidates.push({ name: "CHAINSTACK_DEVNET", url: "https://solana-devnet.core.chainstack.com" });

  let lastErr: unknown = null;

  for (const c of candidates) {
    const ok = await canUseRpc(c.url);
    if (ok) {
      return {
        connection: new Connection(c.url, "confirmed"),
        rpcName: c.name,
        rpcUrl: c.url,
      };
    } else {
      // small delay to avoid hammering
      await sleep(150);
      lastErr = new Error(`RPC failed health check: ${c.name} (${c.url})`);
    }
  }

  throw lastErr ?? new Error("No healthy RPC endpoints available.");
}

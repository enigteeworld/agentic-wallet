import { arbitrumSepolia } from "viem/chains";

export const ARBITRUM_DEFAULT_CHAIN = arbitrumSepolia;

export function getArbitrumRpcUrl(): string {
  const envRpc = process.env.ARBITRUM_RPC_URL?.trim();
  if (envRpc) return envRpc;

  const fallbackRpc = ARBITRUM_DEFAULT_CHAIN.rpcUrls.default.http[0];
  if (fallbackRpc) return fallbackRpc;

  throw new Error("Missing Arbitrum RPC URL. Set ARBITRUM_RPC_URL in .env");
}

export function getArbitrumReadConfig() {
  return {
    chain: ARBITRUM_DEFAULT_CHAIN,
    rpcUrl: getArbitrumRpcUrl(),
  };
}
import { createPublicClient, http } from "viem";
import { getArbitrumReadConfig } from "./config";

export function createArbitrumPublicClient() {
  const { chain, rpcUrl } = getArbitrumReadConfig();

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
}
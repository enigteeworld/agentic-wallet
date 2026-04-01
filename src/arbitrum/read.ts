import {
  type Address,
  formatEther,
  formatUnits,
} from "viem";
import { createArbitrumPublicClient } from "./client";
import { getArbitrumReadConfig } from "./config";
import { chainlinkAggregatorV3Abi, erc20Abi } from "./abis";
import type {
  ArbitrumChainStatus,
  ArbitrumNativeBalance,
  ArbitrumPriceFeedRead,
  ArbitrumTokenBalance,
  ArbitrumWalletSnapshot,
} from "./types";

function toIsoFromUnixSeconds(value: bigint): string {
  return new Date(Number(value) * 1000).toISOString();
}

export async function readArbitrumChainStatus(): Promise<ArbitrumChainStatus> {
  const client = createArbitrumPublicClient();
  const { chain, rpcUrl } = getArbitrumReadConfig();

  const [block, gasPrice] = await Promise.all([
    client.getBlock(),
    client.getGasPrice(),
  ]);

  return {
    chainId: chain.id,
    chainName: chain.name,
    blockNumber: block.number?.toString() ?? "0",
    blockHash: block.hash ?? "",
    blockTimestamp: toIsoFromUnixSeconds(block.timestamp),
    gasPriceWei: gasPrice.toString(),
    nativeSymbol: chain.nativeCurrency.symbol,
    rpcUrl,
  };
}

export async function readArbitrumNativeBalance(
  address: Address
): Promise<ArbitrumNativeBalance> {
  const client = createArbitrumPublicClient();
  const { chain } = getArbitrumReadConfig();

  const balance = await client.getBalance({ address });

  return {
    address,
    balanceWei: balance.toString(),
    balanceEth: formatEther(balance),
    symbol: chain.nativeCurrency.symbol,
  };
}

export async function readArbitrumTokenBalance(params: {
  tokenAddress: Address;
  walletAddress: Address;
  symbolOverride?: string;
  nameOverride?: string;
}): Promise<ArbitrumTokenBalance> {
  const client = createArbitrumPublicClient();

  const [name, symbol, decimals, rawBalance] = await Promise.all([
    params.nameOverride
      ? Promise.resolve(params.nameOverride)
      : client.readContract({
          address: params.tokenAddress,
          abi: erc20Abi,
          functionName: "name",
        }),
    params.symbolOverride
      ? Promise.resolve(params.symbolOverride)
      : client.readContract({
          address: params.tokenAddress,
          abi: erc20Abi,
          functionName: "symbol",
        }),
    client.readContract({
      address: params.tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: params.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [params.walletAddress],
    }),
  ]);

  return {
    tokenAddress: params.tokenAddress,
    walletAddress: params.walletAddress,
    symbol,
    name,
    decimals,
    rawBalance: rawBalance.toString(),
    formattedBalance: formatUnits(rawBalance, decimals),
  };
}

export async function readArbitrumWalletSnapshot(params: {
  walletAddress: Address;
  tokenAddresses?: Address[];
}): Promise<ArbitrumWalletSnapshot> {
  const client = createArbitrumPublicClient();

  const [native, nonce] = await Promise.all([
    readArbitrumNativeBalance(params.walletAddress),
    client.getTransactionCount({ address: params.walletAddress }),
  ]);

  const tokenBalances: ArbitrumTokenBalance[] = [];

  for (const tokenAddress of params.tokenAddresses ?? []) {
    const tokenBalance = await readArbitrumTokenBalance({
      tokenAddress,
      walletAddress: params.walletAddress,
    });
    tokenBalances.push(tokenBalance);
  }

  return {
    address: params.walletAddress,
    native,
    nonce,
    tokenBalances,
  };
}

export async function readArbitrumPriceFeed(
  feedAddress: Address
): Promise<ArbitrumPriceFeedRead> {
  const client = createArbitrumPublicClient();

  const [decimals, description, latestRoundData] = await Promise.all([
    client.readContract({
      address: feedAddress,
      abi: chainlinkAggregatorV3Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: feedAddress,
      abi: chainlinkAggregatorV3Abi,
      functionName: "description",
    }),
    client.readContract({
      address: feedAddress,
      abi: chainlinkAggregatorV3Abi,
      functionName: "latestRoundData",
    }),
  ]);

  const [roundId, answer, _startedAt, updatedAt] = latestRoundData;

  return {
    feedAddress,
    description,
    decimals,
    roundId: roundId.toString(),
    answer: answer.toString(),
    updatedAt: toIsoFromUnixSeconds(updatedAt),
  };
}
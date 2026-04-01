export type ArbitrumChainStatus = {
  chainId: number;
  chainName: string;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  gasPriceWei: string;
  nativeSymbol: string;
  rpcUrl: string;
};

export type ArbitrumNativeBalance = {
  address: string;
  balanceWei: string;
  balanceEth: string;
  symbol: string;
};

export type ArbitrumTokenBalance = {
  tokenAddress: string;
  walletAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: string;
  formattedBalance: string;
};

export type ArbitrumPriceFeedRead = {
  feedAddress: string;
  description?: string;
  decimals: number;
  roundId: string;
  answer: string;
  updatedAt: string;
};

export type ArbitrumWalletSnapshot = {
  address: string;
  native: ArbitrumNativeBalance;
  nonce: number;
  tokenBalances: ArbitrumTokenBalance[];
};
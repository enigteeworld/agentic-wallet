import { request } from "undici";

const MAINNET_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};

const MINT_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(MAINNET_MINTS).map(([symbol, mint]) => [mint, symbol])
);

const JUP_PRICE_BASE = process.env.JUP_PRICE_BASE_URL ?? "https://api.jup.ag";

type JupiterPriceV3Response = Record<
  string,
  {
    usdPrice?: number;
  }
>;

function resolveMintAddress(symbolOrMint: string): string {
  return MAINNET_MINTS[symbolOrMint] ?? symbolOrMint;
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (process.env.JUP_API_KEY) {
    headers["x-api-key"] = process.env.JUP_API_KEY;
  }

  const res = await request(url, {
    method: "GET",
    headers,
  });

  const text = await res.body.text();

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`GET ${url} failed (${res.statusCode}): ${text}`);
  }

  return JSON.parse(text) as T;
}

export async function fetchVaultPrices(
  symbols: string[]
): Promise<Record<string, number>> {
  const uniqueSymbols = [...new Set(symbols)];
  const ids = uniqueSymbols
    .map((symbol) => resolveMintAddress(symbol))
    .filter(Boolean);

  const prices: Record<string, number> = {
    USDC: 1,
    [MAINNET_MINTS.USDC]: 1,
  };

  if (ids.length === 0) {
    return prices;
  }

  try {
    const url = `${JUP_PRICE_BASE}/price/v3?ids=${encodeURIComponent(ids.join(","))}`;
    const data = await fetchJson<JupiterPriceV3Response>(url);

    for (const mint of ids) {
      const usdPrice = data?.[mint]?.usdPrice;
      if (typeof usdPrice === "number" && Number.isFinite(usdPrice)) {
        prices[mint] = usdPrice;

        const symbol = MINT_TO_SYMBOL[mint];
        if (symbol) {
          prices[symbol] = usdPrice;
        }
      }
    }
  } catch {
    // Keep safe fallback prices only.
  }

  return prices;
}

export function resolveTrackedMint(symbolOrMint: string): string {
  return resolveMintAddress(symbolOrMint);
}
import "dotenv/config";
import express from "express";
import cors from "cors";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWalletClient,
  createPublicClient,
  formatEther,
  http,
  parseEther,
} from "viem";
import { arbitrumSepolia } from "viem/chains";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

const rpcUrl =
  process.env.ARBITRUM_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

const privateKey = process.env.ARBITRUM_PRIVATE_KEY as `0x${string}` | undefined;

if (!privateKey) {
  throw new Error("Missing ARBITRUM_PRIVATE_KEY in environment.");
}

const account = privateKeyToAccount(privateKey);

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});

const walletClient = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport: http(rpcUrl),
});

async function buildReadPayload() {
  const [blockNumber, gasPrice, balance] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: account.address }),
  ]);

  return {
    ok: true,
    address: account.address,
    chainId: arbitrumSepolia.id,
    chainName: arbitrumSepolia.name,
    blockNumber: blockNumber.toString(),
    gasPriceWei: gasPrice.toString(),
    nativeBalanceWei: balance.toString(),
    nativeBalanceEth: formatEther(balance),
    nativeSymbol: arbitrumSepolia.nativeCurrency.symbol,
    rpcUrl,
  };
}

app.get("/health", async (_req, res) => {
  try {
    const blockNumber = await publicClient.getBlockNumber();

    res.json({
      ok: true,
      service: "corsair-arbitrum-server",
      chainId: arbitrumSepolia.id,
      chainName: arbitrumSepolia.name,
      blockNumber: blockNumber.toString(),
      address: account.address,
      ts: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: String(error?.message ?? error),
    });
  }
});

/**
 * Supports direct browser/curl testing:
 * GET http://127.0.0.1:3001/read
 */
app.get("/read", async (_req, res) => {
  try {
    const payload = await buildReadPayload();
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: String(error?.message ?? error),
    });
  }
});

/**
 * Supports chat/backend integrations that may call POST /read
 * with or without a JSON body.
 */
app.post("/read", async (_req, res) => {
  try {
    const payload = await buildReadPayload();
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({
      ok: false,
      error: String(error?.message ?? error),
    });
  }
});

app.post("/action/send", async (req, res) => {
  try {
    const { to, amount } = req.body ?? {};

    if (typeof to !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
      res.status(400).json({
        success: false,
        error: "Invalid `to` address.",
      });
      return;
    }

    if (typeof amount !== "string" || Number(amount) <= 0) {
      res.status(400).json({
        success: false,
        error: "Invalid `amount`.",
      });
      return;
    }

    const hash = await walletClient.sendTransaction({
      account,
      to: to as `0x${string}`,
      value: parseEther(amount),
      chain: arbitrumSepolia,
    });

    res.json({
      success: true,
      hash,
      to,
      amount,
      chainId: arbitrumSepolia.id,
      chainName: arbitrumSepolia.name,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: String(error?.message ?? error),
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health: http://127.0.0.1:${port}/health`);
  console.log(`Read (GET): http://127.0.0.1:${port}/read`);
  console.log(`Read (POST): http://127.0.0.1:${port}/read`);
  console.log(`Send: POST http://127.0.0.1:${port}/action/send`);
});
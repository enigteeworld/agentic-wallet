import "dotenv/config";
import {
  createWalletClient,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const account = privateKeyToAccount(
  process.env.ARBITRUM_PRIVATE_KEY as `0x${string}`
);

const client = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
});

async function main() {
  const to = process.argv[2]; // receiver address
  const amount = process.argv[3]; // ETH amount

  if (!to || !amount) {
    throw new Error("Usage: ts-node send.ts <to> <amount>");
  }

  console.log("Sending ETH...");
  console.log("From:", account.address);
  console.log("To:", to);
  console.log("Amount:", amount);

  const hash = await client.sendTransaction({
    to: to as `0x${string}`,
    value: parseEther(amount),
  });

  console.log("Transaction sent:", hash);
}

main().catch((err) => {
  console.error("Send failed:", err);
});
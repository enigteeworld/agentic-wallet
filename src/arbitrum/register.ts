import "dotenv/config";
import {
  createWalletClient,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

const REGISTRY_ADDRESS =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e"; // Arbitrum Sepolia

// Minimal ABI (adjust later if needed)
const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
] as const;

async function main() {
  const privateKey = process.env.ARBITRUM_PRIVATE_KEY as `0x${string}`;

  if (!privateKey) {
    throw new Error("Missing ARBITRUM_PRIVATE_KEY in .env");
  }

  const account = privateKeyToAccount(privateKey);

  const client = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_RPC_URL),
  });

  console.log("Registering agent with address:", account.address);

  const hash = await client.writeContract({
    address: REGISTRY_ADDRESS,
    abi: registryAbi,
    functionName: "register",
    args: [
      account.address,
      "https://github.com/enigteeworld/agentic-wallet/blob/feat/ranger-vault-frontend-prep/metadata.json",
    ],
  });

  console.log("Transaction sent:", hash);
}

main().catch((err) => {
  console.error("Registration failed:", err);
});
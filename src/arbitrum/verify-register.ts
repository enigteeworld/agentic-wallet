import "dotenv/config";
import { createPublicClient, http } from "viem";
import { arbitrumSepolia } from "viem/chains";

const txHash =
  "0xe01c40d45b6f192e42d2c7f97217541134ef28d1da4eeb490efa28cbbf492b91" as const;

async function main() {
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash });

  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        blockNumber: receipt.blockNumber.toString(),
        transactionHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Verify failed:", err);
});
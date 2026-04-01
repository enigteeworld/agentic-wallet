import "dotenv/config";
import { readArbitrumChainStatus } from "./read";

async function main() {
  const status = await readArbitrumChainStatus();
  console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
  console.error("Arbitrum read test failed:", error);
  process.exit(1);
});

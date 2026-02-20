import "dotenv/config";
import chalk from "chalk";
import boxen from "boxen";
import { loadEnv } from "./config/env";
import { getHealthyConnection } from "./rpc/rpcManager";
import { WalletManager } from "./wallet/walletManager";
import { SplTokenService } from "./token/splTokenService";
import { StateStore } from "./state/stateStore";
import { MultiAgentHarness } from "./harness/multiAgentHarness";

function header(title: string) {
  console.log(
    boxen(chalk.bold(title), {
      padding: 1,
      margin: 1,
      borderStyle: "round",
    })
  );
}

function infoLine(label: string, value: string) {
  console.log(chalk.cyan(label), value);
}

async function main() {
  header("Step 6 — Multi-Agent Harness (Devnet)");

  const env = loadEnv();
  const passphrase = env.KEYSTORE_PASSPHRASE;
  if (!passphrase) {
    console.log(
      chalk.red(
        "Missing KEYSTORE_PASSPHRASE. Add it to your .env file (at least 8 characters)."
      )
    );
    process.exit(1);
  }

  const { connection, rpcName, rpcUrl } = await getHealthyConnection(env.RPC_URL);
  infoLine("RPC Selected:", rpcName);
  infoLine("RPC URL:", rpcUrl);

  const walletManager = new WalletManager(connection);
  const tokenService = new SplTokenService(connection);
  const stateStore = new StateStore();

  const harness = new MultiAgentHarness({
    walletManager,
    tokenService,
    stateStore,
    passphrase,
  });

  await harness.run({
    agentCount: 5,
    rounds: 3,
    seedTokensPerAgent: 25,
  });
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});

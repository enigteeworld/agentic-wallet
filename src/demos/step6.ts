import { header, infoLine } from "../ui/print";
import { SplTokenService } from "../token/splTokenService";
import { StateStore } from "../state/stateStore";
import { MultiAgentHarness } from "../harness/multiAgentHarness";
import { setupOrExit } from "./common";

export async function runStep6(params?: {
  rpcUrl?: string;
  agents?: number;
  rounds?: number;
  seed?: number;
}) {
  header("Demo Step 6 — Multi-Agent Harness (Devnet)");

  const { connection, rpcName, rpcUrl, walletManager, passphrase } = await setupOrExit({
    rpcUrl: params?.rpcUrl,
  });

  infoLine("RPC Selected:", rpcName);
  infoLine("RPC URL:", rpcUrl);

  const tokenService = new SplTokenService(connection);
  const stateStore = new StateStore();

  const harness = new MultiAgentHarness({
    walletManager,
    tokenService,
    stateStore,
    passphrase,
  });

  await harness.run({
    agentCount: params?.agents ?? 5,
    rounds: params?.rounds ?? 3,
    seedTokensPerAgent: params?.seed ?? 25,
  });
}

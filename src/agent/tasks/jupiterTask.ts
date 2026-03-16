import { exec as execCb } from "child_process";
import { promisify } from "util";
import { loadAgentConfig } from "../config";
import {
  appendActionLog,
  createActionLog,
} from "../actionLogger";
import {
  appendDraftPost,
  createJupiterDraft,
} from "../xDrafts";
import {
  loadAgentMemory,
  markError,
  markJupiterSwapAttempt,
  markJupiterSwapSuccess,
  saveAgentMemory,
} from "../memory";

const exec = promisify(execCb);

export type JupiterTaskResult =
  | {
      ok: true;
      agentId: string;
      stdout: string;
      stderr: string;
      signature?: string;
    }
  | {
      ok: false;
      agentId: string;
      error: string;
    };

function extractSignature(stdout: string): string | undefined {
  const match = stdout.match(/Signature:\s+([A-Za-z0-9]+)/);
  return match?.[1];
}

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export async function runJupiterTask(params: {
  agentId: string;
  version: string;
  solAmount: number;
  slippageBps: number;
  cluster: "devnet" | "mainnet-beta";
  execute: boolean;
}): Promise<JupiterTaskResult> {
  const { agentId, version, solAmount, slippageBps, cluster, execute } = params;

  const config = loadAgentConfig({ agentId });
  let memory = loadAgentMemory({ agentId, version });

  try {
    memory = markJupiterSwapAttempt(memory);
    saveAgentMemory(memory);

    const cmdParts = [
      "npx",
      "ts-node",
      "src/addons/jupiter/jupiterSwap.ts",
      "--agent",
      agentId,
      "--sol",
      String(solAmount),
      "--slippageBps",
      String(slippageBps),
      "--cluster",
      cluster,
    ];

    if (execute) {
      cmdParts.push("--execute");
    }

    appendActionLog(
      createActionLog({
        agentId,
        action: "jupiter_swap",
        ok: true,
        reason: `${execute ? "Executing" : "Simulating"} Jupiter swap`,
        details: {
          command: cmdParts.join(" "),
          solAmount,
          slippageBps,
          cluster,
          execute,
        },
      })
    );

    const { stdout = "", stderr = "" } = await exec(cmdParts.join(" "), {
      cwd: process.cwd(),
      timeout: 180000,
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });

    const signature = extractSignature(stdout);
    const explorerUrl = signature ? explorerTxUrl(signature) : undefined;

    memory = markJupiterSwapSuccess(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "jupiter_swap",
        ok: true,
        reason: "Jupiter task completed successfully",
        details: {
          solAmount,
          slippageBps,
          cluster,
          execute,
          stdoutTail: stdout.slice(-1200),
          stderrTail: stderr.slice(-800),
        },
        signature,
        explorerUrl,
      })
    );

    appendDraftPost(
      createJupiterDraft({
        agentId,
        config,
        solAmount,
        execute,
        signature,
      })
    );

    return {
      ok: true,
      agentId,
      stdout,
      stderr,
      signature,
    };
  } catch (error: any) {
    memory = markError(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "jupiter_swap",
        ok: false,
        reason: String(error?.message ?? error),
        details: {
          solAmount,
          slippageBps,
          cluster,
          execute,
        },
      })
    );

    return {
      ok: false,
      agentId,
      error: String(error?.message ?? error),
    };
  }
}
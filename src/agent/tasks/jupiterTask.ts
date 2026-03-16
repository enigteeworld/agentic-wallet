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

const MINT_TO_SYMBOL: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUP",
};

export type JupiterExecutionSummary = {
  executedAt: string;
  execute: boolean;
  cluster: "devnet" | "mainnet-beta";
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount?: number;
  effectivePriceUsd?: number;
  feesUsd?: number;
  slippageBps: number;
  signature?: string;
  explorerUrl?: string;
  stdoutTail: string;
  stderrTail: string;
};

export type JupiterTaskResult =
  | {
      ok: true;
      agentId: string;
      stdout: string;
      stderr: string;
      signature?: string;
      explorerUrl?: string;
      execution: JupiterExecutionSummary;
    }
  | {
      ok: false;
      agentId: string;
      error: string;
      execution?: Partial<JupiterExecutionSummary>;
    };

function inferSymbol(mintOrSymbol: string): string {
  return MINT_TO_SYMBOL[mintOrSymbol] ?? mintOrSymbol;
}

function extractSignature(stdout: string): string | undefined {
  const match = stdout.match(/Signature:\s+([A-Za-z0-9]+)/);
  return match?.[1];
}

function extractField(stdout: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stdout.match(new RegExp(`${escaped}:\\s+(.+)`));
  return match?.[1]?.trim();
}

function extractNumericField(stdout: string, label: string): number | undefined {
  const raw = extractField(stdout, label);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function explorerTxUrl(
  signature: string,
  cluster: "devnet" | "mainnet-beta"
): string {
  if (cluster === "mainnet-beta") {
    return `https://explorer.solana.com/tx/${signature}`;
  }

  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function estimateEffectivePriceUsd(params: {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount?: number;
}): number | undefined {
  const inputSymbol = inferSymbol(params.inputMint);
  const outputSymbol = inferSymbol(params.outputMint);

  if (!params.outputAmount || params.outputAmount <= 0) return undefined;

  if (inputSymbol === "USDC") {
    return params.inputAmount / params.outputAmount;
  }

  if (outputSymbol === "USDC") {
    return params.outputAmount / params.inputAmount;
  }

  return undefined;
}

function estimateFeesUsd(params: {
  inputMint: string;
  inputAmount: number;
  outputMint: string;
  outputAmount?: number;
  slippageBps: number;
}): number {
  const inputSymbol = inferSymbol(params.inputMint);
  const outputSymbol = inferSymbol(params.outputMint);

  if (inputSymbol === "USDC") {
    return params.inputAmount * (params.slippageBps / 10000);
  }

  if (outputSymbol === "USDC" && params.outputAmount) {
    return params.outputAmount * (params.slippageBps / 10000);
  }

  return 0;
}

export async function runJupiterTask(params: {
  agentId: string;
  version: string;
  slippageBps: number;
  cluster: "devnet" | "mainnet-beta";
  execute: boolean;
  solAmount?: number;
  inputMint?: string;
  outputMint?: string;
  amountRaw?: string;
  amountUi?: number;
  inputDecimals?: number;
}): Promise<JupiterTaskResult> {
  const {
    agentId,
    version,
    slippageBps,
    cluster,
    execute,
    solAmount,
    inputMint,
    outputMint,
    amountRaw,
    amountUi,
    inputDecimals,
  } = params;

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
      "--slippageBps",
      String(slippageBps),
      "--cluster",
      cluster,
    ];

    let resolvedInputMint = inputMint ?? "SOL";
    let resolvedOutputMint = outputMint ?? "USDC";
    let resolvedInputAmount = solAmount ?? 0;

    if (typeof solAmount === "number") {
      cmdParts.push("--sol", String(solAmount));
      resolvedInputMint = "SOL";
      resolvedOutputMint = outputMint ?? "USDC";
      resolvedInputAmount = solAmount;
    } else {
      if (!inputMint || !outputMint) {
        throw new Error(
          "Generic Jupiter task requires inputMint and outputMint when solAmount is not provided"
        );
      }

      cmdParts.push("--inputMint", inputMint);
      cmdParts.push("--outputMint", outputMint);
      resolvedInputMint = inputMint;
      resolvedOutputMint = outputMint;

      if (amountRaw) {
        cmdParts.push("--amountRaw", amountRaw);
        resolvedInputAmount = Number(amountRaw);
      } else if (
        typeof amountUi === "number" &&
        typeof inputDecimals === "number"
      ) {
        cmdParts.push("--amountUi", String(amountUi));
        cmdParts.push("--inputDecimals", String(inputDecimals));
        resolvedInputAmount = amountUi;
      } else {
        throw new Error(
          "Provide amountRaw or amountUi + inputDecimals for generic Jupiter task"
        );
      }
    }

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
          slippageBps,
          cluster,
          execute,
          solAmount,
          inputMint,
          outputMint,
          amountRaw,
          amountUi,
          inputDecimals,
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
    const outputMintFromStdout = extractField(stdout, "Output Mint");
    const inputMintFromStdout = extractField(stdout, "Input Mint");
    const outputAmount = extractNumericField(stdout, "Output Amount");
    const inputAmountFromStdout = extractNumericField(stdout, "Input Amount");
    const executedAt = new Date().toISOString();
    const explorerUrl = signature ? explorerTxUrl(signature, cluster) : undefined;

    const finalInputMint = inputMintFromStdout ?? resolvedInputMint;
    const finalOutputMint = outputMintFromStdout ?? resolvedOutputMint;
    const finalInputAmount = inputAmountFromStdout ?? resolvedInputAmount;
    const effectivePriceUsd = estimateEffectivePriceUsd({
      inputMint: finalInputMint,
      outputMint: finalOutputMint,
      inputAmount: finalInputAmount,
      outputAmount,
    });
    const feesUsd = estimateFeesUsd({
      inputMint: finalInputMint,
      inputAmount: finalInputAmount,
      outputMint: finalOutputMint,
      outputAmount,
      slippageBps,
    });

    const execution: JupiterExecutionSummary = {
      executedAt,
      execute,
      cluster,
      inputMint: finalInputMint,
      outputMint: finalOutputMint,
      inputAmount: finalInputAmount,
      outputAmount,
      effectivePriceUsd,
      feesUsd,
      slippageBps,
      signature,
      explorerUrl,
      stdoutTail: stdout.slice(-1200),
      stderrTail: stderr.slice(-800),
    };

    memory = markJupiterSwapSuccess(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "jupiter_swap",
        ok: true,
        reason: "Jupiter task completed successfully",
        details: {
          slippageBps,
          cluster,
          execute,
          inputMint: execution.inputMint,
          outputMint: execution.outputMint,
          inputAmount: execution.inputAmount,
          outputAmount: execution.outputAmount,
          effectivePriceUsd: execution.effectivePriceUsd,
          feesUsd: execution.feesUsd,
          executedAt,
          stdoutTail: execution.stdoutTail,
          stderrTail: execution.stderrTail,
        },
        signature,
        explorerUrl,
      })
    );

    appendDraftPost(
      createJupiterDraft({
        agentId,
        config,
        solAmount: typeof solAmount === "number" ? solAmount : 0,
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
      explorerUrl,
      execution,
    };
  } catch (error: any) {
    memory = markError(memory);
    saveAgentMemory(memory);

    const executedAt = new Date().toISOString();

    appendActionLog(
      createActionLog({
        agentId,
        action: "jupiter_swap",
        ok: false,
        reason: String(error?.message ?? error),
        details: {
          slippageBps,
          cluster,
          execute,
          solAmount,
          inputMint,
          outputMint,
          amountRaw,
          amountUi,
          inputDecimals,
          executedAt,
        },
      })
    );

    return {
      ok: false,
      agentId,
      error: String(error?.message ?? error),
      execution: {
        executedAt,
        execute,
        cluster,
        inputMint: inputMint ?? "SOL",
        outputMint: outputMint ?? "USDC",
        inputAmount:
          typeof solAmount === "number"
            ? solAmount
            : typeof amountUi === "number"
              ? amountUi
              : amountRaw
                ? Number(amountRaw)
                : 0,
        slippageBps,
      },
    };
  }
}
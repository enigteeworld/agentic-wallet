import { computeExecutionAmountUi } from "../sizing";
import type {
  ExecutionResult,
  StrategyContext,
  StrategyIntent,
} from "../types";
import { runJupiterTask } from "../../agent/tasks/jupiterTask";

const MAINNET_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
};

const MINT_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(MAINNET_MINTS).map(([symbol, mint]) => [mint, symbol])
);

const SYMBOL_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  JUP: 6,
};

export type StrategyExecutionRequest = {
  agentId: string;
  version: string;
  intent: StrategyIntent;
  context: StrategyContext;
  cluster: "devnet" | "mainnet-beta";
  execute: boolean;
  maxSlippageBps: number;
};

export type StrategyExecutionResponse =
  | {
      ok: true;
      executionResult: ExecutionResult;
      executionAmountUi: number;
      inputMint: string;
      outputMint: string;
      inputSymbol: string;
      outputSymbol: string;
    }
  | {
      ok: false;
      error: string;
      executionAmountUi?: number;
      inputMint?: string;
      outputMint?: string;
    };

function resolveMintAddress(symbolOrMint: string): string {
  return MAINNET_MINTS[symbolOrMint] ?? symbolOrMint;
}

function resolveSymbol(symbolOrMint: string): string {
  return MINT_TO_SYMBOL[symbolOrMint] ?? symbolOrMint;
}

function resolveTokenDecimals(symbolOrMint: string): number {
  const symbol = resolveSymbol(symbolOrMint);
  return SYMBOL_DECIMALS[symbol] ?? 6;
}

function toUiAmount(rawAmount: number | undefined, decimals: number): number {
  if (!Number.isFinite(rawAmount ?? NaN)) return 0;
  return Number(rawAmount) / 10 ** decimals;
}

function buildExecutionResultFromJupiter(params: {
  result: Awaited<ReturnType<typeof runJupiterTask>>;
  context: StrategyContext;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  executionAmountUi: number;
}): ExecutionResult | null {
  const { result, context, inputMint, outputMint, inputSymbol, outputSymbol, executionAmountUi } = params;

  if (!result.ok) return null;

  const execution = result.execution;

  if (!execution.signature && execution.execute) {
    return null;
  }

  const inputDecimals = resolveTokenDecimals(inputSymbol);
  const outputDecimals = resolveTokenDecimals(outputSymbol);

  // Jupiter stdout-derived amounts are raw token units.
  const inputAmountUi =
    execution.inputAmount > 0
      ? toUiAmount(execution.inputAmount, inputDecimals)
      : executionAmountUi;

  const normalizedInputAmount =
    inputAmountUi > 0 ? inputAmountUi : executionAmountUi;

  const outputAmountUi = toUiAmount(execution.outputAmount ?? 0, outputDecimals);

  const inputPriceUsd =
    context.prices[inputSymbol] ??
    context.prices[inputMint] ??
    (inputSymbol === "USDC" ? 1 : 0);

  const outputPriceUsd =
    context.prices[outputSymbol] ??
    context.prices[outputMint] ??
    (outputSymbol === "USDC" ? 1 : 0);

  let effectivePriceUsd = 0;

  // For BUY, store entry price of output asset in USD.
  if (normalizedInputAmount > 0 && outputAmountUi > 0 && inputPriceUsd > 0) {
    effectivePriceUsd = (normalizedInputAmount * inputPriceUsd) / outputAmountUi;
  } else if (outputPriceUsd > 0) {
    effectivePriceUsd = outputPriceUsd;
  }

  return {
    success: true,
    txSignature: execution.signature,
    inputMint,
    outputMint,
    inputAmount: normalizedInputAmount,
    outputAmount: outputAmountUi,
    effectivePriceUsd,
    slippageBps: execution.slippageBps,
    feesUsd: 0,
    executedAt: execution.executedAt,
    raw: {
      cluster: execution.cluster,
      explorerUrl: execution.explorerUrl,
      stdoutTail: execution.stdoutTail,
      stderrTail: execution.stderrTail,
      rawInputAmount: execution.inputAmount,
      rawOutputAmount: execution.outputAmount,
      inputDecimals,
      outputDecimals,
    },
  };
}

export async function executeStrategyIntent(
  params: StrategyExecutionRequest
): Promise<StrategyExecutionResponse> {
  const { intent, context } = params;

  if (intent.action !== "BUY" && intent.action !== "SELL") {
    return {
      ok: false,
      error: `Unsupported action: ${intent.action}`,
    };
  }

  if (!intent.inputMint || !intent.outputMint) {
    return {
      ok: false,
      error: "Intent missing inputMint or outputMint",
    };
  }

  const inputMint = resolveMintAddress(intent.inputMint);
  const outputMint = resolveMintAddress(intent.outputMint);
  const inputSymbol = resolveSymbol(intent.inputMint);
  const outputSymbol = resolveSymbol(intent.outputMint);

  const executionAmountUi = computeExecutionAmountUi(intent, context);

  if (!executionAmountUi || executionAmountUi <= 0) {
    return {
      ok: false,
      error: "Invalid execution size",
      executionAmountUi,
      inputMint,
      outputMint,
    };
  }

  const inputDecimals = resolveTokenDecimals(intent.inputMint);

  const swapResult = await runJupiterTask({
    agentId: params.agentId,
    version: params.version,
    inputMint,
    outputMint,
    amountUi: executionAmountUi,
    inputDecimals,
    slippageBps: params.maxSlippageBps,
    cluster: params.cluster,
    execute: params.execute,
  });

  if (!swapResult.ok) {
    return {
      ok: false,
      error: swapResult.error,
      executionAmountUi,
      inputMint,
      outputMint,
    };
  }

  const executionResult = buildExecutionResultFromJupiter({
    result: swapResult,
    context,
    inputMint,
    outputMint,
    inputSymbol,
    outputSymbol,
    executionAmountUi,
  });

  if (!executionResult) {
    return {
      ok: false,
      error: "Jupiter execution returned no usable result",
      executionAmountUi,
      inputMint,
      outputMint,
    };
  }

  return {
    ok: true,
    executionResult,
    executionAmountUi,
    inputMint,
    outputMint,
    inputSymbol,
    outputSymbol,
  };
}
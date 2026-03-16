import { runX402Client } from "../../addons/x402/client";
import { loadAgentConfig } from "../config";
import {
  appendActionLog,
  createActionLog,
} from "../actionLogger";
import {
  appendDraftPost,
  createX402PaymentDraft,
} from "../xDrafts";
import {
  loadAgentMemory,
  markError,
  markX402PaymentAttempt,
  markX402PaymentSuccess,
  saveAgentMemory,
} from "../memory";

export type X402TaskResult =
  | {
      ok: true;
      agentId: string;
      serverUrl: string;
      amountSol?: number;
      signature?: string;
      explorerUrl?: string;
    }
  | {
      ok: false;
      agentId: string;
      serverUrl: string;
      error: string;
    };

function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export async function runX402Task(params: {
  agentId: string;
  version: string;
  serverUrl: string;
}): Promise<X402TaskResult> {
  const { agentId, version, serverUrl } = params;

  const config = loadAgentConfig({ agentId });
  let memory = loadAgentMemory({ agentId, version });

  try {
    memory = markX402PaymentAttempt(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "x402_payment",
        ok: true,
        reason: "Starting x402 payment flow",
        details: {
          serverUrl,
        },
      })
    );

    const result = await runX402Client({
      serverUrl,
      agentId,
    });

    if (!result.ok) {
      memory = markError(memory);
      saveAgentMemory(memory);

      appendActionLog(
        createActionLog({
          agentId,
          action: "x402_payment",
          ok: false,
          reason: result.error,
          details: {
            serverUrl,
            stdoutTail: result.stdout.slice(-1500),
            stderrTail: result.stderr.slice(-800),
          },
        })
      );

      return {
        ok: false,
        agentId,
        serverUrl,
        error: result.error,
      };
    }

    const explorerUrl = result.signature
      ? explorerTxUrl(result.signature)
      : undefined;

    memory = markX402PaymentSuccess(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "x402_payment",
        ok: true,
        reason: "x402 payment flow completed successfully",
        details: {
          serverUrl,
          amountSol: result.priceSol,
          stdoutTail: result.stdout.slice(-1500),
          stderrTail: result.stderr.slice(-800),
        },
        signature: result.signature,
        explorerUrl,
      })
    );

    appendDraftPost(
      createX402PaymentDraft({
        agentId,
        config,
        serverUrl,
        amountSol: result.priceSol,
        signature: result.signature,
        explorerUrl,
      })
    );

    return {
      ok: true,
      agentId,
      serverUrl,
      amountSol: result.priceSol,
      signature: result.signature,
      explorerUrl,
    };
  } catch (error: any) {
    memory = markError(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId,
        action: "x402_payment",
        ok: false,
        reason: String(error?.message ?? error),
        details: {
          serverUrl,
        },
      })
    );

    return {
      ok: false,
      agentId,
      serverUrl,
      error: String(error?.message ?? error),
    };
  }
}
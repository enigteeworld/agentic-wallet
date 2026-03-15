import { runX402Client } from "../../addons/x402/client";
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
    }
  | {
      ok: false;
      agentId: string;
      serverUrl: string;
      error: string;
    };

export async function runX402Task(params: {
  agentId: string;
  version: string;
  serverUrl: string;
}): Promise<X402TaskResult> {
  const { agentId, version, serverUrl } = params;

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

    await runX402Client({
      serverUrl,
      agentId,
    });

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
        },
      })
    );

    appendDraftPost(
      createX402PaymentDraft({
        agentId,
        serverUrl,
      })
    );

    return {
      ok: true,
      agentId,
      serverUrl,
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
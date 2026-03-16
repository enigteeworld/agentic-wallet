import fs from "fs";
import { TwitterApi } from "twitter-api-v2";
import { loadAgentConfig } from "./config";
import {
  loadAgentMemory,
  markError,
  markXPostAttempt,
  markXPostSuccess,
  saveAgentMemory,
} from "./memory";
import {
  appendActionLog,
  createActionLog,
} from "./actionLogger";
import { getAgentLatestDraftPath } from "./xDrafts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} in environment`);
  }
  return value;
}

function getTwitterClient() {
  const appKey = requireEnv("X_APP_KEY");
  const appSecret = requireEnv("X_APP_SECRET");
  const accessToken = requireEnv("X_ACCESS_TOKEN");
  const accessSecret = requireEnv("X_ACCESS_SECRET");

  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });

  return client.readWrite;
}

function normalizeDraftText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function ensureTweetLength(text: string): void {
  if (text.length > 280) {
    throw new Error(
      `Draft is too long for a single X post (${text.length} chars > 280).`
    );
  }
}

function formatError(error: any): string {
  const pieces: string[] = [];

  if (error?.message) {
    pieces.push(String(error.message));
  }

  if (typeof error?.code !== "undefined") {
    pieces.push(`code=${String(error.code)}`);
  }

  if (typeof error?.status !== "undefined") {
    pieces.push(`status=${String(error.status)}`);
  }

  if (typeof error?.rateLimit !== "undefined") {
    try {
      pieces.push(`rateLimit=${JSON.stringify(error.rateLimit)}`);
    } catch {
      // ignore
    }
  }

  if (error?.data) {
    try {
      pieces.push(`data=${JSON.stringify(error.data)}`);
    } catch {
      pieces.push(`data=${String(error.data)}`);
    }
  }

  if (error?.errors) {
    try {
      pieces.push(`errors=${JSON.stringify(error.errors)}`);
    } catch {
      pieces.push(`errors=${String(error.errors)}`);
    }
  }

  if (!pieces.length) {
    return String(error);
  }

  return pieces.join(" | ");
}

export type PostLatestDraftResult =
  | {
      ok: true;
      posted: boolean;
      dryRun: boolean;
      tweetId?: string;
      text: string;
    }
  | {
      ok: false;
      error: string;
    };

async function postPreparedText(params: {
  agentId: string;
  text: string;
  source: "latest_draft" | "direct_text";
}): Promise<PostLatestDraftResult> {
  const config = loadAgentConfig({ agentId: params.agentId });
  let memory = loadAgentMemory({
    agentId: params.agentId,
    version: config.version,
  });

  try {
    if (!config.x.enabled) {
      return { ok: false, error: "X posting is disabled in config" };
    }

    const text = normalizeDraftText(params.text);

    if (!text) {
      return { ok: false, error: "Draft text is empty" };
    }

    ensureTweetLength(text);

    memory = markXPostAttempt(memory);
    saveAgentMemory(memory);

    if (config.x.dryRun) {
      appendActionLog(
        createActionLog({
          agentId: params.agentId,
          action: "x_post",
          ok: true,
          reason: "X dry-run mode active; draft not posted",
          details: {
            source: params.source,
            text,
          },
        })
      );

      return {
        ok: true,
        posted: false,
        dryRun: true,
        text,
      };
    }

    const client = getTwitterClient();
    const tweet = await client.v2.tweet(text);

    memory = markXPostSuccess(memory);
    saveAgentMemory(memory);

    appendActionLog(
      createActionLog({
        agentId: params.agentId,
        action: "x_post",
        ok: true,
        reason: "Posted text to X",
        details: {
          source: params.source,
          tweetId: tweet.data.id,
          text,
        },
      })
    );

    return {
      ok: true,
      posted: true,
      dryRun: false,
      tweetId: tweet.data.id,
      text,
    };
  } catch (error: any) {
    memory = markError(memory);
    saveAgentMemory(memory);

    const formatted = formatError(error);

    appendActionLog(
      createActionLog({
        agentId: params.agentId,
        action: "x_post",
        ok: false,
        reason: formatted,
        details: {
          source: params.source,
        },
      })
    );

    return {
      ok: false,
      error: formatted,
    };
  }
}

export async function postTextToX(params: {
  agentId: string;
  text: string;
}): Promise<PostLatestDraftResult> {
  return postPreparedText({
    agentId: params.agentId,
    text: params.text,
    source: "direct_text",
  });
}

export async function postLatestDraft(params: {
  agentId: string;
}): Promise<PostLatestDraftResult> {
  const draftPath = getAgentLatestDraftPath(params.agentId);

  if (!fs.existsSync(draftPath)) {
    return { ok: false, error: `No latest draft found at ${draftPath}` };
  }

  const rawText = fs.readFileSync(draftPath, "utf8");

  return postPreparedText({
    agentId: params.agentId,
    text: rawText,
    source: "latest_draft",
  });
}
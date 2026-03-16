import "dotenv/config";
import util from "util";
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { WalletManager } from "../../wallet/walletManager";

export type RunX402ClientResult =
  | {
      ok: true;
      serverUrl: string;
      agentId: string;
      priceSol?: number;
      recipient?: string;
      signature?: string;
      statusCode?: number;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      serverUrl: string;
      agentId: string;
      priceSol?: number;
      recipient?: string;
      signature?: string;
      stdout: string;
      stderr: string;
      error: string;
    };

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

function color(text: string, ...styles: string[]): string {
  return `${styles.join("")}${text}${ansi.reset}`;
}

function line(char = "─", width = 72): string {
  return char.repeat(width);
}

function banner(title: string): string {
  return color(`┌${line("─", 70)}┐`, ansi.cyan) +
    `\n` +
    color(`│ ${title.padEnd(68, " ")} │`, ansi.cyan, ansi.bold) +
    `\n` +
    color(`└${line("─", 70)}┘`, ansi.cyan);
}

function section(text: string): string {
  return color(text, ansi.cyan, ansi.bold);
}

function success(text: string): string {
  return color(text, ansi.green, ansi.bold);
}

function warn(text: string): string {
  return color(text, ansi.yellow, ansi.bold);
}

function errorText(text: string): string {
  return color(text, ansi.red, ansi.bold);
}

function subtle(text: string): string {
  return color(text, ansi.gray);
}

function value(text: string): string {
  return color(text, ansi.white);
}

function keyValue(label: string, val: string): string {
  return `${subtle(label)} ${value(val)}`;
}

function buildExplorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export async function runX402Client(params: {
  serverUrl: string;
  agentId: string;
}): Promise<RunX402ClientResult> {
  const { serverUrl, agentId } = params;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const writeOut = (line: string) => {
    stdoutLines.push(line);
    console.log(line);
  };

  const writeErr = (line: string) => {
    stderrLines.push(line);
    console.error(line);
  };

  try {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) {
      throw new Error("Missing RPC_URL in environment");
    }

    const connection = new Connection(rpcUrl, "confirmed");
    const walletManager = new WalletManager(connection);
    const wallet = walletManager.loadOrCreateEncryptedKeypairOrThrow(agentId);

    writeOut("");
    writeOut(banner("x402 PAYMENT CYCLE"));
    writeOut(keyValue("Server:   ", serverUrl));
    writeOut(keyValue("Agent:    ", agentId));
    writeOut("");

    writeOut(section("1) Requesting /resource"));

    const first = await fetch(`${serverUrl}/resource`);
    const firstText = await first.text();

    if (first.status !== 402) {
      writeOut(`${warn("Expected 402, got")} ${value(String(first.status))}`);
      writeOut(firstText);

      return {
        ok: true,
        serverUrl,
        agentId,
        statusCode: first.status,
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
      };
    }

    let paymentRequest: any;
    try {
      paymentRequest = JSON.parse(firstText);
    } catch {
      throw new Error(`402 response was not valid JSON: ${firstText}`);
    }

    const recipient = paymentRequest.recipient as string;
    const priceSol = Number(paymentRequest.priceSol);

    if (!recipient || !Number.isFinite(priceSol)) {
      throw new Error("402 payload missing recipient or priceSol");
    }

    writeOut(success("402 Payment Required received"));
    writeOut(keyValue("Recipient:", recipient));
    writeOut(`${subtle("Amount:   ")} ${color(`${priceSol} SOL`, ansi.yellow, ansi.bold)}`);
    writeOut("");

    writeOut(section("2) Paying on-chain"));
    writeOut(subtle("Simulating transaction..."));

    const lamports = Math.round(priceSol * LAMPORTS_PER_SOL);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: new PublicKey(recipient),
        lamports,
      })
    );

    const latest = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(wallet);

    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`);
    }

    writeOut(success("Simulation OK"));
    writeOut(subtle("Broadcasting transaction..."));

    const signature = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );

    const explorerUrl = buildExplorerUrl(signature);

    writeOut(success("Payment confirmed on-chain"));
    writeOut(keyValue("Signature:", signature));
    writeOut(`${subtle("Explorer: ")} ${color(explorerUrl, ansi.cyan)}`);
    writeOut("");

    writeOut(section("3) Retrying /resource with payment proof"));

    const second = await fetch(`${serverUrl}/resource`, {
      headers: {
        "x-payment-signature": signature,
      },
    });

    const secondText = await second.text();
    writeOut(`${subtle("HTTP Status:")} ${color(String(second.status), ansi.yellow, ansi.bold)}`);

    try {
      const parsed = JSON.parse(secondText);
      const pretty = util.inspect(parsed, {
        depth: null,
        colors: true,
        compact: false,
      });
      writeOut(pretty);
    } catch {
      writeOut(secondText);
    }

    if (!second.ok) {
      return {
        ok: false,
        serverUrl,
        agentId,
        priceSol,
        recipient,
        signature,
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
        error: `Resource retry failed with status ${second.status}`,
      };
    }

    writeOut("");
    writeOut(success("x402 payment cycle complete"));
    writeOut(color(line("─", 72), ansi.gray));

    return {
      ok: true,
      serverUrl,
      agentId,
      priceSol,
      recipient,
      signature,
      statusCode: second.status,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n"),
    };
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    writeErr("");
    writeErr(errorText(`✖ ${msg}`));
    writeErr(color(line("─", 72), ansi.gray));

    return {
      ok: false,
      serverUrl,
      agentId,
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n"),
      error: msg,
    };
  }
}
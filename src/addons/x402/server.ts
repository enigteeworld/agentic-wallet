import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getHealthyConnection } from "../../rpc/rpcManager";

/**
 * x402-style flow (simplified):
 * - Client calls GET /resource
 * - Server replies 402 with payment request: recipient + amount
 * - Client pays on-chain, then retries with:
 *    x-payment-signature: <txSignature>
 * - Server verifies tx on-chain and returns the resource
 */

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.X402_PORT ?? "8787");

const RECIPIENT = process.env.X402_RECIPIENT;
const REQUIRED_SOL = Number(process.env.X402_PRICE_SOL ?? "0.01");

const SECRET_RESOURCE = {
  message: "✅ Payment verified. Here is your premium AI payload.",
  data: {
    alpha: "solana-agentic-wallet",
    timestamp: new Date().toISOString(),
  },
};

function lamportsRequired(sol: number) {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

async function verifyPaymentTx(params: {
  connection: Connection;
  signature: string;
  recipient: PublicKey;
  minLamports: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const tx = await params.connection.getParsedTransaction(params.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) return { ok: false, reason: "Transaction not found (not confirmed yet?)" };
  if (tx.meta?.err) return { ok: false, reason: "Transaction failed on-chain" };

  const ixs = tx.transaction.message.instructions;

  for (const ix of ixs as any[]) {
    if (ix?.parsed?.type === "transfer") {
      const info = ix.parsed.info;
      const dest = new PublicKey(info.destination);
      const lamports = Number(info.lamports);

      if (dest.equals(params.recipient) && lamports >= params.minLamports) {
        return { ok: true };
      }
    }
  }

  return { ok: false, reason: "No matching transfer found to recipient for required amount" };
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get("/resource", async (req: Request, res: Response) => {
  try {
    if (!RECIPIENT) {
      return res.status(500).json({
        error: "X402_RECIPIENT not set in .env",
        hint: "Set X402_RECIPIENT to a Solana address that will receive payments.",
      });
    }

    const recipient = new PublicKey(RECIPIENT);
    const minLamports = lamportsRequired(REQUIRED_SOL);

    const paymentSig = req.header("x-payment-signature");

    const { connection } = await getHealthyConnection(process.env.RPC_URL);

    // No payment proof -> 402 Payment Required
    if (!paymentSig) {
      return res.status(402).json({
        code: "PAYMENT_REQUIRED",
        network: "solana-devnet",
        price: { sol: REQUIRED_SOL, lamports: minLamports },
        recipient: recipient.toBase58(),
        instruction: "Pay on-chain then retry with header x-payment-signature=<txSignature>",
      });
    }

    // Verify payment proof
    const verdict = await verifyPaymentTx({
      connection,
      signature: paymentSig,
      recipient,
      minLamports,
    });

    if (!verdict.ok) {
      return res.status(402).json({
        code: "PAYMENT_NOT_VERIFIED",
        reason: verdict.reason,
        retry: "Ensure your transaction is confirmed and pays the right recipient/amount.",
      });
    }

    // Payment ok -> return resource
    return res.json({
      paid: true,
      signature: paymentSig,
      resource: SECRET_RESOURCE,
    });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.listen(PORT, () => {
  console.log(`x402-style server running: http://localhost:${PORT}`);
  console.log(`GET /resource -> 402 until paid, then returns JSON payload`);
});

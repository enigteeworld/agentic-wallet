import { Connection, VersionedTransaction } from "@solana/web3.js";

const RANGER_API_BASE =
  process.env.NEXT_PUBLIC_RANGER_API_BASE ?? "https://api.voltr.xyz";

type RangerDepositRequest = {
  vaultPubkey: string;
  userPubkey: string;
  amountRaw: string;
};

type RangerWithdrawRequest = {
  vaultPubkey: string;
  userPubkey: string;
  amountRaw: string;
};

type RangerTxBuildResponse = {
  transaction?: string;
  serializedTransaction?: string;
  tx?: string;
};

function getSerializedTx(response: RangerTxBuildResponse): string {
  const value =
    response.serializedTransaction ??
    response.transaction ??
    response.tx;

  if (!value) {
    throw new Error("Ranger response did not include a serialized transaction");
  }

  return value;
}

export async function buildRangerDepositTransaction(
  params: RangerDepositRequest
): Promise<string> {
  const res = await fetch(
    `${RANGER_API_BASE}/vault/${params.vaultPubkey}/deposit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userPubkey: params.userPubkey,
        amount: params.amountRaw,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ranger deposit build failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as RangerTxBuildResponse;
  return getSerializedTx(json);
}

export async function buildRangerWithdrawTransaction(
  params: RangerWithdrawRequest
): Promise<string> {
  const res = await fetch(
    `${RANGER_API_BASE}/vault/${params.vaultPubkey}/withdraw`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userPubkey: params.userPubkey,
        amount: params.amountRaw,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ranger withdraw build failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as RangerTxBuildResponse;
  return getSerializedTx(json);
}

export async function signAndSendSerializedTransaction(params: {
  connection: Connection;
  serializedTx: string;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
}): Promise<string> {
  const txBytes = Buffer.from(params.serializedTx, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);

  const signed = await params.signTransaction(tx);
  const signature = await params.connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  const latest = await params.connection.getLatestBlockhash("confirmed");
  await params.connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  return signature;
}

export function usdcUiToRaw(amountUi: number): string {
  return String(Math.floor(amountUi * 1_000_000));
}
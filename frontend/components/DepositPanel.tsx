"use client";

import { useMemo, useState } from "react";
import { Connection } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  buildRangerDepositTransaction,
  signAndSendSerializedTransaction,
  usdcUiToRaw,
} from "@/lib/ranger";

type DepositPanelProps = {
  vaultAddress: string;
  baseAsset: string;
  lpSymbol: string;
};

export function DepositPanel({
  vaultAddress,
  baseAsset,
  lpSymbol,
}: DepositPanelProps) {
  const { connection } = useConnection();
  const { connected, publicKey, signTransaction } = useWallet();

  const [amount, setAmount] = useState("100");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const depositPreview = useMemo(() => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return "Enter a valid amount";
    return `Preview: deposit ${parsed} ${baseAsset} into ${vaultAddress} and receive ${lpSymbol}.`;
  }, [amount, baseAsset, lpSymbol, vaultAddress]);

  async function handleDepositClick() {
    if (!connected || !publicKey) {
      setStatus("Connect your wallet first.");
      return;
    }

    if (!signTransaction) {
      setStatus("This wallet does not support transaction signing.");
      return;
    }

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus("Enter a valid deposit amount.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Building Ranger deposit transaction...");

      const serializedTx = await buildRangerDepositTransaction({
        vaultPubkey: vaultAddress,
        userPubkey: publicKey.toBase58(),
        amountRaw: usdcUiToRaw(parsed),
      });

      setStatus("Signing and sending transaction...");

      const signature = await signAndSendSerializedTransaction({
        connection: connection as Connection,
        serializedTx,
        signTransaction,
      });

      setStatus(`Deposit submitted successfully. Signature: ${signature}`);
    } catch (error: any) {
      setStatus(String(error?.message ?? error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-card">
      <h2>Deposit</h2>

      <div className="meta-list">
        <div className="meta-row">
          <span className="meta-key">Wallet</span>
          <span className="meta-value">
            {connected && publicKey ? publicKey.toBase58() : "Not connected"}
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-key">Vault</span>
          <span className="meta-value">{vaultAddress}</span>
        </div>
        <div className="meta-row">
          <span className="meta-key">Asset</span>
          <span className="meta-value">{baseAsset}</span>
        </div>
        <div className="meta-row">
          <span className="meta-key">Receive</span>
          <span className="meta-value">{lpSymbol}</span>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount in ${baseAsset}`}
          style={{
            minHeight: 52,
            borderRadius: 14,
            border: "1px solid rgba(122, 162, 255, 0.14)",
            background: "rgba(255,255,255,0.03)",
            color: "#e8eefc",
            padding: "0 14px",
          }}
        />

        <div className="notice">{depositPreview}</div>

        <button
          className="button primary"
          onClick={handleDepositClick}
          disabled={busy}
        >
          {busy ? "Processing..." : "Deposit"}
        </button>

        {status ? <div className="notice">{status}</div> : null}
      </div>
    </div>
  );
}
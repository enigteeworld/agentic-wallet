"use client";

import { useMemo, useState } from "react";
import { Connection } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  buildRangerWithdrawTransaction,
  signAndSendSerializedTransaction,
  usdcUiToRaw,
} from "@/lib/ranger";

type WithdrawPanelProps = {
  vaultAddress: string;
  baseAsset: string;
  lpSymbol: string;
};

export function WithdrawPanel({
  vaultAddress,
  baseAsset,
  lpSymbol,
}: WithdrawPanelProps) {
  const { connection } = useConnection();
  const { connected, publicKey, signTransaction } = useWallet();

  const [amount, setAmount] = useState("50");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return "Enter a valid amount";
    return `Preview: redeem ${parsed} ${lpSymbol} from ${vaultAddress} and receive ${baseAsset}.`;
  }, [amount, baseAsset, lpSymbol, vaultAddress]);

  async function handleWithdrawClick() {
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
      setStatus("Enter a valid withdraw amount.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Building Ranger withdraw transaction...");

      const serializedTx = await buildRangerWithdrawTransaction({
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

      setStatus(`Withdraw submitted successfully. Signature: ${signature}`);
    } catch (error: any) {
      setStatus(String(error?.message ?? error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-card">
      <h2>Withdraw</h2>

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
          <span className="meta-key">Redeem</span>
          <span className="meta-value">{lpSymbol}</span>
        </div>
        <div className="meta-row">
          <span className="meta-key">Receive</span>
          <span className="meta-value">{baseAsset}</span>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Amount in ${lpSymbol}`}
          style={{
            minHeight: 52,
            borderRadius: 14,
            border: "1px solid rgba(122, 162, 255, 0.14)",
            background: "rgba(255,255,255,0.03)",
            color: "#e8eefc",
            padding: "0 14px",
          }}
        />

        <div className="notice">{preview}</div>

        <button
          className="button primary"
          onClick={handleWithdrawClick}
          disabled={busy}
        >
          {busy ? "Processing..." : "Withdraw"}
        </button>

        {status ? <div className="notice">{status}</div> : null}
      </div>
    </div>
  );
}
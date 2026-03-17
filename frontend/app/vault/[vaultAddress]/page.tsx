import Link from "next/link";
import { Shell } from "@/components/Shell";
import { MetricCard } from "@/components/MetricCard";
import {
  formatPct,
  formatUsd,
  loadTelemetry,
  shortAddress,
} from "@/lib/corsair";

type Props = {
  params: Promise<{
    vaultAddress: string;
  }>;
};

export default async function VaultPage({ params }: Props) {
  const { vaultAddress } = await params;
  const telemetry = loadTelemetry("agent-001");

  return (
    <Shell>
      <main className="container">
        <section className="page-header">
          <h1>Corsair CARV-1 Vault</h1>
          <p>
            Premium public vault page for deposits, monitoring, and live strategy
            transparency.
          </p>
        </section>

        <section className="metric-grid">
          <MetricCard label="Vault Address" value={shortAddress(vaultAddress)} />
          <MetricCard label="NAV" value={formatUsd(telemetry.performance.navUsd)} />
          <MetricCard
            label="Available Capital"
            value={formatUsd(telemetry.performance.navUsd * telemetry.performance.cashPct)}
          />
          <MetricCard label="Drawdown" value={formatPct(telemetry.performance.drawdownPct)} />
        </section>

        <section className="stack">
          <div className="section-card">
            <h2>Vault Summary</h2>
            <div className="meta-list">
              <div className="meta-row">
                <span className="meta-key">Base Asset</span>
                <span className="meta-value">{telemetry.vault.baseAsset ?? "USDC"}</span>
              </div>
              <div className="meta-row">
                <span className="meta-key">Strategy</span>
                <span className="meta-value">{telemetry.vault.strategy ?? "CARV-1"}</span>
              </div>
              <div className="meta-row">
                <span className="meta-key">Manager</span>
                <span className="meta-value">{shortAddress(telemetry.vault.manager)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-key">Admin</span>
                <span className="meta-value">{shortAddress(telemetry.vault.admin)}</span>
              </div>
              <div className="meta-row">
                <span className="meta-key">Public Link</span>
                <span className="meta-value">{`/vault/${vaultAddress}`}</span>
              </div>
            </div>
          </div>

          <div className="section-card">
            <h2>Actions</h2>
            <div className="hero-actions">
              <Link className="button primary" href={`/vault/${vaultAddress}/deposit`}>
                Deposit
              </Link>
              <Link className="button" href={`/vault/${vaultAddress}/withdraw`}>
                Withdraw
              </Link>
              <Link className="button" href={`/vault/${vaultAddress}/dashboard`}>
                Dashboard
              </Link>
              <Link className="button" href={`/vault/${vaultAddress}/trades`}>
                Trade Logs
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Shell>
  );
}
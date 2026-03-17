import Link from "next/link";
import { Shell } from "@/components/Shell";
import { MetricCard } from "@/components/MetricCard";
import {
  formatPct,
  formatUsd,
  loadTelemetry,
  shortAddress,
} from "@/lib/corsair";

export default function HomePage() {
  const telemetry = loadTelemetry("agent-001");
  const vaultAddress = telemetry.vault.vaultAddress;

  return (
    <Shell>
      <main className="container">
        <section className="hero">
          <div className="hero-grid">
            <div className="hero-card">
              <div className="hero-kicker">Corsair Agent • Ranger Vault • CARV-1</div>
              <h1>Autonomous vault intelligence on Solana.</h1>
              <p>
                Corsair turns a Ranger vault into a continuously operating strategy
                engine with live telemetry, public accountability, execution logic,
                and a premium operator surface for deposits, monitoring, and trust.
              </p>

              <div className="hero-actions">
                <Link
                  className="button primary"
                  href={vaultAddress ? `/vault/${vaultAddress}` : "#"}
                >
                  Open Vault
                </Link>
                <Link
                  className="button"
                  href={vaultAddress ? `/vault/${vaultAddress}/dashboard` : "#"}
                >
                  View Dashboard
                </Link>
                <Link className="button" href="/agent/agent-001/reputation">
                  Agent Reputation
                </Link>
              </div>
            </div>

            <div className="panel side-panel">
              <div className="kpi-grid">
                <MetricCard
                  label="Vault NAV"
                  value={formatUsd(telemetry.performance.navUsd)}
                  sub="Current strategy capital"
                />
                <MetricCard
                  label="Cash Ratio"
                  value={formatPct(telemetry.performance.cashPct)}
                  sub="Current idle capital"
                />
                <MetricCard
                  label="Reputation"
                  value={String(telemetry.reputation.score)}
                  sub={`${telemetry.reputation.successRatePct.toFixed(2)}% success rate`}
                />
                <MetricCard
                  label="Total Trades"
                  value={String(telemetry.trades.total)}
                  sub={`${telemetry.trades.buys} buys • ${telemetry.trades.sells} sells`}
                />
              </div>

              <div className="section-card">
                <h2>Live Vault Identity</h2>
                <div className="meta-list">
                  <div className="meta-row">
                    <span className="meta-key">Vault</span>
                    <span className="meta-value">
                      {shortAddress(telemetry.vault.vaultAddress)}
                    </span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Base Asset</span>
                    <span className="meta-value">{telemetry.vault.baseAsset ?? "USDC"}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">LP Symbol</span>
                    <span className="meta-value">{telemetry.vault.lpSymbol ?? "cUSDC"}</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-key">Strategy</span>
                    <span className="meta-value">{telemetry.vault.strategy ?? "CARV-1"}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="stack">
          <div className="section-card">
            <h2>Why Corsair is different</h2>
            <p className="notice">
              This is not just a trading bot. Corsair is an autonomous financial
              operating layer: vault-aware, policy-bounded, execution-capable, and
              publicly observable.
            </p>
          </div>

          <div className="metric-grid">
            <MetricCard
              label="Realized PnL"
              value={formatUsd(telemetry.performance.realizedPnlUsd)}
            />
            <MetricCard
              label="Unrealized PnL"
              value={formatUsd(telemetry.performance.unrealizedPnlUsd)}
            />
            <MetricCard
              label="Drawdown"
              value={formatPct(telemetry.performance.drawdownPct)}
            />
            <MetricCard
              label="Gross Exposure"
              value={formatUsd(telemetry.performance.grossExposureUsd)}
            />
          </div>
        </section>
      </main>
    </Shell>
  );
}
import { Shell } from "@/components/Shell";
import { MetricCard } from "@/components/MetricCard";
import { formatPct, formatUsd, loadTelemetry } from "@/lib/corsair";

type Props = {
  params: Promise<{
    vaultAddress: string;
  }>;
};

export default async function VaultDashboardPage({ params }: Props) {
  const { vaultAddress } = await params;
  const telemetry = loadTelemetry("agent-001");

  return (
    <Shell>
      <main className="container">
        <section className="page-header">
          <h1>Vault Performance Dashboard</h1>
          <p className="break-anywhere">{vaultAddress}</p>
        </section>

        <section className="metric-grid">
          <MetricCard label="NAV" value={formatUsd(telemetry.performance.navUsd)} />
          <MetricCard label="Realized PnL" value={formatUsd(telemetry.performance.realizedPnlUsd)} />
          <MetricCard label="Unrealized PnL" value={formatUsd(telemetry.performance.unrealizedPnlUsd)} />
          <MetricCard label="Cash %" value={formatPct(telemetry.performance.cashPct)} />
          <MetricCard label="Drawdown" value={formatPct(telemetry.performance.drawdownPct)} />
          <MetricCard label="High Water Mark" value={formatUsd(telemetry.performance.highWaterMarkUsd)} />
          <MetricCard label="Gross Exposure" value={formatUsd(telemetry.performance.grossExposureUsd)} />
          <MetricCard label="Cumulative Return" value={formatPct(telemetry.performance.cumulativeReturnPct)} />
        </section>

        <section className="stack">
          <div className="table-card">
            <h2>Open Positions</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Quantity</th>
                    <th>Avg Entry</th>
                    <th>Current Price</th>
                    <th>Market Value</th>
                    <th>Unrealized PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.positions.items.length ? (
                    telemetry.positions.items.map((position, index) => (
                      <tr key={`${position.symbol}-${index}`}>
                        <td className="break-anywhere">{position.symbol ?? position.mint ?? "—"}</td>
                        <td>{position.quantity ?? 0}</td>
                        <td>{position.avgEntryPriceUsd ?? 0}</td>
                        <td>{position.currentPriceUsd ?? 0}</td>
                        <td>{position.marketValueUsd ?? 0}</td>
                        <td>{position.unrealizedPnlUsd ?? 0}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No open positions yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card">
            <h2>Recent Runtime Activity</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.recentLogs.length ? (
                    telemetry.recentLogs.map((log, index) => (
                      <tr key={`${log.ts}-${index}`}>
                        <td className="break-anywhere">{log.ts}</td>
                        <td className="break-anywhere">{log.action}</td>
                        <td>{log.ok ? "ok" : "failed"}</td>
                        <td className="break-anywhere">{log.reason ?? "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>No recent logs yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </Shell>
  );
}
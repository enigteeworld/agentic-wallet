import { Shell } from "@/components/Shell";
import { MetricCard } from "@/components/MetricCard";
import { formatUsd, loadTelemetry } from "@/lib/corsair";

type Props = {
  params: Promise<{
    vaultAddress: string;
  }>;
};

export default async function VaultTradesPage({ params }: Props) {
  await params;
  const telemetry = loadTelemetry("agent-001");

  return (
    <Shell>
      <main className="container">
        <section className="page-header">
          <h1>Trade Log Explorer</h1>
          <p>Full strategy execution history for Corsair Agent.</p>
        </section>

        <section className="metric-grid">
          <MetricCard label="Total Trades" value={String(telemetry.trades.total)} />
          <MetricCard label="Buys" value={String(telemetry.trades.buys)} />
          <MetricCard label="Sells" value={String(telemetry.trades.sells)} />
          <MetricCard label="Realized PnL" value={formatUsd(telemetry.trades.realizedPnlUsd)} />
        </section>

        <section className="table-card">
          <h2>Execution History</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Side</th>
                  <th>Input</th>
                  <th>Output</th>
                  <th>Execution Price</th>
                  <th>Slippage</th>
                  <th>Reason</th>
                  <th>Tx</th>
                </tr>
              </thead>
              <tbody>
                {telemetry.trades.items.length ? (
                  telemetry.trades.items.map((trade, index) => (
                    <tr key={`${trade.id ?? trade.timestamp}-${index}`}>
                      <td>{trade.timestamp ?? "—"}</td>
                      <td>{trade.side ?? "—"}</td>
                      <td>
                        {trade.inputAmount ?? 0} {trade.inputMint ?? ""}
                      </td>
                      <td>
                        {trade.outputAmount ?? 0} {trade.outputMint ?? ""}
                      </td>
                      <td>{trade.executionPriceUsd ?? 0}</td>
                      <td>{trade.slippageBps ?? 0} bps</td>
                      <td>{trade.strategyReason ?? "—"}</td>
                      <td className="code">{trade.txSignature ?? "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>No trades recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </Shell>
  );
}
import { Shell } from "@/components/Shell";
import { MetricCard } from "@/components/MetricCard";
import { loadTelemetry } from "@/lib/corsair";

type Props = {
  params: Promise<{
    agentId: string;
  }>;
};

export default async function AgentReputationPage({ params }: Props) {
  const { agentId } = await params;
  const telemetry = loadTelemetry(agentId);

  return (
    <Shell>
      <main className="container">
        <section className="page-header">
          <h1>Agent Reputation</h1>
          <p className="break-anywhere">Operational trust layer for {agentId}.</p>
        </section>

        <section className="metric-grid">
          <MetricCard label="Score" value={String(telemetry.reputation.score)} />
          <MetricCard
            label="Success Rate"
            value={`${telemetry.reputation.successRatePct.toFixed(2)}%`}
          />
          <MetricCard
            label="Successful Trades"
            value={String(telemetry.reputation.successfulTrades)}
          />
          <MetricCard
            label="Successful Payments"
            value={String(telemetry.reputation.successfulPayments)}
          />
          <MetricCard
            label="Failures"
            value={String(telemetry.reputation.failedActions)}
          />
          <MetricCard
            label="Uptime Cycles"
            value={String(telemetry.reputation.uptimeCycles)}
          />
        </section>

        <section className="stack">
          <div className="table-card">
            <h2>Recent Agent Events</h2>
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
                      <td colSpan={4}>No reputation events yet.</td>
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
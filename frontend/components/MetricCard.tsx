type MetricCardProps = {
  label: string;
  value: string;
  sub?: string;
};

export function MetricCard({ label, value, sub }: MetricCardProps) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}
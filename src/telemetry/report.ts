import fs from "fs";
import path from "path";
import { readActionLogs, readRecentActionLogs } from "../agent/actionLogger";
import { buildReputationSnapshot } from "../agent/reputation";

type TradeLike = {
  id?: string;
  timestamp?: string;
  side?: string;
  inputMint?: string;
  outputMint?: string;
  inputAmount?: number;
  outputAmount?: number;
  executionPriceUsd?: number;
  feesUsd?: number;
  slippageBps?: number;
  txSignature?: string;
  strategyReason?: string;
  realizedPnlUsd?: number;
};

type PositionLike = {
  mint?: string;
  symbol?: string;
  quantity?: number;
  avgEntryPriceUsd?: number;
  currentPriceUsd?: number;
  marketValueUsd?: number;
  unrealizedPnlUsd?: number;
  updatedAt?: string;
};

type PerformanceLike = {
  navUsd?: number;
  realizedPnlUsd?: number;
  unrealizedPnlUsd?: number;
  cumulativeReturnPct?: number;
  drawdownPct?: number;
  highWaterMarkUsd?: number;
  grossExposureUsd?: number;
  cashPct?: number;
  updatedAt?: string;
};

type VaultMetaLike = {
  vaultAddress?: string;
  manager?: string;
  admin?: string;
  baseAsset?: string;
  lpSymbol?: string;
  protocol?: string;
  strategy?: string;
  network?: string;
};

type VaultSnapshotLike = {
  vaultId?: string;
  baseAssetMint?: string;
  totalValueUsd?: number;
  availableCapitalUsd?: number;
  reservedCapitalUsd?: number;
  deployedCapitalUsd?: number;
  realizedPnlUsd?: number;
  unrealizedPnlUsd?: number;
  grossExposureUsd?: number;
  netExposureUsd?: number;
  highWaterMarkUsd?: number;
  lastSyncAt?: string;
};

export type AgentTelemetry = {
  agentId: string;
  generatedAt: string;
  summary: {
    totalActions: number;
    okActions: number;
    failedActions: number;
    successRatePct: number;
    latestActionAt?: string;
  };
  reputation: {
    score: number;
    successfulTrades: number;
    successfulPayments: number;
    failedActions: number;
    uptimeCycles: number;
    successRatePct: number;
  };
  performance: {
    navUsd: number;
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    cumulativeReturnPct: number;
    drawdownPct: number;
    highWaterMarkUsd: number;
    grossExposureUsd: number;
    cashPct: number;
    updatedAt?: string;
  };
  trades: {
    total: number;
    buys: number;
    sells: number;
    realizedPnlUsd: number;
    latestTradeAt?: string;
    items: TradeLike[];
  };
  positions: {
    total: number;
    grossMarketValueUsd: number;
    items: PositionLike[];
  };
  vault: VaultMetaLike;
  recentLogs: Array<{
    ts: string;
    action: string;
    ok: boolean;
    reason?: string;
    explorerUrl?: string;
  }>;
};

function safeReadJsonFile<T>(filepath: string, fallback: T): T {
  if (!fs.existsSync(filepath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filepath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function ensureDir(dirpath: string): void {
  if (!fs.existsSync(dirpath)) {
    fs.mkdirSync(dirpath, { recursive: true });
  }
}

function stateVaultDir(): string {
  return path.resolve(process.cwd(), "state", "vault");
}

function publicTelemetryRoot(): string {
  return path.resolve(process.cwd(), "public", "telemetry");
}

function telemetryAgentDir(agentId: string): string {
  return path.join(publicTelemetryRoot(), agentId);
}

function tradesPath(agentId: string): string {
  return path.join(stateVaultDir(), `${agentId}.trades.json`);
}

function positionsPath(agentId: string): string {
  return path.join(stateVaultDir(), `${agentId}.positions.json`);
}

function performancePath(agentId: string): string {
  return path.join(stateVaultDir(), `${agentId}.performance.json`);
}

function vaultMetaPath(): string {
  return path.join(stateVaultDir(), `ranger-vault-001.meta.json`);
}

function vaultSnapshotPath(): string {
  return path.join(stateVaultDir(), `ranger-vault-001.state.json`);
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function layoutHtml(params: {
  title: string;
  body: string;
  nav: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(params.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: Inter, Arial, sans-serif;
      background: #0b0f17;
      color: #e5e7eb;
      margin: 0;
      padding: 24px;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
    }
    .nav a {
      color: #93c5fd;
      margin-right: 16px;
      text-decoration: none;
      font-weight: 600;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    h1, h2, h3 {
      margin-top: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid #1f2937;
      vertical-align: top;
    }
    .ok { color: #34d399; }
    .bad { color: #f87171; }
    .muted { color: #9ca3af; }
    code {
      background: #0f172a;
      padding: 2px 6px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="nav card">${params.nav}</div>
    ${params.body}
  </div>
</body>
</html>`;
}

function navHtml(agentId: string): string {
  return `
    <a href="/telemetry/${agentId}/index.html">Dashboard</a>
    <a href="/telemetry/${agentId}/trades.html">Trade Logs</a>
    <a href="/telemetry/${agentId}/reputation.html">Reputation</a>
    <a href="/telemetry/${agentId}/telemetry.json">Raw JSON</a>
  `;
}

function dashboardHtml(telemetry: AgentTelemetry): string {
  return layoutHtml({
    title: `${telemetry.agentId} Dashboard`,
    nav: navHtml(telemetry.agentId),
    body: `
      <div class="card">
        <h1>${esc(telemetry.agentId)} Vault Performance Dashboard</h1>
        <div class="muted">Generated at ${esc(telemetry.generatedAt)}</div>
      </div>

      <div class="grid">
        <div class="card"><h3>NAV</h3><div>${formatUsd(telemetry.performance.navUsd)}</div></div>
        <div class="card"><h3>Realized PnL</h3><div>${formatUsd(telemetry.performance.realizedPnlUsd)}</div></div>
        <div class="card"><h3>Unrealized PnL</h3><div>${formatUsd(telemetry.performance.unrealizedPnlUsd)}</div></div>
        <div class="card"><h3>Drawdown</h3><div>${formatPct(telemetry.performance.drawdownPct)}</div></div>
        <div class="card"><h3>Gross Exposure</h3><div>${formatUsd(telemetry.performance.grossExposureUsd)}</div></div>
        <div class="card"><h3>Cash %</h3><div>${formatPct(telemetry.performance.cashPct)}</div></div>
      </div>

      <div class="grid">
        <div class="card"><h3>Reputation Score</h3><div>${telemetry.reputation.score}</div></div>
        <div class="card"><h3>Success Rate</h3><div>${telemetry.reputation.successRatePct.toFixed(2)}%</div></div>
        <div class="card"><h3>Successful Trades</h3><div>${telemetry.reputation.successfulTrades}</div></div>
        <div class="card"><h3>Successful Payments</h3><div>${telemetry.reputation.successfulPayments}</div></div>
        <div class="card"><h3>Failures</h3><div>${telemetry.reputation.failedActions}</div></div>
        <div class="card"><h3>Uptime Cycles</h3><div>${telemetry.reputation.uptimeCycles}</div></div>
      </div>

      <div class="card">
        <h2>Vault</h2>
        <table>
          <tr><th>Vault Address</th><td><code>${esc(telemetry.vault.vaultAddress ?? "")}</code></td></tr>
          <tr><th>Base Asset</th><td>${esc(telemetry.vault.baseAsset ?? "")}</td></tr>
          <tr><th>LP Symbol</th><td>${esc(telemetry.vault.lpSymbol ?? "")}</td></tr>
          <tr><th>Strategy</th><td>${esc(telemetry.vault.strategy ?? "")}</td></tr>
          <tr><th>Network</th><td>${esc(telemetry.vault.network ?? "")}</td></tr>
        </table>
      </div>

      <div class="card">
        <h2>Recent Activity</h2>
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
            ${telemetry.recentLogs.map((entry) => `
              <tr>
                <td>${esc(entry.ts)}</td>
                <td>${esc(entry.action)}</td>
                <td class="${entry.ok ? "ok" : "bad"}">${entry.ok ? "ok" : "failed"}</td>
                <td>${esc(entry.reason ?? "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `,
  });
}

function tradesHtml(telemetry: AgentTelemetry): string {
  return layoutHtml({
    title: `${telemetry.agentId} Trade Logs`,
    nav: navHtml(telemetry.agentId),
    body: `
      <div class="card">
        <h1>${esc(telemetry.agentId)} Live Trade Logs</h1>
        <div class="muted">Total trades: ${telemetry.trades.total}</div>
      </div>

      <div class="grid">
        <div class="card"><h3>Buys</h3><div>${telemetry.trades.buys}</div></div>
        <div class="card"><h3>Sells</h3><div>${telemetry.trades.sells}</div></div>
        <div class="card"><h3>Realized PnL</h3><div>${formatUsd(telemetry.trades.realizedPnlUsd)}</div></div>
        <div class="card"><h3>Latest Trade</h3><div>${esc(telemetry.trades.latestTradeAt ?? "—")}</div></div>
      </div>

      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Side</th>
              <th>Pair</th>
              <th>Input</th>
              <th>Output</th>
              <th>Slippage</th>
              <th>Reason</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            ${telemetry.trades.items.map((trade) => `
              <tr>
                <td>${esc(trade.timestamp ?? "")}</td>
                <td>${esc(trade.side ?? "")}</td>
                <td>${esc(`${trade.inputMint ?? ""} -> ${trade.outputMint ?? ""}`)}</td>
                <td>${esc(trade.inputAmount ?? "")}</td>
                <td>${esc(trade.outputAmount ?? "")}</td>
                <td>${esc(trade.slippageBps ?? "")}</td>
                <td>${esc(trade.strategyReason ?? "")}</td>
                <td><code>${esc(trade.txSignature ?? "")}</code></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2>Open Positions</h2>
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
            ${telemetry.positions.items.map((position) => `
              <tr>
                <td>${esc(position.symbol ?? position.mint ?? "")}</td>
                <td>${esc(position.quantity ?? "")}</td>
                <td>${esc(position.avgEntryPriceUsd ?? "")}</td>
                <td>${esc(position.currentPriceUsd ?? "")}</td>
                <td>${esc(position.marketValueUsd ?? "")}</td>
                <td>${esc(position.unrealizedPnlUsd ?? "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `,
  });
}

function reputationHtml(telemetry: AgentTelemetry): string {
  return layoutHtml({
    title: `${telemetry.agentId} Reputation`,
    nav: navHtml(telemetry.agentId),
    body: `
      <div class="card">
        <h1>${esc(telemetry.agentId)} Reputation Tracker</h1>
      </div>

      <div class="grid">
        <div class="card"><h3>Score</h3><div>${telemetry.reputation.score}</div></div>
        <div class="card"><h3>Success Rate</h3><div>${telemetry.reputation.successRatePct.toFixed(2)}%</div></div>
        <div class="card"><h3>Total Actions</h3><div>${telemetry.summary.totalActions}</div></div>
        <div class="card"><h3>Successful Actions</h3><div>${telemetry.summary.okActions}</div></div>
        <div class="card"><h3>Failed Actions</h3><div>${telemetry.summary.failedActions}</div></div>
        <div class="card"><h3>Uptime Cycles</h3><div>${telemetry.reputation.uptimeCycles}</div></div>
      </div>

      <div class="card">
        <h2>Reputation Breakdown</h2>
        <table>
          <tr><th>Successful Trades</th><td>${telemetry.reputation.successfulTrades}</td></tr>
          <tr><th>Successful Payments</th><td>${telemetry.reputation.successfulPayments}</td></tr>
          <tr><th>Failed Actions</th><td>${telemetry.reputation.failedActions}</td></tr>
          <tr><th>Latest Action</th><td>${esc(telemetry.summary.latestActionAt ?? "—")}</td></tr>
        </table>
      </div>
    `,
  });
}

function resolvePerformance(params: {
  performance: PerformanceLike;
  vaultSnapshot: VaultSnapshotLike;
}): AgentTelemetry["performance"] {
  const snapshotNav = safeNumber(params.vaultSnapshot.totalValueUsd, 0);
  const snapshotAvailable = safeNumber(params.vaultSnapshot.availableCapitalUsd, 0);
  const snapshotRealized = safeNumber(params.vaultSnapshot.realizedPnlUsd, 0);
  const snapshotUnrealized = safeNumber(params.vaultSnapshot.unrealizedPnlUsd, 0);
  const snapshotGrossExposure = safeNumber(params.vaultSnapshot.grossExposureUsd, 0);
  const snapshotHighWater = safeNumber(params.vaultSnapshot.highWaterMarkUsd, 0);

  const fileNav = safeNumber(params.performance.navUsd, 0);
  const fileRealized = safeNumber(params.performance.realizedPnlUsd, 0);
  const fileUnrealized = safeNumber(params.performance.unrealizedPnlUsd, 0);
  const fileGrossExposure = safeNumber(params.performance.grossExposureUsd, 0);
  const fileHighWater = safeNumber(params.performance.highWaterMarkUsd, 0);
  const fileDrawdown = safeNumber(params.performance.drawdownPct, 0);
  const fileCumulative = safeNumber(params.performance.cumulativeReturnPct, 0);
  const fileCashPct = safeNumber(params.performance.cashPct, 0);

  const navUsd = snapshotNav > 0 ? snapshotNav : fileNav;
  const realizedPnlUsd = snapshotRealized !== 0 ? snapshotRealized : fileRealized;
  const unrealizedPnlUsd = snapshotUnrealized !== 0 ? snapshotUnrealized : fileUnrealized;
  const grossExposureUsd = snapshotGrossExposure !== 0 ? snapshotGrossExposure : fileGrossExposure;
  const highWaterMarkUsd = snapshotHighWater > 0 ? snapshotHighWater : fileHighWater;

  const cashPct =
    navUsd > 0
      ? snapshotAvailable / navUsd
      : fileCashPct;

  const drawdownPct =
    highWaterMarkUsd > 0
      ? Math.max(0, (highWaterMarkUsd - navUsd) / highWaterMarkUsd)
      : fileDrawdown;

  const cumulativeReturnPct =
    highWaterMarkUsd > 0
      ? (navUsd - highWaterMarkUsd) / highWaterMarkUsd
      : fileCumulative;

  return {
    navUsd,
    realizedPnlUsd,
    unrealizedPnlUsd,
    cumulativeReturnPct,
    drawdownPct,
    highWaterMarkUsd,
    grossExposureUsd,
    cashPct,
    updatedAt: params.vaultSnapshot.lastSyncAt ?? params.performance.updatedAt,
  };
}

export function buildAgentTelemetry(agentId: string): AgentTelemetry {
  const actionLogs = readActionLogs(agentId);
  const recentLogs = readRecentActionLogs(agentId, 25);
  const { reputation, successRatePct, totalActions, okActions, failedActions } =
    buildReputationSnapshot(agentId);

  const trades = safeReadJsonFile<TradeLike[]>(tradesPath(agentId), []);
  const positions = safeReadJsonFile<PositionLike[]>(positionsPath(agentId), []);
  const performance = safeReadJsonFile<PerformanceLike>(performancePath(agentId), {});
  const vaultMeta = safeReadJsonFile<VaultMetaLike>(vaultMetaPath(), {});
  const vaultSnapshot = safeReadJsonFile<VaultSnapshotLike>(vaultSnapshotPath(), {});

  const buys = trades.filter((trade) => trade.side === "BUY").length;
  const sells = trades.filter((trade) => trade.side === "SELL").length;
  const realizedPnlUsd = trades.reduce(
    (sum, trade) => sum + (Number(trade.realizedPnlUsd ?? 0) || 0),
    0
  );
  const grossMarketValueUsd = positions.reduce(
    (sum, position) => sum + (Number(position.marketValueUsd ?? 0) || 0),
    0
  );

  const resolvedPerformance = resolvePerformance({
    performance,
    vaultSnapshot,
  });

  return {
    agentId,
    generatedAt: new Date().toISOString(),
    summary: {
      totalActions,
      okActions,
      failedActions,
      successRatePct,
      latestActionAt: actionLogs[actionLogs.length - 1]?.ts,
    },
    reputation: {
      score: reputation.score,
      successfulTrades: reputation.successfulTrades,
      successfulPayments: reputation.successfulPayments,
      failedActions: reputation.failedActions,
      uptimeCycles: reputation.uptimeCycles,
      successRatePct,
    },
    performance: resolvedPerformance,
    trades: {
      total: trades.length,
      buys,
      sells,
      realizedPnlUsd,
      latestTradeAt: trades[trades.length - 1]?.timestamp,
      items: trades.slice().reverse(),
    },
    positions: {
      total: positions.length,
      grossMarketValueUsd,
      items: positions,
    },
    vault: vaultMeta,
    recentLogs: recentLogs
      .slice()
      .reverse()
      .map((entry) => ({
        ts: entry.ts,
        action: entry.action,
        ok: entry.ok,
        reason: entry.reason,
        explorerUrl: entry.explorerUrl,
      })),
  };
}

export function buildTelemetrySummaryText(agentId: string): string {
  const telemetry = buildAgentTelemetry(agentId);

  const headline = `Corsair Agent update`;

  const lines = [
    headline,
    "",
    `NAV: ${formatUsd(telemetry.performance.navUsd)}`,
    `Realized PnL: ${formatUsd(telemetry.performance.realizedPnlUsd)}`,
    `Unrealized PnL: ${formatUsd(telemetry.performance.unrealizedPnlUsd)}`,
    `Drawdown: ${formatPct(telemetry.performance.drawdownPct)}`,
    `Reputation: ${telemetry.reputation.score}`,
    `Success rate: ${telemetry.reputation.successRatePct.toFixed(2)}%`,
    `Trades: ${telemetry.trades.total}`,
  ];

  return lines.join("\n").slice(0, 280);
}

export function writeAgentTelemetryArtifacts(telemetry: AgentTelemetry): {
  rootDir: string;
  dashboardPath: string;
  tradesPath: string;
  reputationPath: string;
  jsonPath: string;
} {
  const rootDir = telemetryAgentDir(telemetry.agentId);
  ensureDir(rootDir);

  const dashboardPath = path.join(rootDir, "index.html");
  const tradesPagePath = path.join(rootDir, "trades.html");
  const reputationPagePath = path.join(rootDir, "reputation.html");
  const jsonPath = path.join(rootDir, "telemetry.json");

  fs.writeFileSync(jsonPath, JSON.stringify(telemetry, null, 2), "utf8");
  fs.writeFileSync(dashboardPath, dashboardHtml(telemetry), "utf8");
  fs.writeFileSync(tradesPagePath, tradesHtml(telemetry), "utf8");
  fs.writeFileSync(reputationPagePath, reputationHtml(telemetry), "utf8");

  return {
    rootDir,
    dashboardPath,
    tradesPath: tradesPagePath,
    reputationPath: reputationPagePath,
    jsonPath,
  };
}
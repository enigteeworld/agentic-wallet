import { useEffect, useMemo, useState } from "react";
import { Card } from "./components/Card";
import { formatSol, formatToken, shortAddr } from "./lib/format";

type Status = {
  ok: true;
  network: "devnet";
  rpcUrl: string;
  mint: { address: string; decimals: number } | null;

  registry: {
    programId: string | null;
    enabled: boolean;
  };

  agents: Array<{
    id: string;
    address: string;
    sol: number | null;
    ata: string | null;
    tokenRaw: string | null;

    registryPda: string | null;
    registryRegistered: boolean | null;

    errors?: string[];
  }>;
  warnings: string[];
  updatedAt: string;
};

const API = "http://localhost:8899/api/status";

function explorerAddr(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export default function App() {
  const [data, setData] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const decimals = data?.mint?.decimals ?? 6;

  async function load(opts?: { silent?: boolean }) {
    const silent = opts?.silent ?? false;

    try {
      if (!silent) setUpdating(true);
      setErr(null);

      const res = await fetch(API);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const json = (await res.json()) as Status;
      setData(json);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      if (!silent) setUpdating(false);
    }
  }

  useEffect(() => {
    load({ silent: false });
    const t = setInterval(() => load({ silent: false }), 8000);
    return () => clearInterval(t);
  }, []);

  const totals = useMemo(() => {
    const sol = data?.agents.reduce((a, x) => a + (x.sol ?? 0), 0) ?? 0;
    return { sol };
  }, [data]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-[#05060a] to-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-2">
          <div className="text-3xl font-semibold tracking-tight">Agentic Wallet Dashboard</div>
          <div className="text-sm text-white/60">
            Premium read-only observability for multi-agent wallets on Solana devnet.
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card
            title="Network"
            right={
              <div className="flex items-center gap-2">
                {updating ? (
                  <span className="text-xs text-white/50">Updating…</span>
                ) : (
                  <span className="text-xs text-emerald-300">LIVE</span>
                )}
              </div>
            }
          >
            <div className="text-lg font-medium">
              Solana {data?.network ? data.network : "—"}
            </div>
            <div className="mt-1 break-all text-xs text-white/50">{data?.rpcUrl ?? "—"}</div>

            <div className="mt-3 text-xs text-white/50">
              Registry:{" "}
              {data?.registry?.enabled ? (
                <span className="text-emerald-300">ENABLED</span>
              ) : (
                <span className="text-white/40">OFF</span>
              )}
            </div>

            {data?.registry?.programId ? (
              <a
                className="mt-1 block break-all text-xs text-white/40 hover:text-white/60"
                href={explorerAddr(data.registry.programId)}
                target="_blank"
                rel="noreferrer"
              >
                Program: {data.registry.programId}
              </a>
            ) : (
              <div className="mt-1 break-all text-xs text-white/35">
                (Set <code className="text-white/50">AGENT_REGISTRY_PROGRAM_ID</code> in .env)
              </div>
            )}
          </Card>

          <Card title="Mint (persisted)">
            <div className="text-lg font-medium">
              {data?.mint ? shortAddr(data.mint.address) : "—"}
            </div>
            <div className="mt-1 text-xs text-white/50">Decimals: {data?.mint?.decimals ?? "—"}</div>
            <div className="mt-2 break-all text-xs text-white/40">{data?.mint?.address ?? ""}</div>
          </Card>

          <Card title="Totals">
            <div className="text-lg font-medium">{formatSol(totals.sol)} SOL</div>
            <div className="mt-1 text-xs text-white/50">
              Updated: {data ? new Date(data.updatedAt).toLocaleTimeString() : "—"}
            </div>
          </Card>
        </div>

        <Card
          title="Agents"
          right={
            <button
              onClick={() => load({ silent: false })}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              Refresh
            </button>
          }
        >
          {!data && !err && (
            <div className="text-white/60">
              Loading initial data… <span className="text-white/40">(make sure API is running)</span>
            </div>
          )}

          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              API error: {err}
              <div className="mt-1 text-xs text-red-200/70">
                Ensure API is running: <code className="text-red-100">npm run dash:api</code>
              </div>
            </div>
          )}

          {data?.warnings?.length ? (
            <div className="mt-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-100/80">
              <div className="mb-1 font-medium text-yellow-100">Warnings</div>
              <ul className="list-disc pl-5">
                {data.warnings.slice(0, 3).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-white/50">
                  <tr>
                    <th className="py-2">Agent</th>
                    <th className="py-2">Address</th>
                    <th className="py-2">SOL</th>
                    <th className="py-2">Tokens</th>
                    <th className="py-2">ATA</th>
                    <th className="py-2">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.id} className="border-t border-white/10">
                      <td className="py-3 font-medium">{a.id}</td>

                      <td className="py-3 text-white/70">
                        <a
                          href={explorerAddr(a.address)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-white/90"
                          title={a.address}
                        >
                          {shortAddr(a.address)}
                        </a>
                      </td>

                      <td className="py-3">{a.sol === null ? "—" : formatSol(a.sol)}</td>

                      <td className="py-3">{data.mint ? formatToken(a.tokenRaw, decimals) : "—"}</td>

                      <td className="py-3 text-white/60" title={a.ata ?? ""}>
                        {a.ata ? shortAddr(a.ata) : "—"}
                      </td>

                      <td className="py-3">
                        {!data.registry.enabled ? (
                          <span className="text-white/40">—</span>
                        ) : a.registryRegistered === null ? (
                          <span className="text-yellow-200/80">checking…</span>
                        ) : a.registryRegistered ? (
                          <div className="flex flex-col">
                            <span className="text-emerald-300">✅ Registered</span>
                            {a.registryPda ? (
                              <a
                                href={explorerAddr(a.registryPda)}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 text-xs text-white/50 hover:text-white/70"
                                title={a.registryPda}
                              >
                                PDA: {shortAddr(a.registryPda)}
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex flex-col">
                            <span className="text-white/50">❌ Not registered</span>
                            {a.registryPda ? (
                              <a
                                href={explorerAddr(a.registryPda)}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 text-xs text-white/35 hover:text-white/55"
                                title={a.registryPda}
                              >
                                PDA: {shortAddr(a.registryPda)}
                              </a>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="mt-6 text-xs text-white/40">
          This dashboard is <span className="text-white/60">read-only</span> by design. Use the CLI
          for actions (Step 3–6 + x402 + registry).
        </div>
      </div>
    </div>
  );
}
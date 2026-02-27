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

type ActionResult =
  | { ok: true; [k: string]: any }
  | { ok: false; error: string };

const API = "http://localhost:8899";

function explorerAddr(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border border-white/30 border-t-white/80"
      style={{ width: size, height: size, borderWidth: 2 }}
      aria-label="Loading"
    />
  );
}

export default function App() {
  const [data, setData] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const [busyAgent, setBusyAgent] = useState<Record<string, boolean>>({});
  const [busyAll, setBusyAll] = useState(false);

  // NEW: action job state
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [jobOutput, setJobOutput] = useState<string | null>(null);

  const decimals = data?.mint?.decimals ?? 6;

  async function load(opts?: { silent?: boolean }) {
    const silent = opts?.silent ?? false;

    try {
      if (!silent) setUpdating(true);
      setErr(null);

      const res = await fetch(`${API}/api/status`);
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const totals = useMemo(() => {
    const sol = data?.agents.reduce((a, x) => a + (x.sol ?? 0), 0) ?? 0;
    return { sol };
  }, [data]);

  async function postJson<T extends ActionResult>(path: string, body?: any): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

    const json = (await res.json()) as T;
    return json;
  }

  async function runJob(name: string, fn: () => Promise<ActionResult>) {
    setBusyJob(name);
    setToast(null);
    setJobOutput(null);

    try {
      const json = await fn();
      if (!json.ok) throw new Error(json.error);

      // Jupiter returns stdout/stderr; other steps just return ok
      if (json.stdout || json.stderr) {
        setJobOutput([json.stdout ?? "", json.stderr ?? ""].filter(Boolean).join("\n"));
      }

      setToast(`${name} complete ✅`);
      await load({ silent: false });
    } catch (e: any) {
      setToast(`${name} failed: ${String(e?.message ?? e)}`);
    } finally {
      setBusyJob(null);
    }
  }

  async function registerAgent(agent: string) {
    if (!data?.registry.enabled) {
      setToast("Registry is OFF. Set AGENT_REGISTRY_PROGRAM_ID in .env and restart dash:api.");
      return;
    }

    const agentId = agent;
    const version = "0.1.0";

    setBusyAgent((m) => ({ ...m, [agent]: true }));
    setToast(null);

    try {
      const json = await postJson<ActionResult>("/api/actions/registry/register", {
        agent,
        agentId,
        version,
      });

      if (!json.ok) throw new Error(json.error);

      if (json.already) {
        setToast(`${agent} already registered ✅`);
      } else {
        setToast(`${agent} registered ✅`);
      }

      await load({ silent: false });
    } catch (e: any) {
      setToast(`Register failed for ${agent}: ${String(e?.message ?? e)}`);
    } finally {
      setBusyAgent((m) => ({ ...m, [agent]: false }));
    }
  }

  async function registerAll() {
    if (!data?.registry.enabled || !data) return;

    setBusyAll(true);
    setToast(null);

    try {
      const targets = data.agents.filter((a) => a.registryRegistered === false).map((a) => a.id);

      if (targets.length === 0) {
        setToast("All agents already registered ✅");
        return;
      }

      for (const id of targets) {
        await registerAgent(id);
      }

      setToast("Register-all complete ✅");
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-[#05060a] to-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-2">
          <div className="text-3xl font-semibold tracking-tight">Agentic Wallet Dashboard</div>
          <div className="text-sm text-white/60">
            Local-first observability + control panel for multi-agent wallets on Solana devnet.
          </div>
        </div>

        {toast ? (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
            {toast}
          </div>
        ) : null}

        {busyJob ? (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-white/80">
              <Spinner />
              <span>
                Running <span className="text-white/90">{busyJob}</span>…
                <span className="text-white/50"> (this can take a moment)</span>
              </span>
            </div>

            {jobOutput ? (
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white/70">
                {jobOutput}
              </pre>
            ) : null}
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card
            title="Network"
            right={
              <div className="flex items-center gap-2">
                {updating ? (
                  <div className="flex items-center gap-2">
                    <Spinner size={10} />
                    <span className="text-xs text-white/50">Updating…</span>
                  </div>
                ) : (
                  <span className="text-xs text-emerald-300">LIVE</span>
                )}
              </div>
            }
          >
            <div className="text-lg font-medium">Solana {data?.network ? data.network : "—"}</div>
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
            <div className="text-lg font-medium">{data?.mint ? shortAddr(data.mint.address) : "—"}</div>
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

        {/* ACTIONS */}
        <div className="mb-6">
          <Card
            title="Actions (Local)"
            right={
              <button
                onClick={() => load({ silent: false })}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                Refresh
              </button>
            }
          >
            <div className="text-xs text-white/50">
              
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                disabled={!!busyJob}
                onClick={() =>
                  runJob("Step 3 (SOL transfer)", () => postJson("/api/actions/step3", { amountSol: 0.05 }))
                }
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                {busyJob === "Step 3 (SOL transfer)" ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={10} /> Running…
                  </span>
                ) : (
                  "Run Step 3"
                )}
              </button>

              <button
                disabled={!!busyJob}
                onClick={() => runJob("Step 4 (SPL mint + transfer)", () => postJson("/api/actions/step4"))}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Run Step 4
              </button>

              <button
                disabled={!!busyJob}
                onClick={() => runJob("Step 5 (Agent Brain)", () => postJson("/api/actions/step5"))}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Run Step 5
              </button>

              <button
                disabled={!!busyJob}
                onClick={() =>
                  runJob("Step 6 (Multi-agent harness)", () =>
                    postJson("/api/actions/step6", { agents: 5, rounds: 1, seed: 25 })
                  )
                }
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Run Step 6
              </button>

              <button
                disabled={!!busyJob}
                onClick={() =>
                  runJob("Jupiter dry-run (quote/build/sign/sim)", () =>
                    postJson("/api/actions/jupiter/dryrun", {
                      agent: "agent-001",
                      sol: 0.02,
                      slippageBps: 100,
                      cluster: "mainnet-beta",
                    })
                  )
                }
                className="rounded-xl border border-white/10 bg-indigo-500/15 px-3 py-2 text-xs text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50"
              >
                Jupiter dry-run
              </button>
            </div>
          </Card>
        </div>

        {/* AGENTS */}
        <Card
          title="Agents"
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() => load({ silent: false })}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                Refresh
              </button>

              <button
                onClick={() => registerAll()}
                disabled={!data?.registry.enabled || busyAll}
                className="rounded-xl border border-white/10 bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
                title={!data?.registry.enabled ? "Enable registry first" : "Register all unregistered agents"}
              >
                {busyAll ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner size={10} /> Registering…
                  </span>
                ) : (
                  "Register all"
                )}
              </button>
            </div>
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
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => {
                    const isBusy = !!busyAgent[a.id];

                    return (
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
                            <span className="inline-flex items-center gap-2 text-yellow-200/80">
                              <Spinner size={10} />
                              checking…
                            </span>
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

                        <td className="py-3">
                          {!data.registry.enabled ? (
                            <span className="text-white/40">—</span>
                          ) : a.registryRegistered ? (
                            <span className="text-white/40">—</span>
                          ) : (
                            <button
                              onClick={() => registerAgent(a.id)}
                              disabled={isBusy}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50"
                            >
                              {isBusy ? (
                                <span className="inline-flex items-center gap-2">
                                  <Spinner size={10} /> Registering…
                                </span>
                              ) : (
                                "Register"
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="mt-6 text-xs text-white/40">
          This dashboard is <span className="text-white/60">local-first</span>. Actions run on your
          machine via the dashboard API (keys never leave your laptop).
        </div>
      </div>
    </div>
  );
}
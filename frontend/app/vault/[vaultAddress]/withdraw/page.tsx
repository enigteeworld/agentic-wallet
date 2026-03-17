import { Shell } from "@/components/Shell";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import { loadTelemetry, shortAddress } from "@/lib/corsair";

type Props = {
  params: Promise<{
    vaultAddress: string;
  }>;
};

export default async function WithdrawPage({ params }: Props) {
  const { vaultAddress } = await params;
  const telemetry = loadTelemetry("agent-001");

  return (
    <Shell>
      <main className="container">
        <section className="page-header">
          <h1>Withdraw from Corsair Vault</h1>
          <p>
            Corsair-branded redeem surface for the live Ranger vault{" "}
            <span className="code">{shortAddress(vaultAddress)}</span>.
          </p>
        </section>

        <section className="stack">
          <WithdrawPanel
            vaultAddress={vaultAddress}
            baseAsset={telemetry.vault.baseAsset ?? "USDC"}
            lpSymbol={telemetry.vault.lpSymbol ?? "cUSDC"}
          />

          <div className="section-card">
            <h2>Execution path</h2>
            <p className="notice">
              This page redeems vault shares through the same Ranger transaction
              builder pattern used for deposits, signed directly from the Corsair UI.
            </p>
          </div>
        </section>
      </main>
    </Shell>
  );
}
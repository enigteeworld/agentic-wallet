import { NextResponse } from "next/server";
import { loadTelemetry } from "@/lib/corsair";

export async function GET() {
  const telemetry = loadTelemetry("agent-001");
  return NextResponse.json({
    performance: telemetry.performance,
    positions: telemetry.positions,
    recentLogs: telemetry.recentLogs,
  });
}
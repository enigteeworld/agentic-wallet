import { NextResponse } from "next/server";
import { loadTelemetry } from "@/lib/corsair";

export async function GET() {
  const telemetry = loadTelemetry("agent-001");
  return NextResponse.json(telemetry.trades);
}
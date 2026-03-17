import { NextResponse } from "next/server";
import { loadTelemetry } from "@/lib/corsair";

type Props = {
  params: Promise<{
    agentId: string;
  }>;
};

export async function GET(_: Request, { params }: Props) {
  const { agentId } = await params;
  const telemetry = loadTelemetry(agentId);
  return NextResponse.json(telemetry.reputation);
}
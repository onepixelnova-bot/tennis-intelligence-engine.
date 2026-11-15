import { NextResponse } from "next/server";
import { loadPredictions, computePerformance } from "@/lib/store";

export async function GET() {
  const list = await loadPredictions();
  const stats = computePerformance(list);
  return NextResponse.json(stats);
}

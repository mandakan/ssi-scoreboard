import { NextResponse } from "next/server";
import { isAIConfigured } from "@/lib/ai-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { available: isAIConfigured() },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

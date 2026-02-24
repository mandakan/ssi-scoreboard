import { NextResponse } from "next/server";

export const runtime = "edge";
// Always dynamic — must return the live server value, never a cached snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

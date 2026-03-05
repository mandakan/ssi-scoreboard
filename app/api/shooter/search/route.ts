import { NextResponse } from "next/server";
import db from "@/lib/db-impl";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limitRaw = url.searchParams.get("limit");
  const limitParsed = limitRaw ? parseInt(limitRaw, 10) : 20;
  if (limitRaw && isNaN(limitParsed)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }
  const limit = Math.min(Math.max(1, limitParsed), 100);

  try {
    const results = await db.searchShooterProfiles(q, { limit });
    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}

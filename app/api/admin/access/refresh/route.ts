// POST /api/admin/access/refresh
// Requires: Authorization: Bearer <CACHE_PURGE_SECRET>
//
// Runs `syncServiceAccountAccess()` against the live SSI GraphQL endpoint
// and updates the service_account_access audit catalog. Manual companion
// to the daily cron (PR 4); also handy for verifying a freshly-deployed
// instance from the same admin curl.

import { NextResponse } from "next/server";
import db from "@/lib/db-impl";
import { buildLiveFetcher, syncServiceAccountAccess } from "@/lib/service-account-access";
import { reportError } from "@/lib/error-telemetry";

export async function POST(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncServiceAccountAccess(db, buildLiveFetcher());
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    reportError("admin.access.refresh", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

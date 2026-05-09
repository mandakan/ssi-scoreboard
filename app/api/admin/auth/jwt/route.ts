import { NextResponse } from "next/server";
import { purgeJwtCache } from "@/lib/ssi-auth";

// DELETE /api/admin/auth/jwt
//
// Drops the cached SSI JWT (Redis key `ssi:jwt:v1`) so the next upstream call
// re-mints via `token_auth(email, password)`. Use this after changing the bot's
// permissions on SSI -- club memberships in particular have been observed not
// to propagate to in-flight tokens.
//
// Requires `Authorization: Bearer <CACHE_PURGE_SECRET>`.
export async function DELETE(req: Request) {
  const secret = process.env.CACHE_PURGE_SECRET;
  const auth = req.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await purgeJwtCache();
  return NextResponse.json({ purged: true });
}

import { NextResponse } from "next/server";
import cache from "@/lib/cache-impl";
import { SYNC_CODE_CHARSET, SYNC_CODE_LENGTH, isValidSyncPayload } from "@/lib/sync";

const VALID_CODE_REGEX = new RegExp(
  `^[${SYNC_CODE_CHARSET}]{${SYNC_CODE_LENGTH}}$`,
);

function syncKey(code: string): string {
  return `sync:${code}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();

  if (!VALID_CODE_REGEX.test(code)) {
    return NextResponse.json(
      { error: "Invalid code format" },
      { status: 400 },
    );
  }

  const key = syncKey(code);
  const data = await cache.get(key);

  if (!data) {
    return NextResponse.json(
      { error: "Code not found or expired" },
      { status: 404 },
    );
  }

  // Single-use: delete immediately after retrieval
  await cache.del(key);

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return NextResponse.json(
      { error: "Corrupted sync data" },
      { status: 500 },
    );
  }

  if (!isValidSyncPayload(payload)) {
    return NextResponse.json(
      { error: "Invalid sync data" },
      { status: 500 },
    );
  }

  return NextResponse.json(payload);
}

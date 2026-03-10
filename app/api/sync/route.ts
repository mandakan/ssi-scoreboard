import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import cache from "@/lib/cache-impl";
import {
  isValidSyncPayload,
  MAX_SYNC_PAYLOAD_BYTES,
  SYNC_CODE_CHARSET,
  SYNC_CODE_LENGTH,
  SYNC_TTL_SECONDS,
} from "@/lib/sync";

function generateSyncCode(): string {
  const bytes = randomBytes(SYNC_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < SYNC_CODE_LENGTH; i++) {
    code += SYNC_CODE_CHARSET[bytes[i] % SYNC_CODE_CHARSET.length];
  }
  return code;
}

function syncKey(code: string): string {
  return `sync:${code}`;
}

export async function POST(req: Request) {
  // Size check via content-length header (fast reject)
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_SYNC_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_SYNC_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413 },
      );
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (!isValidSyncPayload(body)) {
    return NextResponse.json(
      { error: "Invalid sync payload" },
      { status: 400 },
    );
  }

  // Generate a unique code (retry on collision — extremely unlikely)
  let code: string;
  let attempts = 0;
  do {
    code = generateSyncCode();
    const existing = await cache.get(syncKey(code));
    if (!existing) break;
    attempts++;
  } while (attempts < 5);

  if (attempts >= 5) {
    return NextResponse.json(
      { error: "Failed to generate unique code" },
      { status: 500 },
    );
  }

  await cache.set(syncKey(code), JSON.stringify(body), SYNC_TTL_SECONDS);

  return NextResponse.json({ code });
}

// Discord interaction signature verification using discord-interactions.
// This is required for the Interactions Endpoint URL to work.

import { verifyKey } from "discord-interactions";

/**
 * Verify that a request came from Discord by checking the signature.
 * Returns the parsed JSON body if valid, or null if verification fails.
 */
export async function verifyDiscordRequest(
  request: Request,
  publicKey: string,
): Promise<Record<string, unknown> | null> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");

  if (!signature || !timestamp) {
    return null;
  }

  const body = await request.text();
  const isValid = await verifyKey(body, signature, timestamp, publicKey);

  if (!isValid) {
    return null;
  }

  return JSON.parse(body);
}

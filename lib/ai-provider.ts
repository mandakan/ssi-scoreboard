// Server-only — never import from client components.
// Provider abstraction for AI coaching tip generation.

import { createCloudflareProvider } from "@/lib/ai-providers/cloudflare-workers-ai";
import { createOpenAIProvider } from "@/lib/ai-providers/openai-compatible";

export interface AIProvider {
  /**
   * Generate a coaching tip from a text prompt. Returns the raw text response.
   * @param maxTokens Maximum tokens to generate. Callers should pass a value
   *   appropriate for the expected output length:
   *   - Pre-match brief (max 55 words): 100
   *   - Post-match coaching/roast (2–3 sentences): 200
   *   Defaults to 200 if omitted.
   */
  generateTip(prompt: string, maxTokens?: number): Promise<string>;
  /** Human-readable model identifier for cache keys and response metadata. */
  modelId: string;
}

export interface AIProviderConfig {
  provider: string;
  model: string;
  /** Not required for the cloudflare provider when using the Workers AI binding. */
  apiKey?: string;
  apiUrl?: string;
}

/**
 * Returns null if AI is not configured (env vars missing).
 * This is the signal to hide the feature entirely on the client.
 */
export function createAIProvider(): AIProvider | null {
  const provider = process.env.AI_PROVIDER;
  const model = process.env.AI_MODEL;
  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL;

  // For the cloudflare provider the API key is optional — the Workers AI
  // binding (env.AI) is used when no key is supplied.
  if (!provider || !model) return null;
  if (provider !== "cloudflare" && !apiKey) return null;

  const config: AIProviderConfig = { provider, model, apiKey, apiUrl };

  switch (provider) {
    case "cloudflare":
      return createCloudflareProvider(config);
    case "openai":
      return createOpenAIProvider(config);
    default:
      console.error(`[ai] Unknown AI_PROVIDER: ${provider}`);
      return null;
  }
}

/** Check whether the AI coaching feature is configured (env vars present). */
export function isAIConfigured(): boolean {
  const provider = process.env.AI_PROVIDER;
  const model = process.env.AI_MODEL;
  if (!provider || !model) return false;
  // Cloudflare provider uses the Workers AI binding — no API key needed.
  if (provider === "cloudflare") return true;
  return Boolean(process.env.AI_API_KEY);
}

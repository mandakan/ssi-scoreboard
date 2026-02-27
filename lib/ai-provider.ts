// Server-only — never import from client components.
// Provider abstraction for AI coaching tip generation.

import { createCloudflareProvider } from "@/lib/ai-providers/cloudflare-workers-ai";
import { createOpenAIProvider } from "@/lib/ai-providers/openai-compatible";

export interface AIProvider {
  /** Generate a coaching tip from a text prompt. Returns the raw text response. */
  generateTip(prompt: string): Promise<string>;
  /** Human-readable model identifier for cache keys and response metadata. */
  modelId: string;
}

export interface AIProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
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

  if (!provider || !model || !apiKey) return null;

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
  return Boolean(
    process.env.AI_PROVIDER &&
    process.env.AI_MODEL &&
    process.env.AI_API_KEY,
  );
}

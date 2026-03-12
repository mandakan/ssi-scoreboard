// Cloudflare Workers AI provider — two modes:
//
// 1. Binding (preferred for CF deployments, no API key required):
//    Set AI_PROVIDER=cloudflare and AI_MODEL, leave AI_API_KEY unset.
//    Requires [ai] binding in wrangler.toml (binding = "AI").
//    Uses getCloudflareContext().env.AI.run() at request time.
//
// 2. REST API (useful outside CF Workers, e.g. local dev with a CF API token):
//    Set AI_PROVIDER=cloudflare, AI_MODEL, AI_API_KEY (CF API token), and
//    AI_API_URL = https://api.cloudflare.com/client/v4/accounts/<ACCT_ID>/ai/run
//    Calls the external REST endpoint with Bearer auth.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AIProvider, AIProviderConfig } from "@/lib/ai-provider";

const TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TOKENS = 200;
const SYSTEM_MESSAGE =
  "You are a concise IPSC shooting coach. Give specific, actionable coaching advice. Follow the length instruction in the prompt exactly.";

// Minimal type for the Workers AI text-generation binding.
// Augments CloudflareEnv (declared globally by @opennextjs/cloudflare) so that
// env.AI is typed without requiring @cloudflare/workers-types as a direct dep.
interface AiTextGenBinding {
  run(
    model: string,
    inputs: {
      messages?: Array<{ role: string; content: string }>;
      max_tokens?: number;
      temperature?: number;
    },
  ): Promise<{ response?: string }>;
}

declare global {
  interface CloudflareEnv {
    AI?: AiTextGenBinding;
  }
}

export function createCloudflareProvider(config: AIProviderConfig): AIProvider {
  return config.apiKey
    ? createRestProvider(config)
    : createBindingProvider(config);
}

// --- binding variant ---

function createBindingProvider(config: AIProviderConfig): AIProvider {
  return {
    modelId: config.model,
    async generateTip(prompt: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
      const { env } = getCloudflareContext();
      const ai = env.AI;
      if (!ai) {
        throw new Error(
          'Workers AI binding not available. ' +
            'Ensure [ai] binding = "AI" is set in wrangler.toml.',
        );
      }
      const result = await ai.run(config.model, {
        messages: [
          { role: "system", content: SYSTEM_MESSAGE },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      });
      return result.response ?? "";
    },
  };
}

// --- REST API variant (original, requires AI_API_KEY + AI_API_URL) ---

function createRestProvider(config: AIProviderConfig): AIProvider {
  const baseUrl = config.apiUrl ?? "";

  return {
    modelId: config.model,
    async generateTip(prompt: string, maxTokens = DEFAULT_MAX_TOKENS): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${baseUrl}/${config.model}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: SYSTEM_MESSAGE },
              { role: "user", content: prompt },
            ],
            max_tokens: maxTokens,
            temperature: 0.7,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Workers AI HTTP ${res.status}: ${body}`);
        }

        const data = (await res.json()) as { result?: { response?: string } };
        return data.result?.response ?? "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

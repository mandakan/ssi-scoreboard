// Cloudflare Workers AI REST API implementation.
// POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
// AI_API_URL should be the full base URL including account ID, e.g.:
//   https://api.cloudflare.com/client/v4/accounts/ACCT_ID/ai/run

import type { AIProvider, AIProviderConfig } from "@/lib/ai-provider";

const TIMEOUT_MS = 10_000;
const SYSTEM_MESSAGE = "You are a concise IPSC shooting coach. Give specific, actionable advice in 1-2 sentences.";

export function createCloudflareProvider(config: AIProviderConfig): AIProvider {
  const baseUrl = config.apiUrl ?? "";

  return {
    modelId: config.model,
    async generateTip(prompt: string): Promise<string> {
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
            max_tokens: 150,
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

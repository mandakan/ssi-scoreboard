// OpenAI-compatible chat completions API implementation.
// Works with OpenAI, Ollama, Together AI, and any OpenAI-compatible endpoint.
// Cloudflare Workers AI also supports the OpenAI format via their gateway.

import type { AIProvider, AIProviderConfig } from "@/lib/ai-provider";

const TIMEOUT_MS = 10_000;
const SYSTEM_MESSAGE = "You are a concise IPSC shooting coach. Give specific, actionable advice in 1-2 sentences.";

export function createOpenAIProvider(config: AIProviderConfig): AIProvider {
  const baseUrl = config.apiUrl ?? "https://api.openai.com/v1";

  return {
    modelId: config.model,
    async generateTip(prompt: string): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
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
          throw new Error(`OpenAI API HTTP ${res.status}: ${body}`);
        }

        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return data.choices?.[0]?.message?.content ?? "";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

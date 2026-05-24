import type { LlmProvider, LlmTextGenerationRequest, LlmTextGenerationResult } from "./types.js";

interface DeepseekProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export function createDeepseekProvider(options: DeepseekProviderOptions): LlmProvider {
  return {
    name: "deepseek",
    async generateText(request: LlmTextGenerationRequest): Promise<LlmTextGenerationResult> {
      const requestModel =
        request.model && !request.model.startsWith("analytics-") ? request.model : options.model;
      const response = await fetch(options.baseUrl ?? "https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: requestModel,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 800,
          response_format: request.responseFormat === "json" ? { type: "json_object" } : undefined
        })
      });

      if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(`DeepSeek request failed (${response.status}): ${message || response.statusText}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content ?? "";

      return {
        text,
        raw: payload,
        usage: payload.usage
          ? {
              inputTokens: payload.usage.prompt_tokens,
              outputTokens: payload.usage.completion_tokens,
              totalTokens: payload.usage.total_tokens
            }
          : undefined
      };
    }
  };
}

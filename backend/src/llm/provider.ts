import { createDisabledLlmProvider, type LlmProvider } from "./types.js";
import { createDeepseekProvider } from "./deepseekProvider.js";
import { createOpenAiProvider } from "./openaiProvider.js";

function normalizeProviderName(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function createConfiguredLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const providerName =
    normalizeProviderName(env.LLM_PROVIDER) ||
    (env.OPENAI_API_KEY ? "openai" : env.DEEPSEEK_API_KEY ? "deepseek" : "");

  if (providerName === "openai") {
    if (!env.OPENAI_API_KEY) {
      return createDisabledLlmProvider();
    }

    return createOpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL ?? "gpt-4.1-mini"
    });
  }

  if (providerName === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) {
      return createDisabledLlmProvider();
    }

    return createDeepseekProvider({
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL ?? "deepseek-chat"
    });
  }

  return createDisabledLlmProvider();
}

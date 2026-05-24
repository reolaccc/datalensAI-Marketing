export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmTextGenerationRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface LlmTextGenerationResult {
  text: string;
  raw?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface LlmProvider {
  name: string;
  generateText(request: LlmTextGenerationRequest): Promise<LlmTextGenerationResult>;
}

export function createDisabledLlmProvider(): LlmProvider {
  return {
    name: "disabled",
    async generateText() {
      throw new Error("No LLM provider is configured.");
    }
  };
}


import Anthropic from "@anthropic-ai/sdk";
import type { GroupThinkConfig } from "../types";

// ── Provider-agnostic interface ──

export interface LLMRequest {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
}

export interface LLMResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

// ── Anthropic ──

class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    this.model = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

// ── Ollama (OpenAI-compatible API) ──

class OllamaClient implements LLMClient {
  private baseUrl: string;
  private model: string;
  private temperature: number;

  constructor(baseUrl: string, model: string, temperature = 0.15) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.temperature = temperature;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const messages = [{ role: "system" as const, content: request.system }, ...request.messages];

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: request.maxTokens,
        temperature: this.temperature,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama request failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }
}

// ── Factory ──

export function createLLMClient(config: GroupThinkConfig): LLMClient {
  switch (config.provider) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new Error("No Anthropic API key configured. Open GroupThink settings to add one.");
      }
      return new AnthropicClient(config.anthropicApiKey, config.model);
    }
    case "ollama": {
      const baseUrl = config.ollamaBaseUrl || "http://localhost:11434";
      return new OllamaClient(baseUrl, config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

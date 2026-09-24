// AI provider registry. OpenAI-compatible covers OpenAI, OpenRouter, Groq,
// Mistral, and local servers (Ollama / LM Studio). Gemini uses its own API.
// Every remote provider maps to an optional host permission origin.

export interface AiProviderDef {
  id: string;
  label: string;
  kind: "openai-compatible" | "gemini";
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  /** Optional host-permission origin pattern, null = localhost (also optional perms). */
  originPattern: string;
  /** Local providers are allowed under Strict Local Mode. */
  isLocal: boolean;
}

export const AI_PROVIDERS: readonly AiProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    requiresKey: true,
    originPattern: "https://api.openai.com/*",
    isLocal: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    requiresKey: true,
    originPattern: "https://openrouter.ai/*",
    isLocal: false,
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
    requiresKey: true,
    originPattern: "https://api.groq.com/*",
    isLocal: false,
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    requiresKey: true,
    originPattern: "https://api.mistral.ai/*",
    isLocal: false,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    requiresKey: true,
    originPattern: "https://generativelanguage.googleapis.com/*",
    isLocal: false,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    requiresKey: false,
    originPattern: "http://localhost/*",
    isLocal: true,
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    requiresKey: false,
    originPattern: "http://localhost/*",
    isLocal: true,
  },
] as const;

export function getProviderDef(id: string): AiProviderDef | null {
  return AI_PROVIDERS.find((p) => p.id === id) ?? null;
}

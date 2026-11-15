import { AnthropicProvider } from "./anthropic.js";
import { DeepLProvider } from "./deepl.js";
import { GeminiProvider } from "./gemini.js";
import { GoogleTranslateProvider } from "./google.js";
import { OpenAICompatibleProvider } from "./openai.js";

/** Hosted LLM services, created with {@link hosted}. */
export enum HostedService {
  Anthropic = "anthropic",
  Gemini = "gemini",
  OpenAI = "openai",
  Mistral = "mistral",
  Groq = "groq",
  DeepSeek = "deepseek",
  OpenRouter = "openrouter",
  XAI = "xai",
  Cerebras = "cerebras",
  Perplexity = "perplexity",
  Together = "together",
  Fireworks = "fireworks",
  HuggingFace = "huggingface",
  DeepInfra = "deepinfra",
  SambaNova = "sambanova",
  Moonshot = "moonshot",
}

/** Local OpenAI-compatible runtimes that need no key, created with {@link local}. */
export enum LocalService {
  Ollama = "ollama",
  LMStudio = "lmstudio",
  LlamaCpp = "llamacpp",
  VLLM = "vllm",
  LocalAI = "localai",
  DockerModelRunner = "dockermodelrunner",
}

/** Machine-translation APIs, created with {@link machine}. */
export enum MachineService {
  DeepL = "deepl",
  Google = "google",
}

const HOSTED_PRESETS: Record<OpenAIHostedService, { baseURL?: string; model: string }> = {
  [HostedService.OpenAI]: { model: "gpt-4.1-mini" },
  [HostedService.Mistral]: { baseURL: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  [HostedService.Groq]: { baseURL: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  [HostedService.DeepSeek]: { baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  [HostedService.OpenRouter]: { baseURL: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" },
  [HostedService.XAI]: { baseURL: "https://api.x.ai/v1", model: "grok-3-mini" },
  [HostedService.Cerebras]: { baseURL: "https://api.cerebras.ai/v1", model: "llama-3.3-70b" },
  [HostedService.Perplexity]: { baseURL: "https://api.perplexity.ai", model: "sonar" },
  [HostedService.Together]: {
    baseURL: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  [HostedService.Fireworks]: {
    baseURL: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  },
  [HostedService.HuggingFace]: {
    baseURL: "https://router.huggingface.co/v1",
    model: "meta-llama/Llama-3.3-70B-Instruct",
  },
  [HostedService.DeepInfra]: {
    baseURL: "https://api.deepinfra.com/v1/openai",
    model: "meta-llama/Meta-Llama-3.1-70B-Instruct",
  },
  [HostedService.SambaNova]: { baseURL: "https://api.sambanova.ai/v1", model: "Meta-Llama-3.3-70B-Instruct" },
  [HostedService.Moonshot]: { baseURL: "https://api.moonshot.ai/v1", model: "moonshot-v1-8k" },
};

const LOCAL_BASE_URLS: Record<LocalService, string> = {
  [LocalService.Ollama]: "http://localhost:11434/v1",
  [LocalService.LMStudio]: "http://localhost:1234/v1",
  [LocalService.LlamaCpp]: "http://localhost:8080/v1",
  [LocalService.VLLM]: "http://localhost:8000/v1",
  [LocalService.LocalAI]: "http://localhost:8080/v1",
  [LocalService.DockerModelRunner]: "http://localhost:12434/engines/v1",
};

type HostedProvider<S extends HostedService> = S extends HostedService.Anthropic
  ? AnthropicProvider
  : S extends HostedService.Gemini
    ? GeminiProvider
    : OpenAICompatibleProvider;

type OpenAIHostedService = Exclude<HostedService, HostedService.Anthropic | HostedService.Gemini>;

const openAICompatible = (service: OpenAIHostedService) => (apiKey: string, model?: string) =>
  new OpenAICompatibleProvider({
    apiKey,
    baseURL: HOSTED_PRESETS[service].baseURL,
    model: model ?? HOSTED_PRESETS[service].model,
  });

const HOSTED_FACTORIES: { [S in HostedService]: (apiKey: string, model?: string) => HostedProvider<S> } = {
  [HostedService.Anthropic]: (apiKey, model) => new AnthropicProvider({ apiKey, model: model ?? "claude-haiku-5-5" }),
  [HostedService.Gemini]: (apiKey, model) => new GeminiProvider({ apiKey, model: model ?? "gemini-3.5-flash-lite" }),
  [HostedService.OpenAI]: openAICompatible(HostedService.OpenAI),
  [HostedService.Mistral]: openAICompatible(HostedService.Mistral),
  [HostedService.Groq]: openAICompatible(HostedService.Groq),
  [HostedService.DeepSeek]: openAICompatible(HostedService.DeepSeek),
  [HostedService.OpenRouter]: openAICompatible(HostedService.OpenRouter),
  [HostedService.XAI]: openAICompatible(HostedService.XAI),
  [HostedService.Cerebras]: openAICompatible(HostedService.Cerebras),
  [HostedService.Perplexity]: openAICompatible(HostedService.Perplexity),
  [HostedService.Together]: openAICompatible(HostedService.Together),
  [HostedService.Fireworks]: openAICompatible(HostedService.Fireworks),
  [HostedService.HuggingFace]: openAICompatible(HostedService.HuggingFace),
  [HostedService.DeepInfra]: openAICompatible(HostedService.DeepInfra),
  [HostedService.SambaNova]: openAICompatible(HostedService.SambaNova),
  [HostedService.Moonshot]: openAICompatible(HostedService.Moonshot),
};

interface MachineProviders {
  [MachineService.DeepL]: DeepLProvider;
  [MachineService.Google]: GoogleTranslateProvider;
}

const MACHINE_FACTORIES: { [S in MachineService]: (apiKey: string) => MachineProviders[S] } = {
  [MachineService.DeepL]: (apiKey) => new DeepLProvider({ apiKey }),
  [MachineService.Google]: (apiKey) => new GoogleTranslateProvider({ apiKey }),
};

/**
 * Creates a provider for a hosted service, or returns `undefined` when `apiKey` is unset so the service is skipped in a
 * named provider map. `model` overrides the service's default model.
 */
export function hosted<S extends HostedService>(
  service: S,
  apiKey: string | undefined,
  model?: string,
): HostedProvider<S> | undefined {
  return apiKey !== undefined && apiKey !== "" ? HOSTED_FACTORIES[service](apiKey, model) : undefined;
}

/**
 * Creates a provider for a local runtime. It is enabled by `model`, the model you have loaded, since local servers
 * need no key. `baseURL` overrides the server address.
 */
export function local(
  service: LocalService,
  model: string | undefined,
  baseURL?: string,
): OpenAICompatibleProvider | undefined {
  if (model === undefined || model === "") return undefined;
  return new OpenAICompatibleProvider({ baseURL: baseURL ?? LOCAL_BASE_URLS[service], model });
}

/** Creates a DeepL or Google Translate provider when `apiKey` is set. */
export function machine<S extends MachineService>(
  service: S,
  apiKey: string | undefined,
): MachineProviders[S] | undefined {
  return apiKey !== undefined && apiKey !== "" ? MACHINE_FACTORIES[service](apiKey) : undefined;
}

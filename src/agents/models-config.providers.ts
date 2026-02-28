// src/agents/models-config.providers.ts
import type { OpenClawConfig } from "../config/config.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";

import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  OLLAMA_API_BASE_URL,
  OLLAMA_DEFAULT_COST,
  OLLAMA_DEFAULT_CONTEXT_WINDOW,
  OLLAMA_DEFAULT_MAX_TOKENS,
  OLLAMA_SHOW_MAX_MODELS,
  OLLAMA_SHOW_CONCURRENCY,
} from "./ollama-stream.js";

import { resolveEnvApiKeyVarName, resolveApiKeyFromProfiles } from "./model-auth.js";
import { ensureAuthProfileStore } from "./auth-profiles.js";

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const log = createSubsystemLogger("agents/model-providers");

/* -----------------------------------------------------------------
   Helper – Ollama API base URL (strip optional /v1 suffix)
   ----------------------------------------------------------------- */
export function resolveOllamaApiBase(configuredBaseUrl?: string): string {
  if (!configuredBaseUrl) return OLLAMA_API_BASE_URL;
  const trimmed = configuredBaseUrl.replace(/\/+$/, "");
  return trimmed.replace(/\/v1$/i, "");
}

/* -----------------------------------------------------------------
   Model‑catalog cache – persisted between restarts
   ----------------------------------------------------------------- */
const MODEL_CACHE_FILE = ".openclaw_model_cache.json";

function loadModelCache(): Record<string, any> {
  if (!existsSync(MODEL_CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(MODEL_CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveModelCache(cache: Record<string, any>) {
  try {
    writeFileSync(MODEL_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch { /* ignored – cache is optional */ }
}

/* -----------------------------------------------------------------
   Discover Ollama models (unchanged, except it now uses the keep‑alive
   wrapper and concurrency limiter defined in utils/http.ts & utils/limit.ts)
   ----------------------------------------------------------------- */
import { ollamaFetch } from "../utils/http.js";
import { limit as concurrencyLimit } from "../utils/limit.js";

async function queryOllamaContextWindow(
  apiBase: string,
  modelName: string,
): Promise<number | undefined> {
  try {
    const response = await ollamaFetch(`${apiBase}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { model_info?: Record<string, unknown> };
    if (!data.model_info) return undefined;

    for (const [key, value] of Object.entries(data.model_info)) {
      if (key.endsWith(".context_length") && typeof value === "number" && Number.isFinite(value)) {
        const cw = Math.floor(value);
        if (cw > 0) return cw;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------
   Discover Ollama models – limited to OLLAMA_SHOW_MAX_MODELS and
   concurrency‑capped.
   ------------------------------------------------------------ */
async function discoverOllamaModels(
  baseUrl?: string,
  opts?: { quiet?: boolean },
): Promise<ModelDefinitionConfig[]> {
  // Skip discovery during unit‑test runs
  if (process.env.VITEST || process.env.NODE_ENV === "test") return [];

  try {
    const apiBase = resolveOllamaApiBase(baseUrl);
    const response = await ollamaFetch(`${apiBase}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      if (!opts?.quiet) log.warn(`Failed to discover Ollama models: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { models: { name: string }[] };
    if (!data.models?.length) {
      log.debug("No Ollama models found on local instance");
      return [];
    }

    const toInspect = data.models.slice(0, OLLAMA_SHOW_MAX_MODELS);
    if (toInspect.length < data.models.length && !opts?.quiet) {
      log.warn(
        `Capping Ollama /api/show inspection to ${OLLAMA_SHOW_MAX_MODELS} models (received ${data.models.length})`,
      );
    }

    const discovered: ModelDefinitionConfig[] = [];
    const limitedFetch = concurrencyLimit(OLLAMA_SHOW_CONCURRENCY);

    for (let i = 0; i < toInspect.length; i += OLLAMA_SHOW_CONCURRENCY) {
      const batch = toInspect.slice(i, i + OLLAMA_SHOW_CONCURRENCY);
      const batchDiscovered = await Promise.all(
        batch.map((model) =>
          limitedFetch(async () => {
            const modelId = model.name;
            const ctx = await queryOllamaContextWindow(apiBase, modelId);
            const isReasoning = modelId.toLowerCase().includes("r1") ||
                                 modelId.toLowerCase().includes("reasoning");
            return {
              id: modelId,
              name: modelId,
              reasoning: isReasoning,
              input: ["text"],
              cost: OLLAMA_DEFAULT_COST,
              contextWindow: ctx ?? OLLAMA_DEFAULT_CONTEXT_WINDOW,
              maxTokens: OLLAMA_DEFAULT_MAX_TOKENS,
            } satisfies ModelDefinitionConfig;
          })
        ),
      );
      discovered.push(...batchDiscovered);
    }
    return discovered;
  } catch (e) {
    if (!opts?.quiet) log.warn(`Failed to discover Ollama models: ${String(e)}`);
    return [];
  }
}

/* ------------------------------------------------------------
   Build the (only) Ollama provider
   ------------------------------------------------------------ */
async function buildOllamaProvider(
  configuredBaseUrl?: string,
  opts?: { quiet?: boolean },
) {
  const models = await discoverOllamaModels(configuredBaseUrl, opts);
  return {
    baseUrl: resolveOllamaApiBase(configuredBaseUrl),
    api: "ollama",
    models,
  };
}

/* ------------------------------------------------------------
   Public entry‑point – returns a map that contains **only** the
   Ollama provider (if any models were found or an API‑key was given).
   All other external‑provider blocks have been removed.
   ------------------------------------------------------------ */
export async function resolveImplicitProviders(params: {
  agentDir: string;
  explicitProviders?: Record<string, any> | null;
}): Promise<Record<string, any>> {
  const providers: Record<string, any> = {};
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });

  // ----------  ONLY OLLAMA  ----------
  const ollamaKey =
    resolveEnvApiKeyVarName("ollama") ??
    resolveApiKeyFromProfiles({ provider: "ollama", store: authStore });
  const ollamaBaseUrl = params.explicitProviders?.ollama?.baseUrl;
  const hasExplicitOllamaConfig = Boolean(params.explicitProviders?.ollama);

  const ollamaProvider = await buildOllamaProvider(ollamaBaseUrl, {
    quiet: !ollamaKey && !hasExplicitOllamaConfig,
  });

  if (ollamaProvider.models.length > 0 || ollamaKey) {
    providers.ollama = {
      ...ollamaProvider,
      apiKey: ollamaKey ?? "ollama-local",
    };
    // Persist the discovered catalog – cheap start‑up on the next run.
    saveModelCache({ ollama: providers.ollama });
  } else {
    // Try to restore a previous cache if discovery failed (e.g. Ollama not running yet)
    const cached = loadModelCache();
    if (cached.ollama) providers.ollama = cached.ollama;
  }

  return providers;
}

/* -----------------------------------------------------------------
   The rest of the original file (Copilot, Bedrock, Gemini, etc.) has
   been stripped.  If any other module imports a symbol that used to be
   exported here, we provide a minimal stub that throws a clear error –
   this prevents accidental runtime use.
   ----------------------------------------------------------------- */
export const resolveImplicitCopilotProvider = async () => {
  throw new Error("Copilot provider removed – only Ollama is supported.");
};
export const resolveImplicitCopilotProvider = async () => {
  throw new Error("Copilot provider removed – only Ollama is supported.");
};

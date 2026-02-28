// src/utils/http.ts
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

/** Keep‑alive agents – shared by the whole process. */
export const httpAgent = new HttpAgent({ keepAlive: true, keepAliveMsecs: 30_000 });
export const httpsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 30_000 });

/**
 * Wrapper around the global `fetch` that forces the keep‑alive agents.
 * All Ollama requests (model discovery, completions, streaming) go through this
 * function, eliminating an extra TCP handshake per request.
 */
export async function ollamaFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const isHttps = typeof input === "string" ? input.startsWith("https") : false;
  const agent = isHttps ? httpsAgent : httpAgent;
  return fetch(input, { ...init, agent });
}

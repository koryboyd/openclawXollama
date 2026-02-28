// src/agents/live-model-filter.ts
export type ModelRef = {
  provider?: string | null;
  id?: string | null;
};

/**
 * In the privacy‑first build we do **not** filter models at all.
 * The function now simply checks that a provider and an id are present,
 * letting the user run *any* Ollama model they have locally.
 * This removes the hidden moderation layer and guarantees zero‑overhead.
 */
export function isModernModelRef(ref: ModelRef): boolean {
  const provider = ref.provider?.trim();
  const id = ref.id?.trim();
  // If either side is missing we cannot build a proper request – reject.
  return !!provider && !!id;
}

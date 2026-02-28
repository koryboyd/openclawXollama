// src/config/zod-schema.providers.ts
import { z } from "zod";

/**
 * Minimal provider schema – only Ollama is allowed.
 * This guarantees that a user cannot accidentally configure an external
 * service.
 */
export const providersSchema = z.object({
  ollama: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    models: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          // Fields required by the runtime; everything else is optional.
          contextWindow: z.number().optional(),
          maxTokens: z.number().optional(),
          input: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  }),
});

/** Exported type used by the rest of the code‑base. */
export type Providers = z.infer<typeof providersSchema>;

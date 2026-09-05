// The model's action protocol. zod validation is not optional (spec §2.6):
// the model returns an action to execute against a live logged-in session —
// validate its shape before it reaches act.ts.
import { z } from 'zod';

export const AgentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), index: z.number().int().positive() }),
  z.object({ action: z.literal('type'), index: z.number().int().positive(), text: z.string().max(2000) }),
  z.object({ action: z.literal('scroll'), direction: z.enum(['up', 'down']) }),
  z.object({ action: z.literal('navigate'), url: z.string().url() }),
  z.object({
    action: z.literal('done'),
    outcome: z.string().max(500),
    files: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal('stuck'),
    reason: z.string().max(500),
    tried: z.array(z.string().max(200)).max(10),
    help: z.string().max(500),
  }),
]);

export type AgentAction = z.infer<typeof AgentActionSchema>;

// What a provider returns from one model call.
export interface ModelResult {
  action: AgentAction;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

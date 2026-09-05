// Provider interface + router (spec §7.6).
// Swapping models/providers must be a config change, not a code change.
// Model IDs and prices come from remote config with DEFAULT_MODEL as the
// fallback — never a constant in code paths.
import type { ModelConfig } from '../shared/types';
import { DEFAULT_MODEL } from '../shared/types';
import type { AgentAction, ModelResult } from './schemas';
import { AgentActionSchema } from './schemas';
import { buildMessages, type PromptInput } from './prompts';

export interface CallArgs {
  prompt: PromptInput;
  model: ModelConfig;
  signal?: AbortSignal;
}

export class PausedError extends Error {
  constructor(public kind: 'credits' | 'auth', message: string) {
    super(message);
  }
}

export interface Provider {
  id: string;
  call(args: CallArgs): Promise<ModelResult>;
}

export function parseAction(raw: unknown): AgentAction {
  // The model's output is data until zod says otherwise (§2.6).
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`model returned no JSON object: ${text.slice(0, 120)}`);
  return AgentActionSchema.parse(JSON.parse(match[0]));
}

// --- OpenAI-compatible chat-completions call (BYOK direct / hosted proxy) ---
export async function chatCompletions(
  url: string,
  headers: Record<string, string>,
  args: CallArgs,
): Promise<ModelResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      model: args.model.model,
      messages: buildMessages(args.prompt),
      reasoning_effort: args.model.reasoningEffort, // §7.4: pin low at tiers 2–3
      response_format: { type: 'json_object' },
    }),
    signal: args.signal,
  });
  if (res.status === 402) throw new PausedError('credits', 'out of credits');
  if (res.status === 401) throw new PausedError('auth', 'token expired');
  if (!res.ok) throw new Error(`model call failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    action: parseAction(data.choices?.[0]?.message?.content ?? ''),
    usage: {
      prompt_tokens: data.usage?.prompt_tokens ?? 0,
      completion_tokens: data.usage?.completion_tokens ?? 0,
      prompt_tokens_details: data.usage?.prompt_tokens_details,
    },
  };
}

export function openAiProvider(apiKey: string): Provider {
  return {
    id: 'openai',
    call: (args) =>
      chatCompletions(
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${apiKey}` },
        args,
      ),
  };
}

export function hostedProvider(workerUrl: string, accessToken: string): Provider {
  return {
    id: 'hosted',
    call: (args) =>
      chatCompletions(
        `${workerUrl}/v1/chat/completions`,
        { authorization: `Bearer ${accessToken}` },
        args,
      ),
  };
}

export { DEFAULT_MODEL };

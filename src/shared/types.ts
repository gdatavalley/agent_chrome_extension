// Core domain types. Run states mirror spec §3.5 exactly.

export type RunState =
  | 'queued'
  | 'planning'
  | 'running'
  | 'complete'
  | 'paused:gate'
  | 'paused:detached'
  | 'paused:credits'
  | 'paused:auth'
  | 'stopped:stuck'
  | 'stopped:user'
  | 'stopped:cap';

export const isPaused = (s: RunState) => s.startsWith('paused:');
export const isTerminal = (s: RunState) => s === 'complete' || s.startsWith('stopped:');

export type DetachReason = 'replaced_with_devtools' | 'canceled_by_user' | 'target_closed';

export interface Task {
  id: string;
  title: string;
  site: string; // START origin — the tab the run opens on
  // Additional origins the agent may use during the run (§5.2 "domain
  // allowlist per session"). The run's allowlist is site + these.
  extraSites?: string[];
  readOnly: boolean; // default ON (spec §5.1)
  maxSteps: number;
  maxCredits?: number;
  allowNewTabs: boolean;
  allowOffOrigin: boolean;
  allowIframes: boolean;
  schedule: { days: number[]; time: string } | null; // days 0-6, time "HH:MM"
  strictReadOnly?: boolean; // per-site network hardening (§5.1 secondary layer)
  createdAt: number;
  lastRunAt?: number;
  missedReason?: string; // e.g. "Chrome closed"
}

export interface Run {
  id: string;
  taskId: string;
  taskTitle: string;
  state: RunState;
  detachReason?: DetachReason;
  tabId?: number;
  origins: string[];
  readOnly: boolean;
  maxSteps: number;
  stepCount: number;
  creditsUsed: number;
  tier: 1 | 2 | 3 | 4;
  scheduled: boolean;
  startedAt: number;
  endedAt?: number;
  error?: string;
}

export type StepKind = 'action' | 'failure' | 'info' | 'gate' | 'system';

export interface Step {
  id?: number;
  runId: string;
  n: number;
  ts: number;
  tier: number;
  kind: StepKind;
  verb: string; // "Clicked", "Typed", "Retried" — ledger voice (UI spec §14)
  target?: string;
  ref?: string; // ⟨button #12⟩
  note?: string;
}

export type GateKind =
  | 'form-submit' | 'payment' | 'send' | 'delete'
  | 'upload' | 'file-overwrite' | 'never-touch';

export interface Gate {
  id: string;
  runId: string;
  stepN: number;
  kind: GateKind;
  detail: string; // what will happen, e.g. "3 of these filenames already exist"
  ref: string; // literal element, mono
  irreversible: boolean;
  approveLabel: string; // outcome-named (§9.3.5)
  stopLabel: string;
  status: 'pending' | 'approved' | 'stopped';
  createdAt: number;
  resolvedAt?: number;
}

export interface CachedActionStep {
  role: string;
  name: string;
}

export interface CachedSequence {
  taskTitle: string;
  outcome: string;
  files?: string[];
  steps: CachedActionStep[];
}

export interface PageMemoryEntry {
  fingerprint: string; // pk — hash(normalised URL + AX tree shape), §4.1
  origin: string;
  url: string;
  actions: Record<string, string>; // "submit button" → resolved selector/index hint
  successes: CachedSequence[]; // action sequences that worked (tier-1 replay, M8)
  failures: string[];
  updatedAt: number;
  ttl: number;
}

export interface AuditEvent {
  id?: number;
  ts: number;
  runId?: string;
  taskId?: string;
  type: string;
  summary: string;
  meta?: Record<string, unknown>;
}

export type LLMProviderId = 'openai' | 'gemini' | 'ollama' | 'hosted' | 'mock';

export interface KeyRecord {
  id: string;
  provider: LLMProviderId;
  label: string; // sk-··········4f2a — never the key itself
  ciphertext: number[]; // AES-GCM
  iv: number[];
  billingEnabledConfirmed?: boolean; // Gemini §7.7 hazard checkbox
  createdAt: number;
  lastVerifiedAt?: number;
}

export interface MeterStats {
  id: 'local';
  ewmaCredits: number; // rolling avg credits per completed run (UI §5.1)
  completedRuns: number;
  byokTokens: number;
  byokCostUsd: number;
  monthBucket: string; // "2026-09" — BYOK totals reset monthly
}

export interface GuardrailDefaults {
  readOnly: boolean;
  maxSteps: number;
  allowNewTabs: boolean;
  allowOffOrigin: boolean;
  allowIframes: boolean;
  maxCreditsPerRun?: number;
  neverSendDomains: string[]; // §5.2 Data — content never sent to any model
}

export const DEFAULT_GUARDRAILS: GuardrailDefaults = {
  readOnly: true,
  // Spec §11 suggests 25, but real tasks measured here run past it — a
  // 13-step marketplace lookup left little headroom for retries, and hitting
  // the cap reads as a failure. Metering is per-token (§9.1), so a higher cap
  // costs nothing on tasks that finish early.
  maxSteps: 50,
  allowNewTabs: false,
  allowOffOrigin: false,
  allowIframes: true,
  neverSendDomains: [],
};

export interface ModelConfig {
  model: string;
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  // 'off' omits reasoning_effort entirely — models that don't accept the
  // parameter reject the whole request, so this has to be expressible in config
  // rather than being a code change (§7.6).
  reasoningEffort: 'low' | 'medium' | 'high' | 'off';
}

// Fallback only — §7.6: model IDs and prices live in remote config.
export const DEFAULT_MODEL: ModelConfig = {
  model: 'gpt-5.6-luna',
  inputPer1M: 0.2,
  cachedInputPer1M: 0.02,
  outputPer1M: 1.2,
  reasoningEffort: 'low',
};

// Which tier is paying for inference. 'mock' is the dev stand-in, 'byok' bills
// the user's own provider account, 'hosted' spends credits we sold them.
export type BillingTier = 'mock' | 'byok' | 'hosted';

// Credit allowance per hosted plan (§9.4). Drives the meter denominator, so a
// Pro user stops being told they have "N of 500 trial credits".
export const PLAN_CREDITS: Record<string, number> = {
  trial: 500,
  starter: 7_000,
  pro: 14_000,
  power: 35_000,
};

const TRIAL_CREDITS = 500;

export function planAllowance(plan: string | undefined): number {
  return PLAN_CREDITS[(plan ?? 'trial').toLowerCase()] ?? TRIAL_CREDITS;
}

// How the plan reads in the UI. BYOK and mock have no plan — saying "trial"
// there is simply false.
export function planLabel(mode: BillingTier, plan: string | undefined): string {
  if (mode === 'byok') return 'your own key';
  if (mode === 'mock') return 'mock provider';
  return plan ?? 'trial';
}

export interface UsageObject {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

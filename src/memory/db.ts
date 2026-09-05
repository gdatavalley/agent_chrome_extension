// IndexedDB schema (Dexie). Checkpoint-every-step is the load-bearing rule
// (spec §2.2): the offscreen loop writes Run + Step + Gate records directly,
// so a service-worker restart resumes from durable state. UI surfaces observe
// these tables via Dexie liveQuery instead of bespoke state sync.
import Dexie, { type Table } from 'dexie';
import type {
  AuditEvent, Gate, KeyRecord, MeterStats, PageMemoryEntry,
  Run, Step, Task,
} from '../shared/types';

export class AgentDB extends Dexie {
  runs!: Table<Run, string>;
  steps!: Table<Step, number>;
  gates!: Table<Gate, string>;
  tasks!: Table<Task, string>;
  pageMemory!: Table<PageMemoryEntry, string>;
  audit!: Table<AuditEvent, number>;
  keys!: Table<KeyRecord, string>;
  settings!: Table<{ key: string; value: unknown }, string>;
  meter!: Table<MeterStats, string>;

  constructor() {
    super('browser-agent');
    this.version(1).stores({
      runs: 'id, taskId, state, startedAt',
      steps: '++id, runId, [runId+n], ts',
      gates: 'id, runId, status',
      tasks: 'id, site, createdAt',
      pageMemory: 'fingerprint, origin, updatedAt',
      audit: '++id, ts, runId, taskId',
      keys: 'id, provider',
      settings: 'key',
      meter: 'id',
    });
  }
}

export const db = new AgentDB();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row == null ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

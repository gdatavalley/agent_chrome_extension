import { describe, it, expect } from 'vitest';
import { MemoryStore } from './store';

describe('atomic conditional debit (§8.3)', () => {
  it('debits when the balance covers the cost', async () => {
    const store = new MemoryStore();
    const user = await store.createUser('a@b.c');
    expect(await store.debit(user.id, 46)).toBe(500 - 46);
  });

  it('returns -1 when insufficient and leaves the balance untouched', async () => {
    const store = new MemoryStore();
    const user = await store.createUser('a@b.c');
    expect(await store.debit(user.id, 501)).toBe(-1);
    expect((await store.getBalance(user.id)).balance).toBe(500);
  });

  it('check-and-decrement is one operation: 3 concurrent runs cannot overdraw', async () => {
    const store = new MemoryStore();
    const user = await store.createUser('a@b.c');
    // Fire three debits of 200 "simultaneously" against a 500 balance.
    const results = await Promise.all([
      store.debit(user.id, 200),
      store.debit(user.id, 200),
      store.debit(user.id, 200),
    ]);
    const succeeded = results.filter((r) => r >= 0);
    const failed = results.filter((r) => r === -1);
    expect(succeeded).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect((await store.getBalance(user.id)).balance).toBe(100);
  });
});

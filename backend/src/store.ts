// Storage abstraction. Local dev and tests use the in-memory implementation;
// production uses Supabase (schema.sql). The interface mirrors the SQL —
// especially debit(), which is atomic and conditional (§8.3).
export interface UserRow { id: string; email: string; createdAt: number }
export interface DeviceCodeRow {
  deviceCode: string; userCode: string; userId: string | null;
  status: 'pending' | 'confirmed' | 'consumed'; expiresAt: number; createdAt: number;
}
export interface BalanceRow { userId: string; balance: number; plan: string }
export interface LedgerRow {
  userId: string; ts: number; model: string;
  promptTokens: number; cachedTokens: number; completionTokens: number;
  credits: number; latencyMs?: number; stepNumber?: number; fingerprint?: string;
}
export interface RefreshRow { id: string; userId: string; tokenHash: string; expiresAt: number }

export interface Store {
  createUser(email: string): Promise<UserRow>;
  getUser(id: string): Promise<UserRow | null>;
  createDeviceCode(userCode: string, ttlMs: number): Promise<DeviceCodeRow>;
  getDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeRow | null>;
  getDeviceCode(deviceCode: string): Promise<DeviceCodeRow | null>;
  updateDeviceCode(deviceCode: string, patch: Partial<DeviceCodeRow>): Promise<void>;
  getBalance(userId: string): Promise<BalanceRow>;
  /** Atomic conditional debit. Returns new balance, or -1 when insufficient. */
  debit(userId: string, cost: number): Promise<number>;
  topUp(userId: string, amount: number, reference: string): Promise<number>;
  addLedger(row: LedgerRow): Promise<void>;
  createRefreshToken(userId: string, tokenHash: string, ttlMs: number): Promise<RefreshRow>;
  consumeRefreshToken(tokenHash: string): Promise<RefreshRow | null>;
}

// ----------------------------------------------------------- in-memory ---

export class MemoryStore implements Store {
  private users = new Map<string, UserRow>();
  private deviceCodes = new Map<string, DeviceCodeRow>();
  private balances = new Map<string, BalanceRow>();
  private ledger: LedgerRow[] = [];
  private refresh = new Map<string, RefreshRow>();

  async createUser(email: string): Promise<UserRow> {
    const existing = [...this.users.values()].find((u) => u.email === email);
    if (existing) return existing;
    const user: UserRow = { id: crypto.randomUUID(), email, createdAt: Date.now() };
    this.users.set(user.id, user);
    this.balances.set(user.id, { userId: user.id, balance: 500, plan: 'trial' });
    return user;
  }

  async getUser(id: string): Promise<UserRow | null> {
    return this.users.get(id) ?? null;
  }

  async createDeviceCode(userCode: string, ttlMs: number): Promise<DeviceCodeRow> {
    const row: DeviceCodeRow = {
      deviceCode: crypto.randomUUID(), userCode, userId: null,
      status: 'pending', expiresAt: Date.now() + ttlMs, createdAt: Date.now(),
    };
    this.deviceCodes.set(row.deviceCode, row);
    return row;
  }

  async getDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeRow | null> {
    return [...this.deviceCodes.values()].find((c) => c.userCode === userCode) ?? null;
  }

  async getDeviceCode(deviceCode: string): Promise<DeviceCodeRow | null> {
    return this.deviceCodes.get(deviceCode) ?? null;
  }

  async updateDeviceCode(deviceCode: string, patch: Partial<DeviceCodeRow>): Promise<void> {
    const row = this.deviceCodes.get(deviceCode);
    if (row) this.deviceCodes.set(deviceCode, { ...row, ...patch });
  }

  async getBalance(userId: string): Promise<BalanceRow> {
    return this.balances.get(userId) ?? { userId, balance: 0, plan: 'trial' };
  }

  // Single-statement semantics: the check and the decrement are one operation.
  async debit(userId: string, cost: number): Promise<number> {
    const row = this.balances.get(userId) ?? { userId, balance: 0, plan: 'trial' };
    if (row.balance < cost) return -1;
    row.balance -= cost;
    this.balances.set(userId, row);
    return row.balance;
  }

  async topUp(userId: string, amount: number, reference: string): Promise<number> {
    const row = this.balances.get(userId) ?? { userId, balance: 0, plan: 'trial' };
    row.balance += amount;
    this.balances.set(userId, row);
    this.ledger.push({
      userId, ts: Date.now(), model: `topup:${reference}`,
      promptTokens: 0, cachedTokens: 0, completionTokens: 0, credits: -amount,
    });
    return row.balance;
  }

  async addLedger(row: LedgerRow): Promise<void> {
    this.ledger.push(row);
  }

  async createRefreshToken(userId: string, tokenHash: string, ttlMs: number): Promise<RefreshRow> {
    const row: RefreshRow = {
      id: crypto.randomUUID(), userId, tokenHash, expiresAt: Date.now() + ttlMs,
    };
    this.refresh.set(tokenHash, row);
    return row;
  }

  // Rotation: consuming a token deletes it — a presented old token is invalid.
  async consumeRefreshToken(tokenHash: string): Promise<RefreshRow | null> {
    const row = this.refresh.get(tokenHash) ?? null;
    if (row) this.refresh.delete(tokenHash);
    return row && row.expiresAt > Date.now() ? row : null;
  }

  // Test introspection (not part of the interface contract).
  get ledgerRows(): readonly LedgerRow[] { return this.ledger; }
}

// Structural fingerprint for page memory (spec §4.1).
// Key = hash of normalised URL + accessibility-tree SHAPE (roles + hierarchy,
// deliberately excluding text content). Same template + different data = same
// key, and the cache holds far less sensitive material.

const QUERY_ALLOWLIST = new Set(['page', 'view', 'tab', 'sort', 'filter', 'status', 'q']);

export function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => QUERY_ALLOWLIST.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.map(([k, v]) => `${k}=${v}`).join('&');
    // Fragment dropped unless it looks like a route (§4.1: #inbox vs #inbox/id
    // are structurally different behind one origin).
    const frag = u.hash.replace(/^#/, '');
    const routeFrag = frag.includes('/') ? `#${frag.split('/')[0]}` : '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${query ? `?${query}` : ''}${routeFrag}`;
  } catch {
    return rawUrl;
  }
}

// Shape string: roles and hierarchy only. Names/text are excluded by design.
export function treeShape(roles: Array<{ role: string; depth: number }>): string {
  return roles.map((r) => `${' '.repeat(Math.min(r.depth, 40))}${r.role}`).join('\n');
}

// FNV-1a 32-bit — sync, cheap, sufficient for a cache key.
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function fingerprint(rawUrl: string, roles: Array<{ role: string; depth: number }>): string {
  return fnv1a(`${normalizeUrl(rawUrl)}\n${treeShape(roles)}`);
}

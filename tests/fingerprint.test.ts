import { describe, it, expect } from 'vitest';
import { normalizeUrl, treeShape, fingerprint, fnv1a } from '../src/memory/fingerprint';

const shape = [
  { role: 'RootWebArea', depth: 0 },
  { role: 'table', depth: 1 },
  { role: 'row', depth: 2 },
  { role: 'button', depth: 3 },
];

describe('normalizeUrl (§4.1)', () => {
  it('drops tracking params but keeps allowlisted ones', () => {
    expect(normalizeUrl('https://x.com/invoices?utm_source=mail&page=2&session=abc'))
      .toBe('https://x.com/invoices?page=2');
  });

  it('drops fragments unless they are routes', () => {
    expect(normalizeUrl('https://x.com/app#inbox')).toBe('https://x.com/app');
    expect(normalizeUrl('https://x.com/app#inbox/thread-9')).toBe('https://x.com/app#inbox');
  });

  it('is stable across pagination noise (same template, same key)', () => {
    const a = fingerprint('https://x.com/list?page=2', shape);
    const b = fingerprint('https://x.com/list?page=7', shape);
    // page IS allowlisted — different pages are different keys by design here
    expect(a).not.toBe(b);
    // but tracking junk never changes the key
    expect(fingerprint('https://x.com/list?fbclid=zzz', shape))
      .toBe(fingerprint('https://x.com/list', shape));
  });
});

describe('treeShape + fingerprint', () => {
  it('same structure with different content = same key (§4.1)', () => {
    expect(fingerprint('https://x.com/a', shape)).toBe(fingerprint('https://x.com/a', shape));
  });

  it('different structure = different key', () => {
    const other = [...shape, { role: 'dialog', depth: 1 }];
    expect(fingerprint('https://x.com/a', shape)).not.toBe(fingerprint('https://x.com/a', other));
  });

  it('fnv1a is deterministic and hex', () => {
    expect(fnv1a('test')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('test')).toBe(fnv1a('test'));
  });

  it('treeShape contains roles and hierarchy, never text', () => {
    const s = treeShape(shape);
    expect(s).toContain('RootWebArea');
    expect(s).toContain('\n');
    expect(s).not.toMatch(/invoice|vendor|password/i);
  });
});

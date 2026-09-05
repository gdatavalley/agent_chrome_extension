import { describe, it, expect } from 'vitest';
import { redactText } from '../src/llm/redact';

describe('redactText (§5.2)', () => {
  it('redacts Luhn-valid card numbers', () => {
    expect(redactText('pay 4111 1111 1111 1111 now')).toBe('pay [card] now');
    expect(redactText('4111-1111-1111-1111')).toBe('[card]');
  });

  it('redacts long digit runs that fail Luhn as generic numbers', () => {
    expect(redactText('account 12345678901234567')).toBe('account [number]');
  });

  it('redacts IBANs', () => {
    expect(redactText('IBAN GB29 NWBK 6016 1331 9268 19')).toBe('IBAN [iban]');
  });

  it('leaves ordinary text and short numbers untouched', () => {
    expect(redactText('8 invoices on page 2 of 3')).toBe('8 invoices on page 2 of 3');
    expect(redactText('Clicked Download all')).toBe('Clicked Download all');
  });

  it('applies caller-supplied patterns', () => {
    expect(redactText('token abc123', [/abc123/])).toBe('token [redacted]');
  });
});

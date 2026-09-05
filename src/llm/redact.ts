// Redaction before prompt construction (spec §5.2 Data).
// Runs on every page-state payload before it leaves the machine. Password
// fields are excluded earlier, at perception time — this layer catches
// sensitive values in ordinary page text.

const PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  // Card numbers: 13–19 digits, optionally grouped by spaces/dashes
  { name: 'card', re: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[card]' },
  // Long digit runs (national IDs, account numbers)
  { name: 'long-digits', re: /\b\d{8,}\b/g, replacement: '[number]' },
  // IBAN
  { name: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/g, replacement: '[iban]' },
];

// Luhn check to avoid redacting innocent digit runs that look card-shaped.
function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function redactText(input: string, extraPatterns: RegExp[] = []): string {
  let out = input;
  const card = PATTERNS.find((p) => p.name === 'card');
  if (card) {
    out = out.replace(card.re, (m) => {
      const digits = m.replace(/\D/g, '');
      return luhn(digits) ? '[card]' : '[number]';
    });
  }
  for (const p of PATTERNS.filter((p) => p.name !== 'card')) out = out.replace(p.re, p.replacement);
  for (const re of extraPatterns) out = out.replace(re, '[redacted]');
  return out;
}

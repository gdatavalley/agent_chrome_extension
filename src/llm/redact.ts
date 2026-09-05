// Redaction before prompt construction (spec §5.2 Data).
// Runs on every page-state payload before it leaves the machine. Password
// fields are excluded earlier, at perception time — this layer catches
// sensitive values in ordinary page text.

const PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  // IBAN first — its digit groups otherwise match the card/number patterns.
  // Groups are 2–4 chars because real IBANs end with a short group; the
  // replacer validates the overall 15–34 length.
  { name: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{2,4}){3,9}\b/g, replacement: '[iban]' },
  // Card numbers: 13–19 digits, separators only BETWEEN digits
  { name: 'card', re: /\b\d(?:[ -]?\d){12,18}\b/g, replacement: '[card]' },
  // Long digit runs (national IDs, account numbers)
  { name: 'long-digits', re: /\b\d{8,}\b/g, replacement: '[number]' },
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
  // Patterns apply in array order — IBAN before card before long-digits,
  // or the digit groups inside an IBAN get eaten by the generic patterns.
  for (const p of PATTERNS) {
    if (p.name === 'card') {
      out = out.replace(p.re, (m) => {
        const digits = m.replace(/\D/g, '');
        return luhn(digits) ? '[card]' : '[number]';
      });
    } else if (p.name === 'iban') {
      out = out.replace(p.re, (m) => {
        const compact = m.replace(/\s/g, '');
        return compact.length >= 15 && compact.length <= 34 ? '[iban]' : m;
      });
    } else {
      out = out.replace(p.re, p.replacement);
    }
  }
  for (const re of extraPatterns) out = out.replace(re, '[redacted]');
  return out;
}

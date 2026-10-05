export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!/^[a-z]+:\/\//.test(s)) s = 'http://' + s;
  try { s = new URL(s).hostname; } catch { s = input.trim().toLowerCase(); }
  return s.replace(/^www\./, '');
}
export const emailDomain = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';
export const firstName = (full?: string | null) => (full ?? '').trim().split(/\s+/)[0] || 'there';

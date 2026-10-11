export function parseEuro(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export function parseItalianDecimal(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseItalianDate(text: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export function parseSurface(text: string): number | null {
  const digits = text.split('m')[0]!.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export function parseRooms(text: string): number | null {
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

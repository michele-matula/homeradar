import { normalize } from '@/core/lead-filters';
import data from '@/shared/comuni.json';
import type { ComuneRef } from '@/shared/types';

export interface ProvinceInfo {
  /** Sigla automobilistica, "BG". */
  sigla: string;
  name: string;
  region: string;
}

export interface ComuneInfo {
  /** Codice ISTAT, 6 cifre. */
  istat: string;
  name: string;
  province: ProvinceInfo;
}

// Formato compatto generato da scripts/generate-comuni.mjs: p = [sigla, nome, regione], c = [istat, nome, indice provincia].
type Raw = { p: [string, string, string][]; c: [string, string, number][] };
const raw = data as unknown as Raw;
const provinces: ProvinceInfo[] = raw.p.map(([sigla, name, region]) => ({ sigla, name, region }));
const all: ComuneInfo[] = raw.c.map(([istat, name, p]) => ({ istat, name, province: provinces[p]! }));
const byIstat = new Map(all.map((c) => [c.istat, c]));
const keyed = all.map((c) => ({ c, n: normalize(c.name) }));

export function comuneInfo(istat: string): ComuneInfo | null {
  return byIstat.get(istat) ?? null;
}

/** Comuni il cui nome inizia con la ricerca, poi quelli con una parola che inizia così; i nomi più corti prima. */
export function searchComuni(query: string, limit = 8): ComuneInfo[] {
  const q = normalize(query);
  if (!q) return [];
  const rank = (a: { n: string }, b: { n: string }) => a.n.length - b.n.length || a.n.localeCompare(b.n);
  const starts = keyed.filter((k) => k.n.startsWith(q)).sort(rank);
  const words = keyed.filter((k) => !k.n.startsWith(q) && k.n.split(' ').some((w) => w.startsWith(q))).sort(rank);
  return [...starts, ...words].slice(0, limit).map((k) => k.c);
}

export function toRef(c: ComuneInfo): ComuneRef {
  return { istat: c.istat, name: c.name, province: c.province.sigla };
}

/** Nome negli URL dei portali: solo la parte italiana, minuscole, senza accenti, apostrofi e spazi come "-". */
export function slug(name: string): string {
  return normalize(name.split('/')[0]!).replace(/ /g, '-');
}

/** Province che i portali scrivono diversamente dal nome ISTAT (verificate il 2026-10-18). */
const PROVINCE_SLUGS: Record<string, string> = { MB: 'monza-brianza' };

export function provinceSlug(p: ProvinceInfo): string {
  return PROVINCE_SLUGS[p.sigla] ?? slug(p.name);
}

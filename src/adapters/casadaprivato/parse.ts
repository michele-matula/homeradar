// Funzioni pure sul DOM già mostrato da CasaDaPrivato. Si leggono solo i nodi elencati qui:
// l'estratto della descrizione (div.info > p) e small.subtitle (testo libero del venditore) non vengono mai letti.
import { parseEuro } from '@/adapters/immobiliare/format';
import { categoryFromTypology } from '@/core/category';
import { coverOrNull } from '@/core/cover';
import type { ListingObservation, ParseResult } from '@/shared/types';
import { BASE, categoryFromPath, listingIdFromHref } from './urls';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Card dei soli annunci del comune cercato: esclude quelli dei comuni vicini, che seguono h2.similar-properties. */
export function ownCards(root: ParentNode): Element[] {
  const similar = root.querySelector('#property-listing h2.similar-properties');
  return [...root.querySelectorAll('#property-listing div.item')].filter(
    (c) => c.querySelector('div.price') && !(similar && similar.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
}

/** "Quadrilocale da Privato a Salerno, Via X 1"; senza indirizzo se manca la virgola. */
export function parseTitle(title: string): { typology: string | null; city: string | null; address: string | null } {
  const m = /^(.+?) da Privato a ([^,]+)(?:,\s*(.+))?$/.exec(title.trim());
  return m ? { typology: m[1]!.trim(), city: m[2]!.trim(), address: m[3]?.trim() || null } : { typology: null, city: null, address: null };
}

function parseAmenities(items: string[]): { rooms: number | null; surfaceM2: number | null } {
  let rooms: number | null = null;
  let surfaceM2: number | null = null;
  for (const t of items) {
    const r = /^(\d+)\+?\s+local/i.exec(t);
    if (r) rooms = Number(r[1]);
    // Parte intera, come Idealista: "85,5 mq" → 85; il punto è il separatore delle migliaia.
    const s = /^(\d[\d.]*)(?:,\d+)?\s*mq\b/i.exec(t);
    if (s) surfaceM2 = Number(s[1]!.replace(/\./g, ''));
  }
  return { rooms, surfaceM2 };
}

export function parseSearch(root: ParentNode, _url: string): ParseResult {
  const out: ParseResult = { observations: [], errors: [] };
  ownCards(root).forEach((card, i) => {
    const link = card.querySelector('h3 a[href]');
    const href = link?.getAttribute('href') ?? '';
    const id = listingIdFromHref(href);
    const title = text(link);
    if (!id || !title) {
      out.errors.push(`card[${i}]: id o titolo mancanti`);
      return;
    }
    const priceText = text(card.querySelector('div.price'));
    const reserved = /trattativa\s+riservata/i.test(priceText);
    const parsed = reserved ? null : parseEuro(priceText);
    const price = parsed && parsed > 0 ? parsed : null;
    const t = parseTitle(title);
    const img = card.querySelector('.image img');
    // Copertina: data-src; src è il segnaposto /images/no-thumb.svg, che coverOrNull scarta.
    const cover = coverOrNull('casadaprivato', img?.getAttribute('data-src') || img?.getAttribute('src'));
    const obs: ListingObservation = {
      portal: 'casadaprivato', portalId: id, url: new URL(href, BASE).href, title, address: t.address, city: t.city, zone: null, typology: t.typology,
      category: categoryFromPath(href) ?? categoryFromTypology(t.typology),
      ...parseAmenities([...card.querySelectorAll('ul.amenities li')].map((li) => text(li))),
      price, ...(reserved ? { priceReserved: true } : {}), sellerType: 'private', portalCreatedAt: null, lastDrop: null, coverUrl: cover, source: 'search',
    };
    out.observations.push(obs);
  });
  return out;
}

/** C'è un link alla pagina successiva (".../pagina-N") nella paginazione. */
export function hasNextPage(root: ParentNode, url: string): boolean {
  let path = '';
  try { path = new URL(url, BASE).pathname; } catch { /* url non valido: pagina 1 */ }
  const m = /\/pagina-(\d+)\/?$/.exec(path);
  const next = `/pagina-${(m ? Number(m[1]) : 1) + 1}`;
  return [...root.querySelectorAll('a[href]')].some((a) => new RegExp(`${next}/?$`).test(a.getAttribute('href') ?? ''));
}

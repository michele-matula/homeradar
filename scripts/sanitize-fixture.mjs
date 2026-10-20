// Uso: node scripts/sanitize-fixture.mjs <search|detail|api|idealista-search|idealista-detail|subito-search|subito-api|casadaprivato-search> <input> <output>
// Tiene solo la parte di JSON (Immobiliare, Subito) o di HTML (Idealista) che serve all'adattatore
// ed elimina dati personali e testi lunghi.
import { readFileSync, writeFileSync } from 'node:fs';

const KINDS = ['search', 'detail', 'api', 'idealista-search', 'idealista-detail', 'subito-search', 'subito-api', 'casadaprivato-search'];
const [kind, input, output] = process.argv.slice(2);
if (!KINDS.includes(kind) || !input || !output) {
  console.error(`Uso: node scripts/sanitize-fixture.mjs <${KINDS.join('|')}> <input> <output>`);
  process.exit(1);
}

const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/g;

if (kind.startsWith('subito-')) {
  // Si tengono solo i campi letti dall'adattatore. Via e civico possono stare nel titolo e nello slug:
  // titolo "{Categoria} in Via Esempio N", URL "/{categoria}/annuncio-{id}.htm".
  const FEATURES = new Set(['/price', '/size', '/room', '/floor', '/bathrooms']);
  const geoOf = (g) => g && Object.fromEntries(['region', 'city', 'town', 'zone'].filter((k) => g[k]).map((k) => [k, { id: g[k].id, value: g[k].value }]));
  const urlOf = (u, id) => `https://www.subito.it/${new URL(u).pathname.split('/')[1]}/annuncio-${id}.htm`;
  // Solo la prima immagine, come URL finto sullo stesso server: l'adattatore la usa come copertina.
  const fakeImage = (n) => `https://images.sbito.it/api/v1/sbt-ads-images-pro/images/00/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  const ad = (x, n, api) => {
    const id = /:list:(\d+)$/.exec(x.urn)?.[1];
    const c = x.category ?? {};
    const out = {
      kind: x.kind,
      urn: `id:ad:00000000-0000-0000-0000-000000000000:list:${id}`,
      type: x.type && { key: x.type.key, value: x.type.value },
      // __NEXT_DATA__: { id, label, parentId }; API: { key, value, macrocategory_id }.
      category: api ? { key: c.key, value: c.value, macrocategory_id: c.macrocategory_id } : { id: c.id, label: c.label, parentId: c.parentId },
      subject: `${c.label ?? c.value ?? 'Immobile'} in Via Esempio ${n}`,
      advertiser: { company: x.advertiser?.company, type: x.advertiser?.type },
      geo: geoOf(x.geo),
      urls: { default: urlOf(x.urls.default, id) },
    };
    if (x.images?.length) out.images = [api ? { cdn_base_url: fakeImage(n) } : { cdnBaseUrl: fakeImage(n) }];
    if (api) {
      out.dates = { display: x.dates?.display };
      out.features = (x.features ?? []).filter((f) => FEATURES.has(f.uri)).map((f) => ({ uri: f.uri, values: f.values.map((v) => ({ key: v.key })) }));
    } else {
      out.date = x.date;
      out.features = Object.fromEntries(Object.entries(x.features ?? {}).filter(([k]) => FEATURES.has(k)).map(([k, f]) => [k, { uri: k, values: f.values.map((v) => ({ key: v.key })) }]));
    }
    return out;
  };
  let out;
  if (kind === 'subito-search') {
    const { JSDOM } = await import('jsdom');
    const { document } = new JSDOM(readFileSync(input, 'utf8')).window;
    const items = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps.initialState.items;
    let n = 0;
    const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {})).map((x) => ad(x, ++n, false));
    out = { props: { pageProps: { initialState: { items: {
      total: items.total, originalList: list(items.originalList), galleryList: list(items.galleryList), boostedItems: list(items.boostedItems),
    } } } } };
  } else {
    const raw = JSON.parse(readFileSync(input, 'utf8'));
    out = { count_all: raw.count_all, lines: raw.lines, start: raw.start, ads: raw.ads.map((x, i) => ad(x, i + 1, true)) };
  }
  const text = JSON.stringify(out, null, 1);
  const suspicious = text.match(PHONE);
  if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
  writeFileSync(output, `${text}\n`);
  console.log(`OK: ${output}`);
  process.exit(0);
}

if (kind === 'casadaprivato-search') {
  // Lista dei campi ammessi: l'HTML si ricostruisce da pochi campi, non si ripulisce quello vero.
  // Descrizioni, sottotitoli liberi, vie vere, alt, preferiti e tutto il resto del sito restano fuori.
  const { JSDOM } = await import('jsdom');
  const { document } = new JSDOM(readFileSync(input, 'utf8')).window;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const text = (e) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Titolo "{tipologia} da Privato a {comune}[, {indirizzo o frazione}]": l'indirizzo diventa "Via Esempio N".
  const anonymizeTitle = (title, n) => {
    const m = /^(.+?) da Privato a ([^,]+)(,.*)?$/.exec(title.trim());
    if (!m) return `Immobile da Privato a Salerno${title.includes(',') ? `, Via Esempio ${n}` : ''}`;
    return `${m[1]} da Privato a ${m[2].trim()}${m[3] ? `, Via Esempio ${n}` : ''}`;
  };
  // Il sottotitolo è testo libero del privato: resta solo la forma "{parola} in vendita".
  const subtitleOf = (s) => (/^[\p{L}]+ in vendita$/u.test(s) && s.length <= 40 ? s : 'Immobile in vendita');
  const cardHtml = (item, n) => {
    const href = item.querySelector('h3 a')?.getAttribute('href') ?? item.querySelector('div.image a')?.getAttribute('href') ?? '';
    const m = /^\/([a-z-]+)\/.*?(\d+)$/.exec(href);
    if (!m) throw new Error(`Link annuncio non riconosciuto: ${href}`);
    const link = `/${m[1]}/annuncio-${m[2]}`;
    const hasCover = (item.querySelector('img.lazyload')?.getAttribute('data-src') ?? '') !== '';
    const cover = hasCover ? `https://static.casadaprivato.it/images/properties/mediumthumbs/${m[2]}/${n.toString(16).padStart(32, '0')}.jpg` : '';
    const priceEl = item.querySelector('div.price span');
    const priceText = esc(text(priceEl));
    const price = priceEl?.querySelector('small') ? `<small>${priceText}</small>` : priceText;
    const lis = [...item.querySelectorAll('ul.amenities > li')].map(text)
      .filter((t) => /^\d+\+? (locali|locale|mq|bagni|bagno)$/.test(t)).map((t) => `<li>${t}</li>`);
    return `<div class="item col-md-12"><div class="image"><a href="${link}"></a><img class="lazyload" src="/images/no-thumb.svg" data-src="${cover}"></div><div class="price"><span>${price}</span></div><div class="info"><h3><a href="${link}">${esc(anonymizeTitle(text(item.querySelector('h3 a')), n))}</a></h3><small class="subtitle">${esc(subtitleOf(text(item.querySelector('small.subtitle'))))}</small><ul class="amenities">${lis.join('')}</ul></div></div>`;
  };
  const listing = document.querySelector('#property-listing');
  const parts = [];
  if (listing) {
    const h1 = document.querySelector('h1.page-title');
    if (h1) parts.push(`<h1 class="page-title">${esc(text(h1))}</h1>`);
    const counter = document.querySelector('h2');
    if (counter) parts.push(`<h2>${esc(text(counter))}</h2>`);
    let n = 0;
    const rows = [];
    for (const el of listing.querySelectorAll('h2.similar-properties, div.item')) {
      if (el.matches('h2')) rows.push(`<h2 class="similar-properties section-title">${esc(text(el))}</h2>`);
      else if (el.querySelector('div.price')) rows.push(cardHtml(el, ++n));
    }
    parts.push(`<div id="property-listing"><div class="row">\n${rows.join('\n')}\n</div></div>`);
    const pages = [...new Set([...document.querySelectorAll('a[href*="/pagina-"]')]
      .map((a) => /\/annunci-vendita\/[a-z0-9\/-]+\/pagina-\d+$/.exec(a.getAttribute('href').replace(/^https?:\/\/[^/]+/, ''))?.[0]).filter(Boolean))];
    if (pages.length) parts.push(`<ul class="pagination">${pages.map((p) => `<li><a href="${p}">${p.split('-').pop()}</a></li>`).join('')}</ul>`);
  } else {
    const h1 = document.querySelector('h1');
    if (h1) parts.push(`<h1>${esc(text(h1))}</h1>`);
    const h3 = document.querySelector('.err h3');
    if (h3) parts.push(`<h3>${esc(text(h3))}</h3>`);
    const p = [...document.querySelectorAll('p')].find((x) => /La pagina che stai cercando/.test(x.textContent));
    if (p) parts.push(`<p>${esc(text(p))}</p>`);
  }
  const out = `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><title>Fixture CasaDaPrivato — ricerca</title></head><body>\n${parts.join('\n')}\n</body></html>\n`;
  const suspicious = out.match(PHONE);
  if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
  writeFileSync(output, out);
  console.log(`OK: ${output}`);
  process.exit(0);
}

if (kind.startsWith('idealista-')) {
  const { JSDOM } = await import('jsdom');
  const { document } = new JSDOM(readFileSync(input, 'utf8')).window;
  // Tipologia, zona e città restano; via e civico diventano "Via Esempio N".
  const anonymizeTitle = (title, n) => {
    const m = /^(.+?) in (vendita in )?(.+)$/.exec(title.trim());
    if (!m) return `Appartamento in Via Esempio ${n}, Centro, Milano`;
    const parts = m[3].split(',').map((s) => s.trim()).filter(Boolean);
    const city = parts.pop() ?? 'Milano';
    // Un numero (civico) non è una zona.
    const zone = parts.length > 1 && !/^\d/.test(parts.at(-1)) ? parts.pop() : 'Centro';
    return `${m[1]} in ${m[2] ?? ''}Via Esempio ${n}, ${zone}, ${city}`;
  };
  const KEEP_ATTRS = new Set(['class', 'data-element-id', 'data-is-professional-ad', 'href', 'title']);
  const REMOVE = 'script, style, noscript, iframe, img, source, svg, .item-description, .item-toolbar, .contact-phones, [class*="phone"], [class*="contact"], .logo-branding';
  const scrubNode = (root) => {
    root.querySelectorAll(REMOVE).forEach((e) => e.remove());
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) if (!KEEP_ATTRS.has(a.name)) el.removeAttribute(a.name);
      // href e title (che contiene l'indirizzo) restano solo sul link principale, poi anonimizzato.
      if (!el.classList.contains('item-link')) {
        if (el.tagName === 'A') el.removeAttribute('href');
        el.removeAttribute('title');
      }
    }
    return root;
  };
  let body;
  let title;
  if (kind === 'idealista-search') {
    const cards = [...document.querySelectorAll('article.item, article.adv')].map((c, i) => {
      const link = c.querySelector('a.item-link');
      // Annunci suggeriti delle zone vicine: l'indirizzo è nel testo della card.
      const geo = c.querySelector('.geo-reach-card__address');
      if (geo) geo.textContent = anonymizeTitle(geo.textContent, i + 1);
      if (link) {
        const t = anonymizeTitle(link.getAttribute('title') || link.textContent, i + 1);
        link.setAttribute('title', t);
        link.textContent = t;
      }
      // La copertina resta come URL finto sullo stesso server (lo scrub toglie tutte le img).
      const hasCover = /^https:\/\//.test(c.querySelector('picture.item-multimedia img')?.getAttribute('src') ?? '');
      const clean = scrubNode(c);
      const pic = clean.querySelector('picture.item-multimedia');
      if (hasCover && pic) pic.innerHTML = `<img src="https://img4.idealista.it/blur/480_360_mq/0/id.pro.it.image.master/00/00/00/${i + 1}.jpg">`;
      return clean.outerHTML;
    });
    body = `<main id="main-content"><section class="items-container items-list">\n${cards.join('\n')}\n</section></main>`;
    title = 'Fixture Idealista — ricerca';
  } else {
    // La scheda ha due .info-data (riassunto in alto e blocco prezzo con ribasso): si tengono entrambi.
    const infos = [...document.querySelectorAll('.info-data')].map((e) => scrubNode(e).outerHTML).join('');
    const features = document.querySelector('.info-features');
    // Del blocco inserzionista resta solo la struttura che distingue privato e agenzia, senza nomi.
    const seller = document.querySelector('.professional-name .particular')
      ? '<div class="professional-name"><span class="particular">Privato</span></div>'
      : document.querySelector('.professional-name') ? '<div class="professional-name"><span>Agenzia</span></div>' : '';
    body = `<main class="detail-container">${infos}${features ? scrubNode(features).outerHTML : ''}<aside class="advertiser-name">${seller}</aside></main>`;
    title = `${anonymizeTitle(document.title.split(' — ')[0], 1)} — idealista, N.1 in Italia`;
  }
  const out = `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><title>${title}</title></head><body>\n${body}\n</body></html>\n`;
  const suspicious = out.match(PHONE);
  if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
  writeFileSync(output, out);
  console.log(`OK: ${output}`);
  process.exit(0);
}

// Lista dei campi ammessi, come gli schemi zod dell'adattatore (src/adapters/immobiliare/schemas.ts): tutto il resto,
// compresi i campi che il sito aggiungerà, resta fuori. `true` tiene il valore; un oggetto descrive i figli; dentro un
// array la forma vale per ogni elemento. La foto non è qui: la copertina finta la aggiunge withCover.
const KEEP_REAL_ESTATE = {
  id: true, title: true, contract: true, createdAt: true,
  price: { visible: true, value: true, loweredPrice: { originalPrice: true, currentPrice: true, discountPercentage: true, date: true } },
  properties: { surface: true, rooms: true, typology: { name: true }, location: { address: true, city: true, macrozone: true, microzone: true } },
  advertiser: { agency: { type: true }, supervisor: { type: true } },
};
const KEEP_RESULT = { realEstate: KEEP_REAL_ESTATE, seo: { url: true } };

function pick(v, shape) {
  if (shape === true || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => pick(x, shape));
  if (typeof v !== 'object') return undefined;
  const out = {};
  for (const [k, s] of Object.entries(shape)) if (k in v) out[k] = pick(v[k], s);
  return out;
}

// Titolo e indirizzo contengono via e civico di privati: li sostituiamo con valori sintetici.
// Restano solo la tipologia (prima parola del titolo originale) e la zona.
function anonymize(re, n) {
  const loc = re.properties?.[0]?.location;
  const typology = String(re.title ?? 'Appartamento').split(' ')[0];
  const zone = loc?.microzone ?? loc?.macrozone ?? 'Centro';
  const city = loc?.city ?? 'Milano';
  const properties = re.properties?.map((p, i) => (i === 0 && p.location ? { ...p, location: { ...p.location, address: `Via Esempio ${n}` } } : p));
  return { ...re, title: `${typology} via Esempio ${n}, ${zone}, ${city}`, ...(properties ? { properties } : {}) };
}
// La copertina resta come URL finto sullo stesso server, numerato per annuncio: l'adattatore la legge.
const withCover = (re, original, n) => {
  if (!original?.properties?.[0]?.photo?.urls?.small || !re.properties?.[0]) return re;
  const [first, ...rest] = re.properties;
  return { ...re, properties: [{ ...first, photo: { urls: { small: `https://pwm.im-cdn.it/image/${n}/xxs-c.jpg` } } }, ...rest] };
};
const anonymizeResults = (results) => results.map((r, i) => {
  const s = pick(r, KEEP_RESULT);
  return { ...s, realEstate: withCover(anonymize(s.realEstate, i + 1), r.realEstate, i + 1) };
});

const raw = JSON.parse(readFileSync(input, 'utf8'));
let out;
if (kind === 'search') {
  const q = raw.props.pageProps.dehydratedState.queries.find((x) => Array.isArray(x?.state?.data?.results));
  const d = q.state.data;
  out = { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { count: d.count, currentPage: d.currentPage, results: anonymizeResults(d.results) } } }] } } } };
} else if (kind === 'detail') {
  out = { props: { pageProps: { detailData: { realEstate: anonymize(pick(raw.props.pageProps.detailData.realEstate, KEEP_REAL_ESTATE), 1) } } } };
} else {
  out = { count: raw.count, currentPage: raw.currentPage, results: anonymizeResults(raw.results) };
}

const text = JSON.stringify(out, null, 1);
const suspicious = text.match(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/g);
if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
writeFileSync(output, `${text}\n`);
console.log(`OK: ${output}`);

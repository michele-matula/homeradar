// Uso: node scripts/sanitize-fixture.mjs <search|detail|api|idealista-search|idealista-detail|subito-search|subito-api> <input> <output>
// Tiene solo la parte di JSON (Immobiliare, Subito) o di HTML (Idealista) che serve all'adattatore
// ed elimina dati personali e testi lunghi.
import { readFileSync, writeFileSync } from 'node:fs';

const KINDS = ['search', 'detail', 'api', 'idealista-search', 'idealista-detail', 'subito-search', 'subito-api'];
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

const DROP = new Set([
  'phones', 'phone', 'displayName', 'label', 'agencyUrl', 'imageUrls', 'image', 'imageGender', 'imageType',
  'description', 'defaultDescription', 'caption', 'multimedia', 'photo', 'photos',
  'featureList', 'features', 'ga4features', 'mainFeatures', 'primaryFeatures', 'costs', 'cadastrals', 'energy',
  // Riconducono al venditore o alla casa: immagine del telefono, testo del link con via e civico, posizione esatta.
  'phoneUrl', 'anchor', 'latitude', 'longitude', 'marker', 'idGeoHash',
]);

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
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
  const s = scrub(r);
  return { ...s, realEstate: withCover(anonymize(s.realEstate, i + 1), r.realEstate, i + 1) };
});

const raw = JSON.parse(readFileSync(input, 'utf8'));
let out;
if (kind === 'search') {
  const q = raw.props.pageProps.dehydratedState.queries.find((x) => Array.isArray(x?.state?.data?.results));
  const d = q.state.data;
  out = { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { count: d.count, currentPage: d.currentPage, results: anonymizeResults(d.results) } } }] } } } };
} else if (kind === 'detail') {
  out = { props: { pageProps: { detailData: { realEstate: anonymize(scrub(raw.props.pageProps.detailData.realEstate), 1) } } } };
} else {
  out = { count: raw.count, currentPage: raw.currentPage, results: anonymizeResults(raw.results) };
}

const text = JSON.stringify(out, null, 1);
const suspicious = text.match(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/g);
if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
writeFileSync(output, `${text}\n`);
console.log(`OK: ${output}`);

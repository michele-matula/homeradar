const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Result = { realEstate: { id: number; title: string } };

export function buildSearchHtml(nextData: { props: { pageProps: { dehydratedState: { queries: { state: { data: { results: Result[] } } }[] } } } }): string {
  const results = nextData.props.pageProps.dehydratedState.queries[0]!.state.data.results;
  const cards = results
    .map((r) => `<li><div class="nd-slideshow__content"><img src="${GIF}" width="150" height="100"></div><a href="https://www.immobiliare.it/annunci/${r.realEstate.id}/">${esc(r.realEstate.title)}</a></li>`)
    .join('');
  const json = JSON.stringify(nextData).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body>
<ul id="list">${cards}</ul>
<button id="next">Pagina successiva</button>
<button id="nav-no-data">Naviga senza dati</button>
<script id="__NEXT_DATA__" type="application/json">${json}</script>
<script>
document.getElementById('next').addEventListener('click', function () {
  var x = new XMLHttpRequest();
  x.open('GET', '/api-next/search-list/listings/?pag=2');
  x.onload = function () {
    var d = JSON.parse(x.responseText);
    document.getElementById('list').innerHTML = d.results.map(function (r) {
      return '<li><div class="nd-slideshow__content"><img src="${GIF}"></div><a href="https://www.immobiliare.it/annunci/' + r.realEstate.id + '/">x</a></li>';
    }).join('');
    history.pushState({}, '', '/vendita-case/milano/da-privati/?pag=2');
  };
  x.send();
});
document.getElementById('nav-no-data').addEventListener('click', function () {
  // Nuovi annunci arrivati per una via che l'estensione non intercetta.
  document.getElementById('list').innerHTML = '<li><div class="nd-slideshow__content"><img src="${GIF}"></div><a href="https://www.immobiliare.it/annunci/999999999/">x</a></li>';
  history.pushState({}, '', '/vendita-case/milano/da-privati/?pag=3');
});
</script></body></html>`;
}

type SubitoAd = { urn: string; subject: string; urls: { default: string } };
type SubitoNextData = { props: { pageProps: { initialState: { items: { originalList: SubitoAd[]; galleryList?: SubitoAd[]; boostedItems?: SubitoAd[] } } } } };

// Struttura della card verificata su Subito.it il 2026-10-13: contenitore foto, link sovrapposto, testi.
const subitoCard = (url: string, title: string) =>
  `<article><div><img src="${GIF}" width="150" height="100"><figure><img src="${GIF}"></figure><button></button></div><a href="${url}"></a><section><h3>${esc(title)}</h3></section></article>`;

export function buildSubitoSearchHtml(nextData: SubitoNextData): string {
  const { originalList, galleryList = [], boostedItems = [] } = nextData.props.pageProps.initialState.items;
  const cards = [...boostedItems, ...galleryList, ...originalList].map((a) => subitoCard(a.urls.default, a.subject)).join('');
  const json = JSON.stringify(nextData).replace(/</g, '\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture Subito</title></head><body>
<div id="list">${cards}</div>
<button id="next">Pagina 2</button>
<script id="__NEXT_DATA__" type="application/json">${json}</script>
<script>
document.getElementById('next').addEventListener('click', function () {
  fetch('https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30').then(function (r) { return r.json(); }).then(function (d) {
    document.getElementById('list').innerHTML = d.ads.map(function (a) {
      return '<article><div><img src="${GIF}"><figure><img src="${GIF}"></figure></div><a href="' + a.urls.default + '"></a><section><h3>x</h3></section></article>';
    }).join('');
    history.pushState({}, '', '/annunci-lombardia/vendita/appartamenti/milano/milano/?o=2');
  });
});
</script></body></html>`;
}

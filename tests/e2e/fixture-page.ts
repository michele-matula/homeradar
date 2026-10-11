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

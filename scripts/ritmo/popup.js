const $ = (id) => document.getElementById(id);
fetch(chrome.runtime.getURL('urls.txt')).then((r) => r.text()).then((t) => { if (!$('urls').value) $('urls').value = t.trim(); });
$('start').onclick = () => chrome.runtime.sendMessage({ type: 'start', urls: $('urls').value.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('https://')) });
$('stop').onclick = () => chrome.runtime.sendMessage({ type: 'stop' });
$('copy').onclick = async () => navigator.clipboard.writeText(JSON.stringify((await chrome.storage.local.get('results')).results ?? [], null, 1));
async function render() {
  const { results = [], running } = await chrome.storage.local.get(['results', 'running']);
  $('state').textContent = running ? `in corso: ${results.length} pagine` : `ferma: ${results.length} pagine`;
  $('out').innerHTML = results.map((r) => `<tr class="${r.blocked ? 'b' : ''}"><td>${r.at.slice(11, 19)}</td><td>${r.ms} ms</td><td>${r.error ?? (r.blocked ? 'VERIFICA' : r.notFound ? 'non trovata' : `${r.privates}/${r.results} priv. · ${r.pages ?? '?'} pag.`)}</td><td>${r.url.replace('https://www.', '')}</td></tr>`).join('');
}
render();
setInterval(render, 1000);

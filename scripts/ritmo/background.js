// Prova di ritmo: una scheda, una finestra ridotta a icona, una pagina alla volta con pause casuali.
// Non fa richieste proprie: solo navigazioni, come farebbe l'agente.
const PAUSE = { 'www.immobiliare.it': [4000, 10000], 'www.idealista.it': [8000, 14000], 'www.subito.it': [4000, 10000] };
const TIMEOUT_MS = 45000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;

// Tiene sveglio il service worker durante la prova.
let keepAlive = null;

function waitComplete(tabId) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); resolve(false); }, TIMEOUT_MS);
    function l(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(true); }
    }
    chrome.tabs.onUpdated.addListener(l);
  });
}

// Eseguita nella pagina: conta annunci e privati senza leggere nomi o telefoni.
function inspect() {
  const text = document.body ? document.body.innerText : '';
  const blocked = !!document.querySelector('iframe[src*="captcha-delivery.com"]') || /Al momento non siamo disponibili/i.test(text);
  const notFound = /La pagina che stai cercando non è presente/i.test(text);
  let results = null, privates = null, pages = null;
  const nd = document.getElementById('__NEXT_DATA__');
  try {
    if (nd && location.hostname === 'www.immobiliare.it') {
      const d = JSON.parse(nd.textContent).props.pageProps.dehydratedState.queries[0].state.data;
      results = d.results.length; privates = d.results.filter((r) => !r.realEstate.advertiser?.agency).length; pages = d.maxPages;
    } else if (nd && location.hostname === 'www.subito.it') {
      const it = JSON.parse(nd.textContent).props.pageProps.initialState.items;
      results = it.originalList.length; privates = it.originalList.filter((x) => !(x.item || x).advertiser?.company).length; pages = it.totalPages;
    } else if (location.hostname === 'www.idealista.it') {
      const cards = [...document.querySelectorAll('article.item[data-element-id]:not(.geo-reach-card)')];
      results = cards.length; privates = cards.filter((a) => a.dataset.isProfessionalAd === 'false').length;
    }
  } catch (e) { /* forma inattesa: restano null */ }
  return { title: document.title, blocked, notFound, results, privates, pages };
}

async function run(urls) {
  running = true;
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  const out = [];
  await chrome.storage.local.set({ results: out, running: true });
  const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false, type: 'normal' });
  const tabId = win.tabs[0].id;
  for (const url of urls) {
    if (!running) break;
    const host = new URL(url).hostname;
    const started = Date.now();
    await chrome.tabs.update(tabId, { url });
    const complete = await waitComplete(tabId);
    await sleep(1500);
    let info = { error: 'timeout' };
    if (complete) {
      try { info = (await chrome.scripting.executeScript({ target: { tabId }, func: inspect }))[0].result; }
      catch (e) { info = { error: String(e) }; }
    }
    out.push({ at: new Date(started).toISOString(), url, ms: Date.now() - started, ...info });
    await chrome.storage.local.set({ results: out });
    if (info.blocked) break;
    const [min, max] = PAUSE[host] || [5000, 10000];
    await sleep(min + Math.random() * (max - min));
  }
  await chrome.windows.remove(win.id).catch(() => {});
  clearInterval(keepAlive);
  running = false;
  await chrome.storage.local.set({ running: false });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'start' && !running) run(msg.urls);
  if (msg.type === 'stop') running = false;
});

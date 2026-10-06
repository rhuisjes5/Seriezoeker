const API_ROOT = 'https://api.themoviedb.org/3';
const IMAGE_ROOT = 'https://image.tmdb.org/t/p/w342';
const TMDB_IMAGE_ROOT = 'https://image.tmdb.org/t/p';
const FORMAT = 'serie-manager-mobile';
const KEY_STORAGE = 'seriezoeker.tmdb-key.v1';
const QUEUE_STORAGE = 'seriezoeker.queue.v1';
const BRIDGE_STORAGE = 'seriezoeker.manager-token.v1';
const BRIDGE_URL_STORAGE = 'seriezoeker.manager-url.v1';

const ui = Object.fromEntries([
  'searchForm searchInput searchButton statusLine resultsList resultCount resultsEmpty queueList queueCount queueEmpty sendButton exportButton clearButton settingsPanel settingsButton closeSettings apiKeyInput saveKeyButton forgetKeyButton installButton scanPairButton pairScannerDialog pairScannerVideo scannerMessage connectScannerButton closeScannerButton cancelScannerButton'
].join(' ').split(' ').map((id) => [id, document.getElementById(id)]));

let queue = readQueue();
let results = [];
let installPrompt = null;
let scannerStream = null;
let scannerFrame = 0;
let scannerActive = false;
let scannerRequest = 0;
let pendingPairing = null;
const scannerCanvas = document.createElement('canvas');
const scannerContext = scannerCanvas.getContext('2d', { willReadFrequently: true });

function readQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_STORAGE) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function setStatus(text, tone = '') {
  ui.statusLine.textContent = text;
  ui.statusLine.dataset.tone = tone;
}

function bridgeErrorMessage(error) {
  if (error instanceof TypeError || /failed to fetch|networkerror/i.test(error.message || '')) {
    return 'Chrome kan de pc niet bereiken. Sta lokaal-netwerktoegang toe voor deze site en controleer of het CA-certificaat is geïnstalleerd, beide apparaten op hetzelfde wifi zitten, Serie Manager open is en Windows Firewall de verbinding toestaat.';
  }
  return error.message || 'Serie Manager is niet bereikbaar. Controleer wifi en koppel opnieuw.';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function poster(path, title, className = 'poster') {
  return path
    ? `<img class="${className}" src="${IMAGE_ROOT}${encodeURI(path)}" alt="Poster van ${esc(title)}" loading="lazy">`
    : `<div class="${className} poster-placeholder" aria-label="Geen poster">S</div>`;
}

function renderResults() {
  ui.resultCount.textContent = String(results.length);
  if (!results.length) {
    ui.resultsList.replaceChildren(ui.resultsEmpty);
    return;
  }
  ui.resultsList.innerHTML = results.map((show, index) => {
    const year = show.first_air_date?.slice(0, 4) || 'Jaar onbekend';
    const saved = queue.some((item) => Number(item.tmdb_id) === Number(show.id));
    return `<article class="result-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
      ${poster(show.poster_path, show.name)}
      <div class="result-info"><h3 class="result-title">${esc(show.name)}</h3>
        <p class="result-meta">${esc(year)}${show.original_name && show.original_name !== show.name ? ` · ${esc(show.original_name)}` : ''}</p>
        <p class="result-overview">${esc(show.overview || 'Geen beschrijving beschikbaar.')}</p>
      </div>
      <button class="button add-button" type="button" data-add="${esc(show.id)}" ${saved ? 'disabled' : ''}>${saved ? 'Op lijst' : '+ Lijst'}</button>
    </article>`;
  }).join('');
  ui.resultsList.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => addShow(button.dataset.add)));
}

function renderQueue() {
  localStorage.setItem(QUEUE_STORAGE, JSON.stringify(queue));
  ui.queueCount.textContent = String(queue.length);
  ui.sendButton.disabled = queue.length === 0;
  ui.exportButton.disabled = queue.length === 0;
  ui.queueEmpty.hidden = queue.length > 0;
  ui.clearButton.hidden = queue.length === 0;
  if (!queue.length) ui.queueList.replaceChildren();
  else {
    ui.queueList.innerHTML = queue.map((show) => `<article class="queue-item">
      ${poster(show.poster_path, show.serie, 'queue-poster')}
      <div><h3 class="queue-title">${esc(show.serie)}</h3><p class="queue-year">${esc(show.start_jaar || 'Jaar onbekend')}</p></div>
      <button class="remove-button" type="button" data-remove="${esc(show.tmdb_id)}" aria-label="Verwijder ${esc(show.serie)}">×</button>
    </article>`).join('');
    ui.queueList.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => {
      queue = queue.filter((show) => String(show.tmdb_id) !== button.dataset.remove);
      renderQueue();
    }));
  }
  renderResults();
}

function getKey() { return localStorage.getItem(KEY_STORAGE) || ''; }

async function searchShows(event) {
  event?.preventDefault();
  const key = getKey();
  const query = ui.searchInput.value.trim();
  if (!key) {
    openSettings();
    setStatus('Vul eerst je TMDB API-sleutel in bij Instellingen.', 'error');
    return;
  }
  if (!query) {
    setStatus('Vul een serienaam in om te zoeken.');
    ui.searchInput.focus();
    return;
  }
  ui.searchButton.disabled = true;
  ui.searchButton.textContent = 'Zoeken…';
  setStatus(`Zoeken naar “${query}”…`);
  try {
    const url = new URL(`${API_ROOT}/search/tv`);
    url.searchParams.set('api_key', key);
    url.searchParams.set('query', query);
    url.searchParams.set('language', 'nl-NL');
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.status === 401 ? 'TMDB-sleutel ongeldig. Controleer Instellingen.' : `TMDB gaf fout ${response.status}.`);
    const body = await response.json();
    results = (body.results || []).slice(0, 12);
    renderResults();
    setStatus(results.length ? `${results.length} resultaten. Controleer titel en startjaar.` : 'Geen series gevonden.', results.length ? 'success' : '');
  } catch (error) {
    results = [];
    renderResults();
    setStatus(error.message || 'Zoeken mislukt. Controleer je internetverbinding.', 'error');
  } finally {
    ui.searchButton.disabled = false;
    ui.searchButton.textContent = 'Zoek';
  }
}

async function addShow(id) {
  const show = results.find((item) => String(item.id) === String(id));
  if (!show || queue.some((item) => Number(item.tmdb_id) === Number(show.id))) return;
  let tvdb = `https://thetvdb.com/search?query=${encodeURIComponent(show.name || '')}`;
  try {
    const url = new URL(`${API_ROOT}/tv/${show.id}/external_ids`);
    url.searchParams.set('api_key', getKey());
    const response = await fetch(url);
    if (response.ok) {
      const external = await response.json();
      if (external.tvdb_id) tvdb = `https://thetvdb.com/series/${encodeURIComponent(external.tvdb_id)}`;
    }
  } catch { /* Keep the TVDB search link. */ }
  queue.push({
    serie: show.name || show.original_name || '',
    start_jaar: show.first_air_date?.slice(0, 4) || '',
    image_path: show.backdrop_path
      ? `${TMDB_IMAGE_ROOT}/w1280${show.backdrop_path}`
      : show.poster_path ? `${TMDB_IMAGE_ROOT}/w500${show.poster_path}` : '',
    poster_path: show.poster_path || '',
    tvdb,
    status: '0',
    next_air_date: 'Nog niet bekend',
    tmdb_id: show.id,
  });
  renderQueue();
  setStatus(`${show.name} staat op je importlijst.`, 'success');
}

function exportQueue() {
  if (!queue.length) return;
  const data = { format: 'serie-manager-mobile', version: 1, exported_at: new Date().toISOString(), series: queue };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `serie-manager-mobiel-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`${queue.length} ${queue.length === 1 ? 'serie geëxporteerd' : 'series geëxporteerd'}.`, 'success');
}

async function sendQueueToManager() {
  const token = localStorage.getItem(BRIDGE_STORAGE) || '';
  const bridgeUrl = localStorage.getItem(BRIDGE_URL_STORAGE) || '';
  if (!token || !bridgeUrl || !queue.length) return;
  ui.sendButton.disabled = true;
  ui.sendButton.textContent = 'Versturen…';
  try {
    const response = await fetch(new URL('/api/import', bridgeUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: FORMAT, version: 1, token, series: queue }),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Serie Manager stuurde geen API-antwoord. Scan de QR opnieuw vanuit de mobiele app.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Versturen mislukt (${response.status}).`);
    const completed = new Set([...(result.imported || []), ...(result.skipped || [])].map((name) => name.toLocaleLowerCase()));
    queue = queue.filter((show) => !completed.has(show.serie.toLocaleLowerCase()));
    renderQueue();
    setStatus(`${(result.imported || []).length} toegevoegd; ${(result.skipped || []).length} bestond al in Serie Manager.`, 'success');
  } catch (error) {
    setStatus(bridgeErrorMessage(error), 'error');
  } finally {
    ui.sendButton.textContent = 'Verstuur direct naar Serie Manager';
    ui.sendButton.disabled = queue.length === 0;
  }
}

async function connectPairingToken(token, bridgeUrl = location.origin) {
  if (!token) return;
  try {
    const endpoint = new URL('/api/status', bridgeUrl);
    endpoint.searchParams.set('token', token);
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('De koppeling is ongeldig of Serie Manager is niet bereikbaar.');
    localStorage.setItem(BRIDGE_STORAGE, token);
    localStorage.setItem(BRIDGE_URL_STORAGE, new URL(bridgeUrl).origin);
    ui.sendButton.hidden = false;
    setStatus('Verbonden met Serie Manager op dit wifi-netwerk.', 'success');
    if (ui.pairScannerDialog.open) ui.pairScannerDialog.close();
  } catch (error) {
    localStorage.removeItem(BRIDGE_STORAGE);
    localStorage.removeItem(BRIDGE_URL_STORAGE);
    ui.sendButton.hidden = true;
    const message = bridgeErrorMessage(error);
    setStatus(message, 'error');
    if (ui.pairScannerDialog.open) ui.scannerMessage.textContent = message;
  }
}

function isLocalManagerAddress(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function stopPairingScan() {
  scannerRequest += 1;
  scannerActive = false;
  clearTimeout(scannerFrame);
  scannerStream?.getTracks().forEach((track) => track.stop());
  scannerStream = null;
  ui.pairScannerVideo.srcObject = null;
}

function readPairingQr(value) {
  const pairingUrl = new URL(value);
  const token = pairingUrl.searchParams.get('pair');
  if (!['http:', 'https:'].includes(pairingUrl.protocol) || !isLocalManagerAddress(pairingUrl.hostname) || !token) {
    throw new Error('Deze QR-code bevat geen lokale Serie Manager-koppeling.');
  }
  return { token, origin: pairingUrl.origin };
}

function showPairingConfirmation(value) {
  pendingPairing = readPairingQr(value);
  stopPairingScan();
  ui.scannerMessage.textContent = 'QR herkend. Tik op Verbinden en sta toegang tot je lokale netwerk toe.';
  ui.connectScannerButton.hidden = false;
  ui.connectScannerButton.focus();
}

async function scanPairingFrame() {
  if (!scannerActive || ui.pairScannerVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    if (scannerActive) scannerFrame = setTimeout(scanPairingFrame, 120);
    return;
  }
  try {
    const { videoWidth, videoHeight } = ui.pairScannerVideo;
    const scale = Math.min(1, 960 / Math.max(videoWidth, videoHeight));
    scannerCanvas.width = Math.max(1, Math.round(videoWidth * scale));
    scannerCanvas.height = Math.max(1, Math.round(videoHeight * scale));
    scannerContext.drawImage(ui.pairScannerVideo, 0, 0, scannerCanvas.width, scannerCanvas.height);
    const pixels = scannerContext.getImageData(0, 0, scannerCanvas.width, scannerCanvas.height);
    const result = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    if (result?.data) {
      showPairingConfirmation(result.data);
      return;
    }
  } catch (error) {
    ui.scannerMessage.textContent = error.message || 'De QR-code kon niet worden gelezen.';
  }
  if (scannerActive) scannerFrame = setTimeout(scanPairingFrame, 120);
}

async function startPairingScan() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('Voor scannen is HTTPS en cameratoegang nodig.', 'error');
    return;
  }
  if (typeof window.jsQR !== 'function') {
    setStatus('De lokale QR-decoder kon niet worden geladen. Herlaad de app en probeer opnieuw.', 'error');
    return;
  }
  const requestId = ++scannerRequest;
  try {
    ui.scannerMessage.textContent = 'Vraag cameratoegang aan…';
    ui.pairScannerDialog.showModal();
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if (!ui.pairScannerDialog.open || requestId !== scannerRequest) {
      stopPairingScan();
      return;
    }
    ui.pairScannerVideo.srcObject = scannerStream;
    await ui.pairScannerVideo.play();
    scannerActive = true;
    ui.scannerMessage.textContent = 'Richt de camera op de QR-code in Serie Manager.';
    scannerFrame = requestAnimationFrame(scanPairingFrame);
  } catch (error) {
    const requestIsCurrent = requestId === scannerRequest;
    stopPairingScan();
    if (!requestIsCurrent) return;
    ui.scannerMessage.textContent = error.message || 'Cameratoegang mislukt. Controleer de browsermachtiging.';
    if (!ui.pairScannerDialog.open) ui.pairScannerDialog.showModal();
  }
}

function openSettings() {
  ui.settingsPanel.hidden = false;
  ui.settingsButton.setAttribute('aria-expanded', 'true');
  ui.apiKeyInput.value = getKey();
  ui.apiKeyInput.focus();
}

function closeSettings() {
  ui.settingsPanel.hidden = true;
  ui.settingsButton.setAttribute('aria-expanded', 'false');
}

ui.searchForm.addEventListener('submit', searchShows);
ui.settingsButton.addEventListener('click', () => ui.settingsPanel.hidden ? openSettings() : closeSettings());
ui.closeSettings.addEventListener('click', closeSettings);
ui.saveKeyButton.addEventListener('click', () => {
  const key = ui.apiKeyInput.value.trim();
  if (!key) return setStatus('Vul een TMDB API-sleutel in.', 'error');
  localStorage.setItem(KEY_STORAGE, key);
  closeSettings();
  setStatus('TMDB-sleutel lokaal bewaard.', 'success');
  if (ui.searchInput.value.trim()) searchShows();
});
ui.forgetKeyButton.addEventListener('click', () => {
  localStorage.removeItem(KEY_STORAGE);
  ui.apiKeyInput.value = '';
  setStatus('TMDB-sleutel van dit apparaat gewist.');
});
ui.exportButton.addEventListener('click', exportQueue);
ui.sendButton.addEventListener('click', sendQueueToManager);
ui.scanPairButton.addEventListener('click', startPairingScan);
ui.connectScannerButton.addEventListener('click', async () => {
  if (!pendingPairing) return;
  ui.connectScannerButton.disabled = true;
  ui.connectScannerButton.textContent = 'Verbinden…';
  await connectPairingToken(pendingPairing.token, pendingPairing.origin);
  ui.connectScannerButton.disabled = false;
  ui.connectScannerButton.textContent = 'Verbinden met Serie Manager';
});
ui.closeScannerButton.addEventListener('click', () => ui.pairScannerDialog.close());
ui.cancelScannerButton.addEventListener('click', () => ui.pairScannerDialog.close());
ui.pairScannerDialog.addEventListener('close', () => {
  stopPairingScan();
  pendingPairing = null;
  ui.connectScannerButton.hidden = true;
});
ui.clearButton.addEventListener('click', () => {
  if (!queue.length || !confirm('De volledige importlijst wissen?')) return;
  queue = [];
  renderQueue();
  setStatus('Importlijst gewist.');
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  ui.installButton.hidden = false;
});
ui.installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  ui.installButton.hidden = true;
});

renderQueue();
const pairToken = new URLSearchParams(location.search).get('pair');
if (pairToken) {
  history.replaceState(null, '', location.pathname);
  connectPairingToken(pairToken, location.origin);
} else if (localStorage.getItem(BRIDGE_STORAGE) && localStorage.getItem(BRIDGE_URL_STORAGE)) {
  connectPairingToken(localStorage.getItem(BRIDGE_STORAGE), localStorage.getItem(BRIDGE_URL_STORAGE));
}
if (!getKey()) openSettings();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
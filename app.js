const API_ROOT = 'https://api.themoviedb.org/3';
const IMAGE_ROOT = 'https://image.tmdb.org/t/p/w342';
const FORMAT = 'serie-manager-mobile';
const KEY_STORAGE = 'seriezoeker.tmdb-key.v1';
const QUEUE_STORAGE = 'seriezoeker.queue.v1';
const BRIDGE_STORAGE = 'seriezoeker.manager-token.v1';
const BRIDGE_URL_STORAGE = 'seriezoeker.manager-url.v1';

const ui = Object.fromEntries([
  'searchForm searchInput searchButton statusLine resultsList resultCount resultsEmpty queueList queueCount queueEmpty sendButton exportButton clearButton settingsPanel settingsButton closeSettings apiKeyInput saveKeyButton forgetKeyButton installButton scanPairButton pairScannerDialog pairScannerVideo scannerMessage connectScannerButton closeScannerButton cancelScannerButton detailDialog detailTitle detailContent detailAddButton closeDetailButton'
].join(' ').split(' ').map((id) => [id, document.getElementById(id)]));

let queue = readQueue();
let results = [];
let installPrompt = null;
let scannerStream = null;
let scannerFrame = 0;
let scannerActive = false;
let scannerRequest = 0;
let pendingPairing = null;
let activeDetailId = null;
const detailCache = new Map();
const scannerCanvas = document.createElement('canvas');
const scannerContext = scannerCanvas.getContext('2d', { willReadFrequently: true });

function isEndedSeries(tmdbInfo) {
  const status = String(tmdbInfo?.status || '').toLocaleLowerCase();
  return status.includes('ended') || status.includes('cancel') || tmdbInfo?.in_production === false;
}

function getTvDetails(id) {
  if (!detailCache.has(String(id))) {
    const request = (async () => {
      const url = new URL(`${API_ROOT}/tv/${id}`);
      url.searchParams.set('api_key', getKey());
      url.searchParams.set('language', 'nl-NL');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`TMDB gaf fout ${response.status}.`);
      return response.json();
    })();
    detailCache.set(String(id), request);
      request.catch(() => detailCache.delete(String(id)));
  }
  return detailCache.get(String(id));
}

function compactTmdbInfo(details) {
  return details ? {
    status: details.status,
    in_production: details.in_production,
    last_air_date: details.last_air_date,
    next_episode_to_air: details.next_episode_to_air,
    seasons: (details.seasons || []).map(({ season_number }) => ({ season_number })),
  } : null;
}

function overviewButton(text) {
  return `<button class="detail-overview" type="button" data-toggle-overview aria-expanded="false" aria-label="Vergroot de beschrijving">${esc(text)}</button>`;
}

function tvdbSeriesUrl(seriesName) {
  const slug = String(seriesName || '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug
    ? `https://thetvdb.com/series/${slug}`
    : `https://thetvdb.com/search?query=${encodeURIComponent(seriesName || '')}`;
}

function readQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_STORAGE) || '[]');
    if (!Array.isArray(value)) return [];
    let migrated = false;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      if (/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+\//i.test(item.image_path || '')) {
        item.image_path = '';
        migrated = true;
      }
      if (/^https:\/\/thetvdb\.com\/series\/\d+\/?$/i.test(item.tvdb || '')) {
        item.tvdb = tvdbSeriesUrl(item.serie);
        migrated = true;
      }
      if (item.status !== '4') {
        item.status = '4';
        migrated = true;
      }
    }
    if (migrated) localStorage.setItem(QUEUE_STORAGE, JSON.stringify(value));
    return value;
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
    return `<article class="result-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <button class="result-detail" type="button" data-details="${esc(show.id)}" aria-label="Meer informatie over ${esc(show.name)}">
        ${poster(show.poster_path, show.name)}
        <span class="result-info"><span class="result-title">${esc(show.name)}</span>
          <span class="result-meta">${esc(year)}${show.original_name && show.original_name !== show.name ? ` · ${esc(show.original_name)}` : ''}</span>
          <span class="result-overview">${esc(show.overview || 'Geen beschrijving beschikbaar.')}</span>
        </span>
      </button>
    </article>`;
  }).join('');
  ui.resultsList.querySelectorAll('[data-details]').forEach((button) => button.addEventListener('click', () => openShowDetails(button.dataset.details)));
}

async function openShowDetails(id) {
  const show = results.find((item) => String(item.id) === String(id));
  if (!show) return;
  activeDetailId = String(id);
  ui.detailTitle.textContent = show.name || show.original_name || 'Serie-informatie';
  ui.detailContent.innerHTML = '<p class="detail-loading">Seriegegevens laden…</p>';
  const saved = queue.some((item) => Number(item.tmdb_id) === Number(show.id));
  ui.detailAddButton.disabled = saved;
  ui.detailAddButton.textContent = saved ? 'Op lijst' : '+ Lijst';
  ui.detailDialog.showModal();
  try {
    const details = await getTvDetails(show.id);
    if (activeDetailId !== String(id) || !ui.detailDialog.open) return;
    const genres = (details.genres || []).map((genre) => genre.name).filter(Boolean).join(', ');
    const networks = (details.networks || []).map((network) => network.name).filter(Boolean).join(', ');
    const seasonCount = (details.seasons || []).filter((season) => season.season_number > 0).length;
    const overview = details.overview || show.overview || 'Geen beschrijving beschikbaar.';
    const facts = [
      details.first_air_date?.slice(0, 4) || 'Jaar onbekend',
      details.number_of_episodes ? `${details.number_of_episodes} afleveringen` : '',
      seasonCount ? `${seasonCount} seizoenen` : '',
      details.status || '',
    ].filter(Boolean);
    ui.detailContent.innerHTML = `<div class="detail-layout">${poster(details.poster_path || show.poster_path, show.name, 'detail-poster')}<div class="detail-copy"><p class="detail-meta">${esc(facts.join(' · '))}</p>${overviewButton(overview)}${genres ? `<p><strong>Genres</strong><br>${esc(genres)}</p>` : ''}${networks ? `<p><strong>Zender / netwerk</strong><br>${esc(networks)}</p>` : ''}${details.tagline ? `<p class="detail-tagline">“${esc(details.tagline)}”</p>` : ''}</div></div>`;
  } catch {
    if (activeDetailId === String(id) && ui.detailDialog.open) {
      ui.detailContent.innerHTML = `<div class="detail-layout">${poster(show.poster_path, show.name, 'detail-poster')}<div class="detail-copy">${overviewButton(show.overview || 'Extra seriegegevens zijn nu niet beschikbaar.')}</div></div>`;
    }
  }
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
    const seriesName = show.name || show.original_name || '';
  const tvdb = tvdbSeriesUrl(seriesName);
  let tmdbInfo = null;
  try { tmdbInfo = compactTmdbInfo(await getTvDetails(show.id)); }
  catch { /* Folder setup can use the default ongoing-series template. */ }
  queue.push({
    serie: seriesName,
    start_jaar: show.first_air_date?.slice(0, 4) || '',
    image_path: '',
    poster_path: show.poster_path || '',
    tvdb,
    status: '4',
    next_air_date: 'Nog niet bekend',
    tmdb_id: show.id,
    tmdb_info: tmdbInfo,
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

async function refreshQueuedTmdbStatus() {
  const key = getKey();
  if (!key) return;
  for (const show of queue) {
    if (!show.tmdb_id || show.tmdb_info) {
      if (isEndedSeries(show.tmdb_info) && show.status !== '4') show.status = '2';
      continue;
    }
    try {
      const details = await getTvDetails(show.tmdb_id);
      show.tmdb_info = compactTmdbInfo(details);
      if (isEndedSeries(show.tmdb_info) && show.status !== '4') show.status = '2';
    } catch { /* Keep the saved status if TMDB is unavailable. */ }
  }
  localStorage.setItem(QUEUE_STORAGE, JSON.stringify(queue));
}

async function sendQueueToManager() {
  const token = localStorage.getItem(BRIDGE_STORAGE) || '';
  const bridgeUrl = localStorage.getItem(BRIDGE_URL_STORAGE) || '';
  if (!token || !bridgeUrl || !queue.length) return;
  ui.sendButton.disabled = true;
  ui.sendButton.textContent = 'Versturen…';
  try {
    await refreshQueuedTmdbStatus();
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
ui.closeDetailButton.addEventListener('click', () => ui.detailDialog.close());
ui.detailDialog.addEventListener('close', () => { activeDetailId = null; });
ui.detailContent.addEventListener('click', (event) => {
  const button = event.target.closest('[data-toggle-overview]');
  if (!button) return;
  const enlarged = button.classList.toggle('is-large');
  button.setAttribute('aria-expanded', String(enlarged));
  button.setAttribute('aria-label', enlarged ? 'Verklein de beschrijving' : 'Vergroot de beschrijving');
});
ui.detailAddButton.addEventListener('click', async () => {
  if (!activeDetailId || ui.detailAddButton.disabled) return;
  const id = activeDetailId;
  await addShow(id);
  ui.detailAddButton.disabled = true;
  ui.detailAddButton.textContent = 'Op lijst';
});
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
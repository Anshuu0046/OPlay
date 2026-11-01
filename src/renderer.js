window.addEventListener('error', event => { window.aether.reportError({ source: 'renderer-error', message: String(event.error?.stack || event.message).slice(0, 8000) }).catch(() => {}); });
window.addEventListener('unhandledrejection', event => { window.aether.reportError({ source: 'renderer-rejection', message: String(event.reason?.stack || event.reason).slice(0, 8000) }).catch(() => {}); });
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  spark: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z"/><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7Z"/>',
  sliders: '<path d="M4 7h7m5 0h4M4 17h3m5 0h8"/><circle cx="13" cy="7" r="3"/><circle cx="9" cy="17" r="3"/>',
  pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8m-4-4v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8.3 8.3 0 0 1 20 11M4 13a8.3 8.3 0 0 0 13.9 4.9"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
  memory: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4m4-4v4m4-4v4m4-4v4M6 18v3m4-3v3m4-3v3m4-3v3"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  thermometer: '<path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z"/><path d="M12 9v9"/><circle cx="12" cy="18" r="1"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0Z"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1"/>',
  undo: '<path d="M3 4v6h6"/><path d="M3.5 10A9 9 0 1 1 5 19"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  moon: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
let state, telemetry, activePage = 'library', filter = 'all', busy = false, toastTimer, dialogGame, drag = null;
const events = [];
const titles = { components: ['GRAPHICS', 'Graphics Studio', 'Graphics Studio'], library: ['LIBRARY', 'Your games', 'Library'], optimize: ['SYSTEM', 'Optimization', 'Optimize'], tuning: ['HARDWARE', 'Hardware tuning', 'Hardware'], activity: ['HISTORY', 'Activity & backups', 'Activity'] };
function note(message, error = false) {
  const toast = $('#toast'); toast.textContent = message; toast.className = 'toast visible' + (error ? ' error' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), error ? 12000 : 6500);
  events.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), message });
  events.splice(30); renderEvents();
}
let downloadHideTimer;
function renderDownloadProgress(progress) {
  if (!progress || typeof progress.phase !== 'string') return;
  const tray=$('#download-tray'),bar=$('#download-progress');
  clearTimeout(downloadHideTimer);tray.hidden=false;
  tray.dataset.phase=progress.phase;
  if(progress.label)$('#download-title').textContent=progress.label;
  const bytes=Number(progress.received)||0,total=Number(progress.total)||0;
  if(progress.phase==='downloading'){
    if(total>0){const percent=Math.min(100,Math.floor(bytes/total*100));bar.value=percent;$('#download-percent').textContent=percent+'%';$('#download-detail').textContent=`${(bytes/1048576).toFixed(1)} of ${(total/1048576).toFixed(1)} MB downloaded`;}
    else{bar.removeAttribute('value');$('#download-percent').textContent='Downloading';$('#download-detail').textContent=`${(bytes/1048576).toFixed(1)} MB downloaded`;}
  } else if(progress.phase==='connecting') {bar.removeAttribute('value');$('#download-percent').textContent='Connecting';$('#download-detail').textContent='Opening the verified source';}
  else if(progress.phase==='verifying') {bar.removeAttribute('value');$('#download-percent').textContent='Verifying';$('#download-detail').textContent='Checking the downloaded package';}
  else if(progress.phase==='launching') {bar.removeAttribute('value');$('#download-percent').textContent='Launching';$('#download-detail').textContent='Waiting for the game process and Windows crash events';}
  else if(progress.phase==='observing') {bar.removeAttribute('value');$('#download-percent').textContent='Checking';$('#download-detail').textContent='Watching game startup for 25 seconds';}
  else if(progress.phase==='rollback') {bar.removeAttribute('value');$('#download-percent').textContent='Restoring';$('#download-detail').textContent='A crash was recorded. Restoring OPlay-managed files';}
  else if(progress.phase==='complete') {bar.value=100;$('#download-percent').textContent='Done';$('#download-detail').textContent='Operation completed. See the game launch result';downloadHideTimer=setTimeout(()=>tray.hidden=true,7000);}
  else if(progress.phase==='failed') {bar.removeAttribute('value');$('#download-percent').textContent='Stopped';$('#download-detail').textContent='Download or installation failed. See the message above.';downloadHideTimer=setTimeout(()=>tray.hidden=true,12000);}
}
window.aether.onComponentProgress(renderDownloadProgress);
async function action(fn) {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  $('.workspace').setAttribute('aria-busy', 'true');
  $('#work-indicator').hidden = false; $('#work-label').textContent = 'Working…';
  try { await fn(); }
  catch (e) { note(e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), true); }
  finally { $('#work-indicator').hidden = true; busy = false; document.body.classList.remove('busy'); $('.workspace').setAttribute('aria-busy', 'false'); }
}
function moveTo(tab, animate) {
  const pill = $('.rail-pill');
  if (!tab || !pill) return;
  if (!animate) {
    const prev = pill.style.transition; pill.style.transition = 'none';
    pill.style.transform = `translateY(${tab.offsetTop}px)`; pill.style.height = `${tab.offsetHeight}px`;
    void pill.offsetWidth; pill.style.transition = prev;
  } else {
    pill.style.transform = `translateY(${tab.offsetTop}px)`; pill.style.height = `${tab.offsetHeight}px`;
  }
}
function page(name) {
  if (!titles[name]) return;
  activePage = name; document.body.dataset.view = name;
  $$('.page').forEach(el => { el.hidden = el.id !== 'page-' + name; });
  $$('.rail-item[data-page]').forEach(el => { const selected = el.dataset.page === name; el.classList.toggle('selected', selected); if (selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  const [eyebrow, title, crumb] = titles[name]; $('#page-eyebrow').textContent = eyebrow; $('#page-title').textContent = title; $('#breadcrumb-page').textContent = crumb;
  moveTo($(`.rail-item[data-page="${name}"]`), true);
  window.scrollTo(0, 0);
}
const bar = $('.rail-nav');
const tabs = $$('.rail-item[data-page]');
bar.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const tab = e.target.closest('.rail-item[data-page]'); if (!tab) return;
  drag = { startY: e.clientY, page: tab.dataset.page, moved: false }; bar.setPointerCapture(e.pointerId); bar.classList.add('dragging');
});
bar.addEventListener('pointermove', e => {
  if (!drag) return;
  if (Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
  const tab = tabs.find(t => { const r = t.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
  if (tab) { drag.page = tab.dataset.page; moveTo(tab, true); }
});
function endDrag(e) {
  if (!drag) return;
  const target = drag.page; drag = null; bar.classList.remove('dragging');
  if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
  page(target);
}
bar.addEventListener('pointerup', endDrag);
bar.addEventListener('pointercancel', () => { drag = null; bar.classList.remove('dragging'); page(activePage); });
bar.addEventListener('keydown', e => {
  const index = tabs.findIndex(t => t.dataset.page === activePage);
  let next;
  if (e.key === 'ArrowDown') next = (index + 1) % tabs.length;
  if (e.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
  if (e.key === 'Home') next = 0;
  if (e.key === 'End') next = tabs.length - 1;
  if (next !== undefined) { e.preventDefault(); page(tabs[next].dataset.page); tabs[next].focus(); }
});
requestAnimationFrame(() => moveTo(tabs[0], false));
window.addEventListener('resize', () => moveTo($(`.rail-item[data-page="${activePage}"]`), false));
function renderGames() {
  if (!state) return;
  const search = $('#search').value.toLowerCase(), store = $('#store-filter').value;
  const games = state.games.filter(g => (filter !== 'optimized' || g.optimized) && (store === 'all' || g.store === store) && g.name.toLowerCase().includes(search));
  $('#games').innerHTML = games.length ? games.map(g => {
    const hue = [...g.name].reduce((a, c) => a + c.charCodeAt(0) * 3, 0) % 360;
    return `<article class="game-card"><div class="game-art" style="--hue:${hue}" data-detail="${escapeHtml(g.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(g.name)} details">${g.cover?.startsWith('data:image/') ? `<img src="${escapeHtml(g.cover)}" alt="" loading="lazy">` : `<span class="fallback-label">LOCAL LIBRARY</span><span class="fallback-title">${escapeHtml(g.name)}</span>`}${g.optimized ? '<span class="optimized-mark">✓ GPU preference</span>' : ''}<div class="cover-bottom"><span class="cover-store">${escapeHtml(g.store)}</span><span class="cover-play">${icon('play')}</span></div></div><div class="game-info"><div><div class="game-name">${escapeHtml(g.name)}</div><small>${escapeHtml(g.store)} · Installed library entry</small></div><button class="game-opt ${g.optimized ? 'done' : ''}" data-game-action="optimize" data-id="${escapeHtml(g.id)}" aria-label="${g.optimized ? 'Review' : 'Optimize'} ${escapeHtml(g.name)}" title="${g.optimized ? 'View applied preference' : 'Set Windows GPU preference'}">${icon(g.optimized ? 'check' : 'spark')}</button></div></article>`;
  }).join('') : '<div class="empty">' + (state.games.length ? 'No games match this view. Try another filter.' : 'Your library starts here.<br>Scan Steam, Epic, and GOG, or use “Add game” to choose any installed game executable.') + '</div>';
  $('#collection-count').textContent = state.games.length; $('#side-count').textContent = state.games.length;
  $('#optimized-count').textContent = state.games.filter(g => g.optimized).length;
  $('#library-note').textContent = `${games.length} of ${state.games.length} library entries · Local launcher manifests · Add other launchers and standalone games with “Add game”`;
}
function renderFeatured() {
  const g = [...state.games].sort((a,b) => (b.lastLaunched || '').localeCompare(a.lastLaunched || '') || Number(!!b.hero) - Number(!!a.hero))[0]; const hero = $('#featured-game');
  if (!g) { hero.innerHTML = '<div class="featured-copy"><span class="eyebrow">LIBRARY</span><h2>No games added</h2><p>Scan a game folder or import an executable.</p><button class="primary" data-action="scan-folder">Scan folder</button></div>'; return; }
  hero.innerHTML = `${(g.hero || g.cover)?.startsWith('data:image/') ? `<img class="featured-art" src="${escapeHtml(g.hero || g.cover)}" alt="">` : '<div class="featured-placeholder"></div>'}<div class="featured-shade"></div><div class="featured-copy"><span class="featured-kicker"><span class="live-dot"></span>IN YOUR LIBRARY <span>/</span> ${escapeHtml(g.store.toUpperCase())}</span><h2>${escapeHtml(g.name)}</h2><div class="featured-meta">${g.optimized ? 'Ready for your next session' : 'Ready for your next session'}<span>•</span>Local game library</div><div class="featured-actions"><button class="primary" data-game-action="launch" data-id="${escapeHtml(g.id)}">${icon('play')}Launch game</button><button class="secondary" data-detail="${escapeHtml(g.id)}">Game details ${icon('arrow')}</button></div></div><span class="featured-index">01 <span>/ ${String(state.games.length).padStart(2, '0')}</span></span>`;
}

function renderEvents() {
  $('#events').innerHTML = events.length ? events.map(e => `<div class="event-row"><time>${escapeHtml(e.time)}</time><span>${escapeHtml(e.message)}</span></div>`).join('') : '<p class="detail-note">Session actions will appear here.</p>';
}
function renderState(next) {
  state = next; document.documentElement.dataset.theme = state.theme || 'dark'; renderGames(); renderFeatured(); renderStudio();
  $('#device-name').textContent = state.inventory.model || 'Windows PC';
  $('#device-caption').textContent = `${Math.round(state.inventory.ram / 2 ** 30)} GB memory · ${state.inventory.laptop ? 'Notebook' : 'Desktop'}`;
  $$('.store-row').forEach(el => {
    const store = el.textContent.includes('Steam') ? 'Steam' : el.textContent.includes('Epic') ? 'Epic Games' : 'GOG';
    el.querySelector('.store-dot').classList.toggle('connected', state.games.some(g => g.store === store));
  });
  $('#guard-toggle').setAttribute('aria-checked', String(state.guard));
  renderGpuControls(state.gpuOffsets, state.gpuControlEnabled);
  $('#cpu-status').textContent = state.power ? `Current AC settings: maximum processor state ${state.power.max}%, energy preference ${state.power.epp}, boost ${state.power.boost === 0 ? 'disabled' : 'enabled (policy ' + state.power.boost + ')'}. Original changed values are kept in Activity & backups.` : 'Windows processor policy is unavailable.';
  $('#guard-status').textContent = state.guard ? 'Watching optimized executables while OPlay stays open.' : 'Off · Enable to watch your optimized games.';
  $('#hardware-summary').innerHTML = `<span class="feature-symbol">${icon('monitor')}</span><div><span class="eyebrow">${escapeHtml(state.inventory.manufacturer)} · ${state.inventory.laptop ? 'NOTEBOOK' : 'DESKTOP'}</span><h2>${escapeHtml(state.inventory.model)}</h2><p>${escapeHtml(state.inventory.cpu)} · ${Math.round(state.inventory.ram / 2 ** 30)} GB RAM</p></div><span class="hardware-badge">${state.inventory.admin ? 'Administrator session' : 'Standard user session'}</span>`;
  renderScan(state.vendorScan);
  $('#firmware-detail').textContent = 'Firmware: ' + (state.inventory.bios || 'unreported') + '. Configured RAM: ' + (state.inventory.memory?.map(m => `${(m.capacity / 2 ** 30).toFixed(0)} GB at ${m.configuredSpeed} MT/s`).join(' + ') || 'unreported') + '.';
  $('#backups').innerHTML = state.entries.length ? state.entries.map(e => `<div class="backup-row"><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.path)}</small><div class="backup-value">Before: ${escapeHtml(e.before.exists ? JSON.stringify(e.before.value) : 'not set')} → OPlay: ${escapeHtml(JSON.stringify(e.after.value))}</div><small>${escapeHtml(new Date(e.time).toLocaleString())} · ${escapeHtml(e.scope)}</small></div>`).join('') : '<h3>No settings to undo.</h3><p>When OPlay changes a Windows setting, its original value appears here. Settings that already match need no backup.</p>';
  $('#scan-warnings').innerHTML = (state.warnings || []).slice(0, 20).map(w => `<p class="warning">${escapeHtml(w)}</p>`).join('');
  $('#data-path').textContent = 'Library and settings journal: ' + state.dataPath + ' · Offline manifests are kept visible; rescan does not delete your library.';
  if(!$('#launch-history'))$('#page-activity .diagnostics').insertAdjacentHTML('afterend','<div class="panel glass launch-history" id="launch-history"></div>');
  const checks=(state.components?.launchTests||[]).slice(0,12);
  $('#launch-history').innerHTML='<h3>Game launch checks</h3><p class="detail-note">Startup checks and Windows crash events stay on this PC.</p>'+(checks.length?checks.map(item=>`<div class="launch-history-row"><div><strong>${escapeHtml(item.gameName)}</strong><small>${escapeHtml(new Date(item.finishedAt).toLocaleString())} · ${escapeHtml(item.outcome)}${item.crash?' · '+escapeHtml(item.crash.module)+' · 0x'+escapeHtml(item.crash.code):''}</small><p>${escapeHtml(item.guidance||'')}</p></div></div>`).join(''):'<p class="detail-note">No game launch checks recorded yet.</p>');
}
function renderScan(scan) {
  if (!scan) { $('#scan-status').textContent = 'NVIDIA calibration status unavailable.'; return; }
  $('[data-action="vendor-stop"]').disabled = !scan.running;
  $('[data-action="vendor-start"]').disabled = scan.running;
  $('#scan-status').textContent = (scan.running ? `Scanning${scan.percent == null ? '' : ' · ' + scan.percent + '%'}. ` : 'Idle. ') + (scan.reason ? `NVIDIA diagnostic: ${scan.reason} (status ${scan.completionStatus}). ` : '') + (scan.message || '') + (scan.cpuTemperature == null ? '' : ` CPU ${scan.cpuTemperature}°C (NVIDIA sensor).`) + (scan.requiresUser ? ' Check NVIDIA App for confirmation or status.' : '');
}
function renderCurve(curve, enabled, controlled, live) {
  const points = curve?.points || [];
  const available = curve?.available && points.length >= 60;
  $('#curve-apply').disabled = !available || !enabled || controlled;
  $('#curve-restore').disabled = !enabled;
  $('#curve-capability').textContent = available ? 'NVAPI curve available' : 'Unavailable';
  if (!available) { $('#curve-status').textContent = curve?.error || 'No readable GPU voltage/frequency curve.'; $('#curve-graph').replaceChildren(); return; }
  if (!$('#curve-voltage').value || !$('#curve-frequency').value) {
    const anchor = points.reduce((a, p) => Math.abs(p.voltageUV - 850000) < Math.abs(a.voltageUV - 850000) ? p : a);
    $('#curve-voltage').value = anchor.voltageUV / 1000;
    $('#curve-frequency').value = Math.ceil(anchor.frequencyKHz / 15000) * 15 + 15;
  }
  const coords = points.map(p => `${(35 + (p.voltageUV / 1000 - 400) / 900 * 530).toFixed(1)},${(215 - p.frequencyKHz / 2500000 * 185).toFixed(1)}`).join(' ');
  $('#curve-graph').innerHTML = `<svg viewBox="0 0 600 250" aria-hidden="true"><path d="M35 15V215H575" class="curve-axis"/><polyline points="${coords}" class="curve-line"/><text x="35" y="240">400 mV</text><text x="510" y="240">1300 mV</text><text x="40" y="25">2500 MHz</text><text x="40" y="210">0 MHz</text></svg>`;
  $('#curve-status').textContent = `${points.length} driver curve points. Live voltage ${curve.voltageUV ? (curve.voltageUV / 1000).toFixed(2) + ' mV' : 'unavailable'}. ${curve.controlled ? 'OPlay curve active; originals saved for rollback.' : controlled ? 'Restore the existing offset session before editing the curve.' : 'Default target is a small increase at 850 mV; stability is not assumed.'}`;
}
function renderGpuControls(offsets, enabled, live = false) {
  renderCurve(offsets?.curve, enabled, offsets?.controlled, live);
  const core = offsets?.offsets?.filter(v => v.type === 0) || [];
  const memory = offsets?.offsets?.filter(v => v.type === 2) || [];
  const supported = core.length > 0 && memory.length > 0;
  $('#gpu-enable').disabled = enabled || !supported;
  $('#gpu-enable').textContent = enabled ? 'GPU controls enabled' : 'Enable GPU controls';
  $('#gpu-apply').disabled = !enabled || !supported || offsets?.curve?.controlled;
  $('#gpu-restore').disabled = !enabled;
  $('#gpu-control-tag').textContent = enabled ? 'ADMIN HELPER CONNECTED' : supported ? 'NVIDIA NVML · P0/P2' : 'OFFSET API UNAVAILABLE';
  if (!supported) { $('#gpu-offset-live').textContent = 'The GPU driver does not expose both offset domains. No clock values are assumed.'; return; }
  const coreMin = Math.max(...core.map(v => v.min)), coreMax = Math.min(...core.map(v => v.max));
  const memMin = Math.max(...memory.map(v => v.min)), memMax = Math.min(...memory.map(v => v.max));
  if (!live) {
    for (const [id, values, min, max] of [['gpu-core', core, coreMin, coreMax], ['gpu-memory', memory, memMin, memMax]]) {
      const input = $('#' + id); input.min = min; input.max = max; input.value = values[0].value;
    }
  }
  const signed = n => (n >= 0 ? '+' : '') + n;
  $('#gpu-offset-live').textContent = `Driver read-back: graphics ${signed(core[0].value)} MHz (${coreMin} to ${coreMax}), VRAM ${signed(memory[0].value)} MHz (${memMin} to ${memMax}). ${offsets.controlled ? 'OPlay GPU session active; original settings saved.' : 'Current settings belong to the driver/OEM or another tool.'}`;
}
function graph(key) {
  const values = (telemetry?.history || []).map(p => p[key]).filter(v => v !== null && Number.isFinite(v));
  if (values.length < 2) return '';
  return `<svg class="sparkline" viewBox="0 0 60 28" aria-hidden="true"><polyline points="${values.map((v, i) => `${(i / (values.length - 1) * 60).toFixed(1)},${(25 - Math.max(0, Math.min(v, 100)) * .22).toFixed(1)}`).join(' ')}"/></svg>`;
}
function renderTelemetry(next) {
  telemetry = next; const g = next.gpu;
  renderGpuControls(next.gpuOffsets, next.gpuControlEnabled, true);
  renderScan(next.vendorScan); renderCompatibility();
  if (next.gpuControlError) $('#gpu-safety').textContent = next.gpuControlError;
  const cards = [
    ['cpu', 'CPU LOAD', next.cpu === null ? '—' : next.cpu + '%', '', 'All logical processors', 'cpu'],
    ['memory', 'MEMORY', (next.used / 2 ** 30).toFixed(1), '/ ' + (next.total / 2 ** 30).toFixed(0) + ' GB', next.memoryPercent + '% in use', 'memory'],
    ['monitor', 'GPU LOAD', g?.utilization == null ? '—' : g.utilization + '%', '', g?.name || 'GPU telemetry unavailable', 'gpu'],
    ['thermometer', 'GPU TEMPERATURE', g?.temperature == null ? '—' : Math.round(g.temperature) + '°', g?.temperature == null ? '' : 'C', g?.thermalSlowdown ? 'Thermal slowdown reported' : (g?.clock == null ? 'No sensor sample' : Math.round(g.clock) + ' MHz graphics clock'), 'temperature']
  ];
  $('#library-metrics').innerHTML = cards.map(([symbol, label, value, unit, subtitle, key]) => `<article class="metric glass"><div class="metric-label">${icon(symbol)}${label}</div><div class="metric-value">${value}<small>${unit}</small></div><div class="metric-sub" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</div>${graph(key)}</article>`).join('');
  $('#connection-label').textContent = g ? 'Windows + NVIDIA connected' : 'Windows connected';
  $('#footer-status').textContent = 'Live telemetry · every 5 seconds';
  $('#footer-detail').textContent = next.notice || next.errors?.[0] || (g?.thermalSlowdown ? 'GPU thermal slowdown detected' : g?.name || next.gpuError || 'No GPU sensor available');
  $('#memory-list').innerHTML = next.top?.length ? next.top.map(p => `<div class="process-row"><span>${escapeHtml(p.name)}</span><strong>${p.memory.toLocaleString()} MB</strong></div>`).join('') : '<p class="detail-note">Windows process data unavailable.</p>';
  $('#thermal-value').textContent = g?.temperature == null ? '—' : Math.round(g.temperature) + '°C';
  $('#thermal-title').textContent = g?.thermalSlowdown ? 'Your GPU reports thermal slowdown.' : g?.temperature >= 85 ? 'Your GPU is running warm.' : 'GPU temperature';
  $('#thermal-note').textContent = g ? `${g.name}. ${g.thermalSlowdown ? 'Inspect cooling before increasing clocks or power.' : 'This is a live temperature sample, not a stability test.'}${g.power !== null ? ' Board power: ' + g.power.toFixed(1) + ' W.' : ''}` : 'GPU temperature unavailable. CPU temperature needs an OEM sensor provider and is not measured here.';
}
function details(id) {
  const g = state.games.find(g => g.id === id); if (!g) return;
  dialogGame = id;
  $('#game-detail').innerHTML = `<h2>${escapeHtml(g.name)}</h2><p>${escapeHtml(g.store)} · ${g.optimized ? 'Windows High performance GPU preference selected' : 'Default Windows GPU preference'}</p><div class="game-path">${escapeHtml(g.executable || g.installDir)}</div><div id="game-install-status" class="game-install-status" aria-live="polite"></div><div class="dialog-section-title"><span>GRAPHICS PACKAGES</span><small>Installed beside this game's executable · original files backed up</small></div><div class="game-route-grid"><button class="game-route" data-install-route="mfg" data-id="${escapeHtml(id)}"><span class="route-index">01 / COMMUNITY</span><strong>Latest MFG</strong><small>Multi-frame generation modules from the latest DLSS Unlocked package</small><span class="route-link">Install package ${icon('arrow')}</span></button><button class="game-route" data-install-route="neural" data-id="${escapeHtml(id)}"><span class="route-index">02 / COMMUNITY</span><strong>DLSS neural rendering</strong><small>Neural-rendering files in the same community package</small><span class="route-link">Install package ${icon('arrow')}</span></button><button class="game-route" data-install-route="fsrfg" data-id="${escapeHtml(id)}"><span class="route-index">03 / OPTISCALER</span><strong>FSR frame generation</strong><small>Install the FSR 3 frame-generation route</small><span class="route-link">Install route ${icon('arrow')}</span></button><button class="game-route" data-install-route="fsr4" data-id="${escapeHtml(id)}"><span class="route-index">04 / OPTISCALER</span><strong>FSR 4 route</strong><small>FSR upscaling route with FSR frame generation; actual DLL version varies by package</small><span class="route-link">Install route ${icon('arrow')}</span></button></div><p class="dialog-caveat">File installation does not guarantee in-game activation. Close the game before installing. OPlay will launch it after installation to check startup. Current packages and restore points are in Graphics Studio.</p><div class="dialog-actions"><button class="primary" data-game-action="launch" data-id="${escapeHtml(id)}">${icon('play')}Launch game</button>${g.optimized ? `<button class="secondary" data-game-action="undo" data-id="${escapeHtml(id)}">${icon('undo')}Undo preference</button>` : `<button class="secondary" data-game-action="optimize" data-id="${escapeHtml(id)}">${icon('spark')}Optimize game</button>`}<button class="secondary" data-action="open-game-studio" data-id="${escapeHtml(id)}">Graphics Studio ${icon('arrow')}</button></div>`;
  $('#game-install-status').insertAdjacentHTML('afterend','<div id="game-launch-test" class="launch-test" aria-live="polite"></div>');
  $('#game-detail .dialog-actions').insertAdjacentHTML('beforeend',`<button class="secondary" data-game-action="test" data-id="${escapeHtml(id)}">Test launch</button>`);
  if (!$('#game-dialog').open) $('#game-dialog').showModal();
  renderRecordedInstallation(id);
  renderLaunchTest(id);
  if((state.components?.transactions||[]).some(t=>t.gameId===id))refreshInstallStatus(id);
}
let statusSequence=0;
function launchTestMessage(gameId){
  const result=(state.components?.launchTests||[]).find(item=>item.gameId===gameId);
  if(!result)return 'No automatic launch check recorded yet. A graphics install now starts the game and watches startup.';
  const time=new Date(result.finishedAt).toLocaleString();
  const title=result.outcome==='launched'?'Started for 25 seconds':result.outcome==='crashed'?'Windows crash recorded':result.outcome==='not-started'?'No process appeared':'Game ended during startup';
  const crash=result.crash?`<small>Windows event: ${escapeHtml(new Date(result.crash.at).toLocaleString())} · ${escapeHtml(result.crash.app)} · ${escapeHtml(result.crash.module)} · 0x${escapeHtml(result.crash.code)}</small>`:'';
  const rollback=result.rollback==='restored'?`<small>OPlay package restored. Second check: ${escapeHtml(result.baseline?.outcome||'unavailable')}.</small>`:result.rollback==='blocked'?`<small>Automatic restore blocked: ${escapeHtml(result.rollbackReason)}</small>`:'';
  return `<strong>${escapeHtml(title)}</strong><small>Checked ${escapeHtml(time)}</small>${crash}${rollback}<p>${escapeHtml(result.guidance)}</p>`;
}
function renderLaunchTest(gameId){
  if(dialogGame===gameId&&$('#game-dialog').open)$('#game-launch-test').innerHTML=launchTestMessage(gameId);
  if($('#component-game').value===gameId&&$('#component-launch-test'))$('#component-launch-test').innerHTML=launchTestMessage(gameId);
}
function launchNote(gameId){const result=(state.components?.launchTests||[]).find(item=>item.gameId===gameId);return result?.outcome==='crashed'?(result.repaired?'Crash detected; OPlay restored its files and the game passed a second startup check.':'Crash detected. See launch diagnosis in game details.'):'Launch check: '+(result?.outcome==='launched'?'game process stayed open for 25 seconds.':'startup was not confirmed. See game details.');}
function statusLabel(value){return value==='installed'?'Installed · files verified':value==='missing'?'Missing files':value==='modified'?'Files changed':'Restore pending';}
function installationMarkup(installations){
  if(!installations.length)return '<span class="install-empty">No OPlay graphics package installed for this game.</span>';
  return installations.map(item=>`<div class="install-row"><span class="install-state ${escapeHtml(item.state.replace(/\s/g,'-'))}">${escapeHtml(statusLabel(item.state))}</span><strong>${escapeHtml(item.label)}</strong><small>${item.checked} / ${item.files} files checked</small></div>`).join('');
}
function renderRecordedInstallation(gameId){
  const recorded=(state.components?.transactions||[]).filter(t=>t.gameId===gameId);
  const placeholder=recorded.length?'<span class="install-checking">Checking OPlay-managed game files…</span>':installationMarkup([]);
  if(dialogGame===gameId&&$('#game-dialog').open)$('#game-install-status').innerHTML=placeholder;
  if($('#component-game').value===gameId)$('#component-installed').innerHTML=placeholder;
  if(dialogGame===gameId&&$('#game-dialog').open)for(const route of $$('#game-dialog .game-route')){
    route.disabled=recorded.length>0;
    const badge=document.createElement('span');badge.className='route-state';badge.textContent=recorded.length?'Checking':'Not installed';route.append(badge);
  }
}
async function refreshInstallStatus(gameId){
  const sequence=++statusSequence;
  try{
    const result=await window.aether.components('status',{gameId});
    if(sequence!==statusSequence)return;
    const markup=installationMarkup(result.installations);
    if($('#component-game').value===gameId)$('#component-installed').innerHTML=markup;
    for(const item of result.installations){const row=$(`.restore-item[data-install-id="${item.id}"] .restore-item-state`);if(row)row.textContent=statusLabel(item.state);}
    if(dialogGame===gameId&&$('#game-dialog').open){
      $('#game-install-status').innerHTML=markup;
      for(const route of $$('#game-dialog .game-route')){
        const kind=route.dataset.installRoute;
        const item=result.installations.find(i=>kind==='mfg'||kind==='neural'?i.label.startsWith('DLSS Unlocked'):i.label.startsWith('OptiScaler'));
        const badge=route.querySelector('.route-state')||document.createElement('span');
        badge.className='route-state '+(item?.state||'none');
        badge.textContent=item?item.state==='installed'?'Files installed':statusLabel(item.state):'Not installed';
        if(!badge.isConnected)route.append(badge);
      }
    }
  }catch(error){if(sequence===statusSequence){const message='Could not verify installed files';if($('#component-game').value===gameId)$('#component-installed').textContent=message;if(dialogGame===gameId&&$('#game-dialog').open)$('#game-install-status').textContent=message;}}
}
async function undo(scope) {
  const r = await window.aether.undo(scope); renderState(r.state);
  note(`${r.result.restored} settings restored.${r.result.skipped.length ? ' Preserved external changes or failures: ' + r.result.skipped.join('; ') : ''}`, !!r.result.skipped.length);
}
document.addEventListener('click', e => {
  const collection = e.target.closest('[data-collection]');
  if (collection) { filter = collection.dataset.collection; $$('[data-collection]').forEach(el => el.classList.toggle('selected', el === collection)); page('library'); renderGames(); return; }
  const windowButton = e.target.closest('[data-window]'); if (windowButton) { window.aether.window(windowButton.dataset.window); return; }
  const pageButton = e.target.closest('[data-page]'); if (pageButton) { e.preventDefault(); page(pageButton.dataset.page); return; }
  const studio = e.target.closest('[data-studio-view]'); if (studio) { studioView(studio.dataset.studioView); return; }
  const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; $$('.filter').forEach(el => el.classList.toggle('active', el === f)); renderGames(); return; }
  const detail = e.target.closest('[data-detail]'); if (detail && state) { details(detail.dataset.detail); return; }
  const route = e.target.closest('[data-install-route]');
  if (route) { $('#game-dialog').close(); action(async () => {
    const gameId = route.dataset.id;
    if (!state.games.some(g => g.id === gameId)) throw Error('Choose a library game first.');
    const kind = route.dataset.installRoute;
    if (kind === 'mfg' || kind === 'neural') {
      $('#work-label').textContent = 'Downloading and installing MFG and neural-rendering files…';
      state.components = await window.aether.components('unlocked', {gameId});
      note(launchNote(gameId));
    } else if (kind === 'fsrfg' || kind === 'fsr4') {
      $('#work-label').textContent = 'Installing the FSR frame-generation route…';
      state.components = await window.aether.components('opti', {gameId, output:'fsrfg', upscaler:kind === 'fsr4' ? 'fsr31' : 'auto'});
      note(launchNote(gameId));
    } else throw Error('Unknown graphics route');
    renderState(await window.aether.snapshot());$('#component-game').value = gameId;renderStudio();details(gameId);
  }); return; }
  const gameButton = e.target.closest('[data-game-action]');
  if (gameButton) {
    action(async () => {
      const id = gameButton.dataset.id;
      if (gameButton.dataset.gameAction === 'launch') note(await window.aether.launch(id));
      else if(gameButton.dataset.gameAction==='test'){ $('#game-dialog').close();state.components=await window.aether.components('test-launch',{gameId:id});renderState(await window.aether.snapshot());details(id);note(launchNote(id)); }
      else if (gameButton.dataset.gameAction === 'undo') { await undo(id); details(id); }
      else {
        if (state.games.find(g => g.id === id)?.optimized) { details(id); return; }
        renderState(await window.aether.optimizeGame(id));
        if (state.games.find(g => g.id === id)?.optimized) note('High performance GPU preference is set. Restart the game to apply.');
        if ($('#game-dialog').open) details(id);
      }
    }); return;
  }
  const button = e.target.closest('[data-action]'); if (!button) return;
  if (button.dataset.action === 'close-dialog') { $('#game-dialog').close(); return; }
  if (button.dataset.action === 'open-game-studio') { $('#component-game').value = button.dataset.id; $('#game-dialog').close(); page('components'); renderStudio(); return; }
  action(async () => {
    switch (button.dataset.action) {
      case 'theme': { const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme; state.theme=theme; await window.aether.theme(theme); break; }
      case 'component-refresh': $('#work-label').textContent = 'Checking runtime and community releases…'; state.components = await window.aether.components('refresh'); renderStudio(); note(state.components.refreshError ? 'Release check was partial: '+state.components.refreshError : 'Runtime and community releases checked.'); break;
      case 'component-download': $('#work-label').textContent = 'Downloading and verifying runtime…'; state.components = await window.aether.components('download', {id:button.dataset.id}); renderStudio(); note('Runtime downloaded and publisher signature verified.'); break;
      case 'component-community-download': $('#work-label').textContent = 'Downloading and verifying the MFG community package…'; state.components = await window.aether.components('download-unlocked'); renderStudio(); note('MFG, neural-rendering and bundled FSR files downloaded and verified.'); break;
      case 'component-opti-download': $('#work-label').textContent = 'Downloading and verifying OptiScaler…'; state.components = await window.aether.components('download-opti'); renderStudio(); note('OptiScaler frame-generation package downloaded and verified.'); break;
      case 'component-community-install': $('#work-label').textContent = 'Installing and testing MFG…'; state.components = await window.aether.components('unlocked', {gameId:$('#component-game').value}); renderStudio(); note(launchNote($('#component-game').value)); break;
      case 'component-opti-route': $('#work-label').textContent = 'Installing and testing FSR route…'; state.components = await window.aether.components('opti', {gameId:$('#component-game').value,output:'fsrfg',upscaler:'fsr31'}); renderStudio(); note(launchNote($('#component-game').value)); break;
      case 'component-scan': await inspectSelectedGame(); break;
      case 'component-swap': { const row=button.closest('.component-row'); $('#work-label').textContent = 'Backing up, swapping and testing runtime…'; state.components = await window.aether.components('swap', {gameId:$('#component-game').value,relative:button.dataset.relative,cacheId:row.querySelector('select').value}); renderStudio(); await inspectSelectedGame(); note(launchNote($('#component-game').value)); break; }
      case 'component-opti': $('#work-label').textContent = 'Installing and testing graphics profile…'; state.components = await window.aether.components('opti', {gameId:$('#component-game').value,output:$('#mod-output').value,upscaler:$('#mod-upscaler').value}); renderStudio(); await inspectSelectedGame(); note(launchNote($('#component-game').value)); break;
      case 'component-unlocked': $('#work-label').textContent = 'Installing and testing the community package…'; state.components = await window.aether.components('unlocked', {gameId:$('#component-game').value}); renderStudio(); await inspectSelectedGame(); note(launchNote($('#component-game').value)); break;
      case 'component-force-runtime': $('#work-label').textContent = 'Installing and testing runtime file…'; state.components = await window.aether.components('force-runtime', {gameId:$('#component-game').value,cacheId:$('#force-runtime-select').value}); renderStudio(); await inspectSelectedGame(); note(launchNote($('#component-game').value)); break;
      case 'component-test-launch': state.components=await window.aether.components('test-launch',{gameId:$('#component-game').value});renderStudio();note(launchNote($('#component-game').value));break;
      case 'component-unlocked-docs': await window.aether.unlockedDocs(); break;
      case 'component-fsr-docs': await window.aether.fsrDocs(); break;
      case 'component-restore': $('#work-label').textContent = 'Restoring original game files…'; state.components = await window.aether.components('restore', {id:button.dataset.id}); renderStudio(); note('Original game files restored and verified.'); break;
      case 'component-docs': await window.aether.componentDocs(); break;
      case 'vendor-open': { const r = await window.aether.vendorScan('Navigate'); renderState(r.state); note('NVIDIA Performance panel opened.'); break; }
      case 'vendor-start': { const r = await window.aether.vendorScan('Start'); renderState(r.state); note(r.scan.running ? 'NVIDIA automatic calibration is running. Leave the PC idle and on AC power.' : 'Scan request sent. Check NVIDIA App for its confirmation or status.'); break; }
      case 'vendor-stop': { const r = await window.aether.vendorScan('Stop'); renderState(r.state); note('NVIDIA scan stop request processed; status is shown in Hardware tuning.'); break; }
      case 'gpu-enable': renderState(await window.aether.gpuEnable()); note('GPU helper connected. Current offsets read from the driver; no clock changes applied.'); break;
      case 'gpu-apply': {
        if (!$('#gpu-core').value || !$('#gpu-memory').value) throw Error('Enter both clock offsets.');
        const values = { core: Number($('#gpu-core').value), memory: Number($('#gpu-memory').value) };
        renderState(await window.aether.gpuOffsets(values)); note('GPU and VRAM offsets written and verified. Original values will be restored when OPlay exits. This is not a stability test.'); break;
      }
      case 'curve-apply': {
        const values = { millivolts: Number($('#curve-voltage').value), megahertz: Number($('#curve-frequency').value) };
        if (!$('#curve-voltage').value || !$('#curve-frequency').value) throw Error('Enter both curve targets.');
        renderState(await window.aether.gpuCurve(values)); note('GPU V/F curve written and verified. Originals are saved; validate stability and operating voltage in your games.'); break;
      }
      case 'gpu-restore': renderState(await window.aether.gpuRestore()); note('Original GPU curve and session offsets restored and verified.'); break;
      case 'cpu-profile': renderState(await window.aether.cpuProfile($('#cpu-profile').value)); note('AC processor settings read-back verified. Changed settings have original-value backups.'); break;
      case 'undo-cpu': await undo('cpu'); break;
      case 'manage-apps': {
        const apps = await window.aether.desktopApps();
        $('#game-detail').innerHTML = '<h2>Background apps</h2><p>Save your work before closing an app. A close request allows the app to show its save prompt. OPlay does not force termination.</p>' + (apps.length ? apps.map(p => `<div class="app-management-row"><div><strong>${escapeHtml(p.name)} · ${p.memory} MB</strong><small>${escapeHtml(p.title)}</small></div><button class="secondary" data-action="close-app" data-pid="${p.pid}">Request close</button></div>`).join('') : '<p class="detail-note">No eligible desktop apps found.</p>');
        $('#game-dialog').showModal(); break;
      }
      case 'close-app': { const r = await window.aether.closeApp(Number(button.dataset.pid)); if (r) note(r.requested ? `Close request sent to ${r.name}. Memory becomes available after it exits.` : `${r.name} did not accept a close request. Close it manually when ready.`); break; }
      case 'open-logs': await window.aether.openLogs(); break;
      case 'scan': note('Scanning local launcher manifests…'); renderState(await window.aether.scan()); note(`Library refreshed. ${state.games.length} entries found.`); break;
      case 'add': renderState(await window.aether.addGame()); break;
      case 'scan-folder': {
        const result = await window.aether.scanFolder(); if (!result) break;
        $('#game-detail').innerHTML = '<h2>Review discovered games.</h2><p>These are executable suggestions. Select the games to import. For a different executable, use Add game.</p>' + (result.candidates.length ? result.candidates.map(g => `<label class="import-row"><input type="checkbox" name="import-game" value="${escapeHtml(g.id)}"><span><strong>${escapeHtml(g.name)}</strong><small>${escapeHtml(g.executable)}</small></span></label>`).join('') + '<div class="dialog-actions"><button class="primary" data-action="import-games">Import selected</button></div>' : '<p class="detail-note">No game executables found. Try a smaller folder or add a game directly.</p>') + result.warnings.map(w => `<p class="warning">${escapeHtml(w)}</p>`).join('');
        $('#game-dialog').showModal(); break;
      }
      case 'import-games': {
        const ids = $$('input[name="import-game"]:checked').map(el => el.value);
        if (!ids.length) { note('Select at least one game to import.'); break; }
        renderState(await window.aether.importGames(ids)); $('#game-dialog').close(); note('Selected games added to your library.'); break;
      }
      case 'global': { const r = await window.aether.global(); renderState(r.state); note(r.message); break; }
      case 'guard': renderState(await window.aether.guard(!state.guard)); note(state.guard ? 'Live game guard enabled. Watching selected executables every 5 seconds.' : 'Live game guard disabled. OPlay priority changes restored.'); break;
      case 'undo-global': await undo('global'); break;
      case 'undo-all': await undo(null); break;
    }
  });
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); page('library'); $('#search').focus(); }
  const detail = e.target.closest('[data-detail]'); if (detail && ['Enter', ' '].includes(e.key)) { e.preventDefault(); details(detail.dataset.detail); }
});
$('#search').addEventListener('input', renderGames); $('#store-filter').addEventListener('change', renderGames);
$('#game-dialog').addEventListener('click', e => { if (e.target === $('#game-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
window.aether.onTelemetry(renderTelemetry);
window.aether.onComponents(next => { if(state){state.components=next;renderStudio();} });
window.aether.snapshot().then(s => { renderState(s); note('Library synchronized.'); }).catch(e => note('Could not read the library: ' + e.message, true));

let inspectedGame = null;
function studioView(view) {
  for (const name of ['games','downloads','compatibility']) $('#studio-'+name).hidden = view !== name;
  $$('[data-studio-view]').forEach(b => b.classList.toggle('selected', b.dataset.studioView === view));
}
function renderGamePicker() {
  const selected=state.games.find(g=>g.id===$('#component-game').value);
  $('#game-picker-value').textContent=selected?`${selected.name} · ${selected.store}`:'Choose a game';
  $('#game-picker-trigger').disabled=!state.games.length;
  $('#game-picker-menu').innerHTML=state.games.map(g=>`<button type="button" class="game-picker-option" role="option" aria-selected="${g.id===selected?.id}" data-picker-game="${escapeHtml(g.id)}"><span class="picker-symbol">${icon('layers')}</span><span class="picker-option-copy"><strong>${escapeHtml(g.name)}</strong><small>${escapeHtml(g.store)}</small></span>${g.id===selected?.id?icon('check'):''}</button>`).join('');
}
function closeGamePicker(){ $('#game-picker-menu').hidden=true;$('#game-picker-trigger').setAttribute('aria-expanded','false');$('#game-picker').classList.remove('open'); }
$('#game-picker-trigger').addEventListener('click',()=>{const opening=$('#game-picker-menu').hidden;$('#game-picker-menu').hidden=!opening;$('#game-picker-trigger').setAttribute('aria-expanded',String(opening));$('#game-picker').classList.toggle('open',opening);});
$('#game-picker-menu').addEventListener('click',e=>{const option=e.target.closest('[data-picker-game]');if(!option)return;$('#component-game').value=option.dataset.pickerGame;closeGamePicker();$('#component-game').dispatchEvent(new Event('change'));$('#game-picker-trigger').focus();});
$('#game-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){closeGamePicker();$('#game-picker-trigger').focus();return;}if(!['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(e.key))return;e.preventDefault();const options=[...$('#game-picker-menu').querySelectorAll('[data-picker-game]')];if(!options.length)return;if($('#game-picker-menu').hidden){$('#game-picker-trigger').click();return;}const active=document.activeElement.closest('[data-picker-game]');const index=options.indexOf(active);const next=e.key==='Home'?0:e.key==='End'?options.length-1:e.key==='ArrowUp'?(index<=0?options.length-1:index-1):e.key==='ArrowDown'?(index+1)%options.length:index;if(e.key==='Enter'||e.key===' '){(active||options.find(x=>x.getAttribute('aria-selected')==='true')||options[0]).click();return;}options[next<0?0:next].focus();});
document.addEventListener('pointerdown',e=>{if(!$('#game-picker').contains(e.target))closeGamePicker();});
function renderStudio() {
  if (!state) return;
  const chosen = $('#component-game').value;
  $('#component-game').innerHTML = state.games.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} · ${escapeHtml(g.store)}</option>`).join('');
  if (state.games.some(g => g.id === chosen)) $('#component-game').value = chosen;
  renderGamePicker();
  const c = state.components || {catalog:[],cache:[],transactions:[]};
  const transactions = c.transactions || [];
  const active=transactions.find(t=>t.gameId===$('#component-game').value);
  renderRecordedInstallation($('#component-game').value);
  if(!$('#component-launch-test'))$('#component-installed').insertAdjacentHTML('afterend','<div class="launch-check-panel"><button class="secondary" data-action="component-test-launch">Test game launch</button><div id="component-launch-test" class="launch-test" aria-live="polite"></div></div>');
  $('[data-action="component-test-launch"]').disabled=!$('#component-game').value;
  renderLaunchTest($('#component-game').value);
  if(transactions.some(t=>t.gameId===$('#component-game').value))refreshInstallStatus($('#component-game').value);
  $('#component-backups').innerHTML = transactions.length ? transactions.map(t => `<div class="restore-item" data-install-id="${escapeHtml(t.id)}"><div><strong>${escapeHtml(t.gameName)}</strong><small>${escapeHtml(t.label)} · ${t.files.length} files · <span class="restore-item-state">${t.status==='installed'?'Checking files':escapeHtml(t.status)}</span></small></div><button class="secondary" data-action="component-restore" data-id="${escapeHtml(t.id)}">Restore original</button></div>`).join('') : '<p class="detail-note">Your original files will appear here when you install a runtime or graphics profile.</p>';
  const selectedRuntime=$('#force-runtime-select').value;
  $('#force-runtime-select').innerHTML=c.cache.length?c.cache.map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.label)} · ${escapeHtml(r.version)}</option>`).join(''):'<option value="">Download a runtime first</option>';
  if(c.cache.some(r=>r.id===selectedRuntime))$('#force-runtime-select').value=selectedRuntime;
  $('#force-runtime-install').disabled=!c.cache.length||!$('#component-game').value||!!active;
  const unlocked=c.community;$('#unlocked-version').textContent=unlocked?.tag||'Check releases';$('#unlocked-install').disabled=!unlocked||!$('#component-game').value||!!active;
  $('#unlocked-install').textContent=active?(active.label.startsWith('DLSS Unlocked')?'Files installed · restore to change':'Restore current profile first'):'Install package →';
  const optiButton=$('.mod-panel [data-action="component-opti"]');optiButton.disabled=!$('#component-game').value||!!active;
  $('#unlocked-status').textContent=active?.label.startsWith('DLSS Unlocked')?'OPlay package recorded for this game. File verification appears above; use Restore original to change it.':unlocked?`${(unlocked.size/1048576).toFixed(0)} MB download · Checked ${c.checkedAt?new Date(c.checkedAt).toLocaleString():'previously'}${c.refreshError?' · '+c.refreshError:''}`:'Refresh the catalog to find the latest package. Download is roughly 600 MB; install size is larger.';
  renderCatalog(); renderComponentResults(); renderCompatibility();
}
function renderCatalog() {
  if (!state) return;
  const c=state.components || {catalog:[],cache:[]}, family=$('#component-family').value;
  const records=c.catalog.filter(r=>r.kind===family);
  $('#catalog-status').textContent = c.catalog.length ? `${c.catalog.length} upstream DLL releases · ${c.cache.length} downloaded · ${c.checkedAt?'Checked '+new Date(c.checkedAt).toLocaleDateString():'Update pending'}` : 'Checking daily for upstream releases';
  $('#community-downloads').innerHTML = `<div class="downloads-heading"><span class="eyebrow">COMMUNITY PACKAGES</span><span>Download now, install into a selected game when ready</span></div><div class="package-grid"><article class="package-card glass"><span class="tag">MFG · NEURAL · FSR DLLS</span><h3>DLSS Unlocked <small>${escapeHtml(c.community?.tag||'Release check pending')}</small></h3><p>Community MFG and neural-rendering modules, OptiScaler and bundled FSR files. Bundled versions may trail AMD's SDK.</p><div class="package-actions"><button class="secondary" data-action="component-community-download" ${!c.community||c.communityCached?'disabled':''}>${c.communityCached?'Downloaded':'Download package'}</button><button class="primary" data-action="component-community-install" ${!c.community||!$('#component-game').value?'disabled':''}>Install to game</button></div></article><article class="package-card glass"><span class="tag">FSR FRAME GENERATION</span><h3>OptiScaler <small>${escapeHtml(c.optiscaler?.version||'')}</small></h3><p>FSR 3 frame-generation output and an FSR 3 / 4 upscaling route. The game and package determine the active DLL version.</p><div class="package-actions"><button class="secondary" data-action="component-opti-download" ${c.optiCached?'disabled':''}>${c.optiCached?'Downloaded':'Download package'}</button><button class="primary" data-action="component-opti-route" ${!$('#component-game').value?'disabled':''}>Install FSR route</button></div></article></div>`;
  $('#component-catalog').innerHTML = records.length ? records.map(r => { const cached=c.cache.some(x=>x.id===r.id); return `<article class="runtime-row"><div><h3>${escapeHtml(r.label)} <span>${escapeHtml(r.version)}</span></h3><p>${cached ? 'Downloaded · publisher verified' : 'DLSS Swapper upstream catalog · signature checked on download'}</p></div><span class="runtime-size">${(r.size/1048576).toFixed(1)} MB</span><button class="secondary" data-action="component-download" data-id="${escapeHtml(r.id)}" ${cached?'disabled':''}>${icon(cached?'check':'download')}${cached?'Downloaded':'Download'}</button></article>`; }).join('') : '<div class="empty">Refresh the catalog to browse available versions.</div>';
  $('#fsr-feed').innerHTML=c.fsr?`<article class="panel glass"><span class="tag">OFFICIAL AMD SDK RELEASE</span><h3>FSR ${escapeHtml(c.fsr.upscaler||'latest')} · SDK ${escapeHtml(c.fsr.tag)}</h3><p>Frame generation ${escapeHtml(c.fsr.frameGeneration||'version unlisted')} · ${c.fsr.binaryAssets?'DLL assets listed':'No standalone DLL asset in this release'}. OPlay checks this source daily; signed game-runtime downloads appear above when the DLL catalog publishes them.</p><button class="text-button" data-action="component-fsr-docs">View official SDK release ${icon('arrow')}</button></article>`:'';
}
async function inspectSelectedGame() {
  if (!$('#component-game').value) throw Error('Add a game to your library first.');
  $('#work-label').textContent = 'Inspecting game components…';
  inspectedGame = {gameId:$('#component-game').value, ...await window.aether.components('inspect',{gameId:$('#component-game').value})};
  renderComponentResults();
}
function renderComponentResults() {
  if (!inspectedGame || inspectedGame.gameId !== $('#component-game').value) { $('#component-results').innerHTML = '<div class="empty compact">Inspect this game to see its installed graphics components.</div>'; return; }
  const c=state.components || {cache:[]};
  $('#component-results').innerHTML = (inspectedGame.files.length ? inspectedGame.files.map(f=> { const versions=c.cache.filter(r=>r.kind===f.kind);return `<div class="component-row"><div><strong>${escapeHtml(f.label)}</strong><small>Installed ${escapeHtml(f.version || 'version unreported')}</small><small>${escapeHtml(f.relative)}</small></div><select aria-label="Version for ${escapeHtml(f.label)}" ${versions.length?'':'disabled'}>${versions.length ? versions.map(v=>`<option value="${escapeHtml(v.id)}">${escapeHtml(v.version)}</option>`).join(''):'<option>Download a version first</option>'}</select><button class="secondary" data-action="component-swap" data-relative="${escapeHtml(f.relative)}" ${versions.length?'':'disabled'}>Swap version</button></div>`; }).join('') : '<div class="empty compact">No existing DLSS, FSR or XeSS runtime was found. You can still install the experimental community package above.</div>') + inspectedGame.warnings.map(w=>`<p class="detail-note">${escapeHtml(w)}</p>`).join('');
}
function renderCompatibility() {
  const cards=[
    ['DLSS / FSR / XeSS DLLs','Version library',true,'Download current signed runtime files and swap or directly add a selected DLL.'],
    ['OptiScaler','Install profile',true,'Install a DX12 proxy and select DLSS, FSR or XeSS output.'],
    ['Multi-frame generation','Community package','limited','Install the current DLSS Unlocked MFG modules beside a game executable. Confirm the loaded path in-game.'],
    ['Neural rendering','Community package','limited','Install the upstream neural-rendering forwarder and model files. Game execution determines whether they activate.'],
    ['FSR 4.1.2','Track upstream','limited','AMD SDK 2.4 publishes FSR 4.1.2; available binaries and actual operation depend on the selected package and game.'],
    ['Original files','Restore points',true,'Every changed file is backed up and verified. Restore preserves later changes made by other software.']
  ];
  $('#compatibility-cards').innerHTML=cards.map(([name,status,available,description])=>`<article class="compatibility-card glass"><span class="status-tag ${available===true?'available':available==='limited'?'limited':''}">${escapeHtml(status)}</span><h3>${escapeHtml(name)}</h3><p>${escapeHtml(description)}</p></article>`).join('');
}
$('#component-family').addEventListener('change',renderCatalog);
$('#component-game').addEventListener('change',()=>{ renderComponentResults(); renderStudio(); });


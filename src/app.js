'use strict';
(() => {
  const T = window.HyroxTimer;
  const repository = window.HyroxStorage.createRepository();
  const $ = id => document.getElementById(id);
  const ui = {
    start: $('start-panel'), timer: $('timer-panel'), summary: $('summary-panel'), select: $('workout-select'),
    title: $('session-title'), subtitle: $('session-subtitle'), badge: $('phase-badge'), clock: $('clock'), clockLabel: $('clock-label'),
    clockDetail: $('clock-detail'), segment: $('current-segment'), primary: $('primary-action'), rest: $('rest-action'),
    message: $('message'), progress: $('progress-fill'), progressCopy: $('progress-copy'), save: $('save-state'), wake: $('wake-state'),
    summaryTitle: $('summary-title'), summaryBody: $('summary-body'), splitList: $('split-list'), history: $('history'),
    planNote: $('plan-note'), resumeNote: $('resume-note'),
  };
  let config, session = null, wakeLock = null, ticker = null, lastPersistedAutoPhase = null;
  const fmt = ms => {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };
  const phaseName = phase => ({
    [T.PHASE.IDLE]:'READY', [T.PHASE.READY]:'READY', [T.PHASE.SEGMENT]:'IN SEGMENT',
    [T.PHASE.PLANNED_REST]:'PLANNED REST', [T.PHASE.UNPLANNED_REST]:'BREAK', [T.PHASE.FINISH]:'FINISH',
    [T.PHASE.FINISHED]:'COMPLETE', [T.PHASE.DISCARDED]:'DISCARDED'
  })[phase] || 'READY';
  function planLabel(plan) { return `Day ${plan.day} · ${plan.title}`; }
  function expandedSegments(plan) {
    const rounds = Number.isInteger(plan.rounds) && plan.rounds > 1 ? plan.rounds : 1;
    return Array.from({length: rounds}, (_, round) => plan.segments.map((segment, index) => ({
      ...segment,
      id: rounds > 1 ? `${segment.id || `segment-${index + 1}`}-r${round + 1}` : segment.id,
      label: rounds > 1 ? `${segment.label} · Round ${round + 1}` : segment.label,
    }))).flat();
  }
  function populatePlans() {
    for (const plan of config.baselineWeek) {
      const option = document.createElement('option'); option.value = plan.id; option.textContent = planLabel(plan); ui.select.append(option);
    }
    ui.planNote.textContent = `${config.review.notice} Training targets remain provisional; incomplete targets are intentionally blank.`;
  }
  async function save(next, checkpoint = true) {
    session = next;
    await repository.save(session, { checkpoint });
    ui.save.textContent = `Saved locally · ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}`;
    render();
  }
  function activePhase(phase) { return ![T.PHASE.FINISHED, T.PHASE.DISCARDED].includes(phase); }
  function show(view) {
    ui.start.classList.toggle('hidden', view !== 'start');
    ui.timer.classList.toggle('hidden', view !== 'timer');
    ui.summary.classList.toggle('hidden', view !== 'summary');
  }
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) { ui.wake.textContent = 'Screen lock: unsupported'; return; }
    try { wakeLock = await navigator.wakeLock.request('screen'); ui.wake.textContent = 'Screen lock: on'; wakeLock.addEventListener('release', () => { ui.wake.textContent = 'Screen lock: off'; }); }
    catch (_) { ui.wake.textContent = 'Screen lock: unavailable'; }
  }
  async function releaseWakeLock() { try { await wakeLock?.release(); } catch (_) {} wakeLock = null; }
  function segmentTarget(seg) {
    if (!Number.isFinite(seg.targetValue)) return seg.measurement === 'max-unbroken' ? 'Record max unbroken reps' : 'Target not configured';
    if (seg.targetKind === 'duration') return `${seg.targetValue} ${seg.unit || 'min'}`;
    return `${seg.targetValue} ${seg.unit || ''}`.trim();
  }
  function currentSegment() { return session?.segments?.[session.segmentIndex] || null; }
  function render() {
    if (!session) return;
    if (session.phase === T.PHASE.FINISHED) { renderSummary(); return; }
    show('timer');
    const plan = config.baselineWeek.find(p => p.id === session.planDay);
    ui.title.textContent = plan?.title || 'Training session';
    ui.subtitle.textContent = `${session.date} · ${session.source === 'baseline' ? 'BASELINE' : 'TRAINING'}`;
    ui.badge.textContent = phaseName(session.phase);
    ui.primary.textContent = T.primaryLabel(session, Date.now());
    ui.primary.disabled = session.phase === T.PHASE.DISCARDED;
    ui.rest.classList.toggle('hidden', ![T.PHASE.READY,T.PHASE.SEGMENT].includes(session.phase));
    ui.rest.textContent = session.phase === T.PHASE.UNPLANNED_REST ? 'Resume segment' : 'Take an unplanned break';
    ui.progress.style.width = `${Math.round(session.segmentIndex / session.segments.length * 100)}%`;
    ui.progressCopy.textContent = session.phase === T.PHASE.FINISH ? 'All segments logged · tap Finish to stop the session clock.' : `Segment ${Math.min(session.segmentIndex + 1, session.segments.length)} of ${session.segments.length}`;
    const seg = currentSegment();
    if (seg) {
      const segmentClock = session.phase === T.PHASE.PLANNED_REST ? session.restEvents[session.activeRestIndex] : null;
      if (segmentClock) {
        ui.clockLabel.textContent = 'PLANNED REST · REMAINING';
        ui.clock.textContent = fmt(Math.max(0, segmentClock.endsAt - Date.now()));
        ui.clockDetail.textContent = `Rest planned · ${fmt(segmentClock.plannedMs)}`;
      } else if (session.phase === T.PHASE.UNPLANNED_REST) {
        const ev = session.restEvents[session.activeRestIndex];
        ui.clockLabel.textContent = 'BREAK · ELAPSED'; ui.clock.textContent = fmt(Date.now() - ev.startedAt); ui.clockDetail.textContent = 'The active segment is paused.';
      } else if (session.phase === T.PHASE.SEGMENT) {
        ui.clockLabel.textContent = `SEGMENT ${session.segmentIndex + 1} · ELAPSED`;
        ui.clock.textContent = fmt(T.segmentElapsedMs(session, Date.now()));
        ui.clockDetail.textContent = `${session.title || ''} ${sessionElapsedText()}`.trim();
      } else {
        ui.clockLabel.textContent = 'SESSION · ELAPSED'; ui.clock.textContent = fmt(T.sessionElapsedMs(session, Date.now()));
        ui.clockDetail.textContent = session.phase === T.PHASE.FINISH ? 'Ready to finish' : 'Ready for the next segment';
      }
      ui.segment.innerHTML = '';
      const title = document.createElement('h3'); title.textContent = seg.label;
      const meta = document.createElement('p'); meta.className = 'segment-meta'; meta.textContent = `${seg.type.replaceAll('_',' ')} · ${segmentTarget(seg)}${seg.device && seg.device !== 'none' ? ` · ${seg.device}` : ''}`;
      ui.segment.append(title, meta);
      if (session.phase === T.PHASE.SEGMENT) {
        const input = document.createElement('input'); input.id = 'actual-value'; input.type = 'number'; input.inputMode = 'decimal'; input.min = '0'; input.step = 'any';
        input.placeholder = `Actual ${seg.unit || 'value'} (optional)`; if (Number.isFinite(seg.targetValue)) input.value = String(seg.targetValue); input.setAttribute('aria-label', `Actual ${seg.unit || 'value'} for ${seg.label}`); ui.segment.append(input);
      }
    } else {
      ui.clockLabel.textContent = 'SESSION · ELAPSED'; ui.clock.textContent = fmt(T.sessionElapsedMs(session, Date.now())); ui.clockDetail.textContent = '';
      ui.segment.innerHTML = '<h3>All segments logged</h3><p class="segment-meta">Tap Finish to stop the session timer.</p>';
    }
    ui.message.textContent = '';
  }
  function sessionElapsedText() { return `Session ${fmt(T.sessionElapsedMs(session, Date.now()))}`; }
  function renderSummary() {
    show('summary');
    const plan = config.baselineWeek.find(p => p.id === session.planDay);
    ui.summaryTitle.textContent = plan?.title || 'Workout complete';
    const summary = T.sessionSummary(session, Date.now());
    ui.summaryBody.innerHTML = `<div class="split-row"><strong>Total time</strong><span>${fmt(summary.durationMs)}</span><small>${summary.hitCount} of ${summary.scoredCount} targets hit · ${summary.segmentCount} segments · ${summary.restEvents} breaks</small></div>`;
    ui.splitList.replaceChildren();
    session.segments.forEach((seg, index) => {
      const row = document.createElement('div'); row.className = 'split-row';
      const info = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = seg.label;
      const detail = document.createElement('small'); detail.textContent = `${fmt(seg.durationMs || 0)} split · ${seg.actualValue == null ? 'no actual logged' : `${seg.actualValue} ${seg.unit}`} · ${seg.result || 'unscored'}`;
      info.append(title, detail);
      const edit = document.createElement('button'); edit.className = 'secondary'; edit.textContent = 'Edit split'; edit.addEventListener('click', () => editSplit(index));
      row.append(info, edit); ui.splitList.append(row);
    });
  }
  async function editSplit(index) {
    const seg = session.segments[index];
    const actual = prompt(`Actual ${seg.unit || 'value'} for ${seg.label}`, seg.actualValue ?? '');
    if (actual === null) return;
    const duration = prompt(`Split time in seconds for ${seg.label}`, ((seg.durationMs || 0) / 1000).toFixed(1));
    if (duration === null) return;
    const actualValue = actual.trim() === '' ? null : Number(actual);
    const durationMs = duration.trim() === '' ? null : Number(duration) * 1000;
    try { await save(T.editSegmentResult(session, index, {actualValue, durationMs}, Date.now())); }
    catch (err) { alert(err.message); }
  }
  async function refreshHistory() {
    try {
      const all = await repository.list(); ui.history.replaceChildren();
      for (const s of all.slice(0, 8)) {
        const row = document.createElement('div'); row.className = 'history-item';
        const name = config.baselineWeek.find(p => p.id === s.planDay)?.title || 'Training session';
        row.textContent = `${s.date} · ${name} · ${phaseName(s.phase)}${s.phase === T.PHASE.FINISHED ? ` · ${fmt(T.sessionElapsedMs(s, Date.now()))}` : ''}`;
        ui.history.append(row);
      }
      if (!all.length) ui.history.textContent = 'No sessions saved yet.';
    } catch (err) { ui.history.textContent = err.message; }
  }
  async function exportBackup() {
    const backup = await repository.exportAll();
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `hyrox40-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function doPrimary() {
    try {
      const now = Date.now();
      let actual;
      if (session.phase === T.PHASE.SEGMENT) {
        const raw = $('actual-value')?.value;
        actual = raw === '' || raw == null ? undefined : Number(raw);
        if (raw && !Number.isFinite(actual)) throw new Error('Enter a valid number, or leave actual blank.');
      }
      const wasRest = session.phase === T.PHASE.UNPLANNED_REST;
      const next = T.primaryAction(session, now, actual);
      await save(next);
      if (next.phase === T.PHASE.FINISHED || next.phase === T.PHASE.DISCARDED) await releaseWakeLock();
      else await requestWakeLock();
      if (wasRest) ui.message.textContent = 'Timer resumed.';
      await refreshHistory();
    } catch (err) { ui.message.textContent = err.message; }
  }
  async function startNew() {
    const plan = config.baselineWeek.find(p => p.id === ui.select.value);
    if (!plan) return;
    if (session && activePhase(session.phase)) {
      ui.message.textContent = 'Finish or discard the current workout before starting another.'; return;
    }
    const startedAt = Date.now();
    const idle = T.createSession({ planDay: plan.id, source:'baseline', segments: expandedSegments(plan) }, startedAt);
    const next = T.startSession(idle, startedAt);
    try { await repository.save(idle, {checkpoint:false}); await save(next, true); await requestWakeLock(); await refreshHistory(); }
    catch (err) { alert(`Could not save the workout: ${err.message}`); }
  }
  async function undo() {
    if (!session) return;
    try {
      const restored = await repository.undo(session.id);
      if (!restored) { ui.message.textContent = 'Nothing to undo yet.'; return; }
      session = restored; ui.save.textContent = 'Last action undone'; render(); await refreshHistory();
    } catch (err) { ui.message.textContent = `Undo failed: ${err.message}`; }
  }
  async function unplannedRest() {
    try { await save(T.toggleUnplannedRest(session, Date.now())); await requestWakeLock(); }
    catch (err) { ui.message.textContent = err.message; }
  }
  async function discard() {
    try { await save(T.discardSession(session, Date.now())); await releaseWakeLock(); await refreshHistory(); }
    catch (err) { ui.message.textContent = err.message; }
  }
  function installTimer() {
    if (ticker) clearInterval(ticker);
    ticker = setInterval(async () => {
      if (!session || !activePhase(session.phase)) return;
      if (session.phase === T.PHASE.PLANNED_REST) {
        const advanced = T.advance(session, Date.now());
        if (advanced !== session) {
          try { await save(advanced, false); lastPersistedAutoPhase = advanced.phase; } catch (_) {}
        }
      }
      render();
    }, 250);
  }
  async function init() {
    try {
      const response = await fetch('./hyrox40-plan-config.json');
      if (!response.ok) throw new Error('Plan configuration could not be loaded.');
      config = await response.json(); populatePlans();
      await repository.requestPersistentStorage();
      const saved = await repository.list();
      session = saved.find(s => activePhase(s.phase)) || null;
      if (session) { ui.resumeNote.textContent = 'An unfinished workout was restored from local storage.'; render(); await requestWakeLock(); }
      else { show('start'); await refreshHistory(); }
      if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
      installTimer();
    } catch (err) {
      show('start'); ui.planNote.textContent = `Setup problem: ${err.message}. Serve this folder over HTTPS or localhost; browser storage is required.`;
    }
  }
  ui.primary.addEventListener('click', doPrimary);
  ui.rest.addEventListener('click', unplannedRest);
  $('begin').addEventListener('click', startNew);
  $('undo-action').addEventListener('click', undo);
  $('discard-action').addEventListener('click', () => $('confirm-dialog').showModal());
  $('confirm-dialog').addEventListener('close', () => { if ($('confirm-dialog').returnValue === 'confirm') discard(); });
  $('new-session').addEventListener('click', async () => { session = null; await refreshHistory(); show('start'); });
  $('export-all').addEventListener('click', () => exportBackup().catch(e => alert(e.message)));
  $('summary-export').addEventListener('click', () => exportBackup().catch(e => alert(e.message)));
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const backup = JSON.parse(await file.text()); const count = await repository.importAll(backup); alert(`Imported ${count} workout(s).`); await refreshHistory(); }
    catch (err) { alert(`Import failed: ${err.message}`); }
    event.target.value = '';
  });
  $('install-help').addEventListener('click', () => alert('Works offline after the first visit. Export backups regularly. Screen Wake Lock depends on browser support and permission.'));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      if (session && activePhase(session.phase)) {
        if (session.phase === T.PHASE.PLANNED_REST) {
          const advanced = T.advance(session, Date.now());
          if (advanced !== session) await save(advanced, false);
        }
        render(); await requestWakeLock();
      }
    }
  });
  init();
})();

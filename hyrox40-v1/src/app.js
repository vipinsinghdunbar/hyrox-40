'use strict';
(() => {
  const T = window.HyroxTimer;
  const repo = window.HyroxStorage.createRepository();
  const $ = id => document.getElementById(id);
  const screen = $('screen'), toast = $('toast');
  const NAV = ['today', 'plan', 'history', 'progress', 'profile'];
  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let config, view = 'today', currentSession = null, sessions = [], profile = null;
  let measurements = [], calendar = {}, program = {}, nextMeasurementDate = '', selectedDate = '', selectedPlanId = '', planOffset = 0;
  let tickHandle = null, toastHandle = null, wakeLock = null;

  const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const fromDateKey = key => { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d,12); };
  const addDays = (date, n) => { const result = new Date(date); result.setDate(result.getDate()+n); return result; };
  const monday = (date = new Date()) => { const d = new Date(date); d.setHours(12,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d; };
  const iso = date => localDateKey(date);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtMs = ms => { const sec = Math.max(0,Math.floor((ms||0)/1000)), h=Math.floor(sec/3600), m=Math.floor(sec%3600/60), s=sec%60; return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; };
  const fmtDate = key => fromDateKey(key).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
  const fmtShortDate = key => fromDateKey(key).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
  const phaseName = p => ({[T.PHASE.IDLE]:'Ready',[T.PHASE.READY]:'Ready',[T.PHASE.SEGMENT]:'In segment',[T.PHASE.PLANNED_REST]:'Rest',[T.PHASE.UNPLANNED_REST]:'Break',[T.PHASE.FINISH]:'Ready to finish',[T.PHASE.FINISHED]:'Complete',[T.PHASE.DISCARDED]:'Discarded'})[p]||'Ready';
  const planById = id => config.baselineWeek.find(p => p.id === id) || (()=>{const p=config.trainingWeek.find(x=>x.id===id);return p?{...p,planType:'training',requiresPlanConfig:true}:null;})();
  function programWeekNumber(date = localDateKey()) {
    if(!program.startWeek)return 1;
    const dayNumber=key=>{const [y,m,d]=key.split('-').map(Number);return Math.floor(Date.UTC(y,m-1,d)/86400000);};
    const startKey=iso(monday(fromDateKey(program.startWeek))), currentKey=iso(monday(fromDateKey(date)));
    return Math.max(1,Math.floor((dayNumber(currentKey)-dayNumber(startKey))/7)+1);
  }
  function isLockedPlan(plan) { return Boolean(plan?.requiresPlanConfig || (plan?.planType==='training' && config.review.status!=='coach-approved')); }
  const expandSegments = plan => {
    const rounds = Number.isInteger(plan.rounds) && plan.rounds > 1 ? plan.rounds : 1;
    return Array.from({length:rounds},(_,r)=>plan.segments.map((segment,i)=>({...segment,id:rounds>1?`${segment.id||`segment-${i+1}`}-r${r+1}`:segment.id,label:rounds>1?`${segment.label} · Round ${r+1}`:segment.label,round:r+1,rounds}))).flat();
  };
  const escape = esc;
  function displayStatus(date) {
    const saved = calendar[date]?.status;
    const session = sessions.find(s => s.date === date && s.phase === T.PHASE.FINISHED);
    if (session) return 'completed';
    return saved || '';
  }
  function weekDates(anchor = monday()) { return Array.from({length:7},(_,i)=>addDays(anchor,i)); }
  function planForDate(date) {
    const d=fromDateKey(date),day=(d.getDay()+6)%7;
    if(day>=5)return null;
    const week=programWeekNumber(date);
    if(week===1)return config.baselineWeek[day]||null;
    const training=config.trainingWeek[day];
    return training?{...training,planType:'training',requiresPlanConfig:true}:null;
  }
  function sessionsForDate(date) { return sessions.filter(s=>s.date===date).sort((a,b)=>(b.startedAt||b.createdAt)-(a.startedAt||a.createdAt)); }
  function completedThisWeek(anchor = monday()) { return weekDates(anchor).filter(d=>displayStatus(iso(d))==='completed').length; }
  function showToast(message) {
    toast.textContent=message; toast.classList.add('visible'); clearTimeout(toastHandle);
    toastHandle=setTimeout(()=>toast.classList.remove('visible'),2600);
  }
  function setNav() {
    document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.view===view || (view==='details'&&button.dataset.view==='plan') || (view==='workout-summary'&&button.dataset.view==='history')));
  }
  function nav(viewName) { view=viewName; render(); screen.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'smooth'}); }
  function phaseCycleLabel(date=localDateKey()) { const week=programWeekNumber(date);return week===1?'WEEK 1 · FOUNDATION / BASELINE':`WEEK ${week} · COACH REVIEW PENDING`; }
  function currentFocus(date=localDateKey()) { return programWeekNumber(date)===1?'Baseline & movement quality':'Training plan review'; }
  function currentFocusDescription(date=localDateKey()) { return programWeekNumber(date)===1?'Establish controlled starting splits across the HYROX stations. Record what you actually complete; coach review is needed before derived training targets are activated.':'The next training-week template is visible, but its placeholder loads, targets and progression rules are not enabled until a qualified coach approves the plan config.'; }
  function nearestPlannedDate() {
    const today=fromDateKey(localDateKey());
    for(let i=0;i<7;i++){const d=addDays(today,i), p=planForDate(iso(d));if(p)return {date:iso(d),plan:p};}
    return {date:localDateKey(),plan:config.baselineWeek[0]};
  }
  function header(title, subtitle='') { return `<p class="eyebrow">${esc(phaseCycleLabel())}</p><h1 class="view-title">${esc(title)}</h1>${subtitle?`<p class="view-subtitle">${esc(subtitle)}</p>`:''}`; }
  function button(label,action,kind='button-primary',extra='') { return `<button type="button" class="button ${kind} ${extra}" data-action="${esc(action)}">${esc(label)}</button>`; }
  function weekStrip(anchor=monday()) {
    const today=localDateKey();
    return `<div class="calendar-grid" aria-label="Week at a glance">${weekDates(anchor).map(date=>{const key=iso(date),status=displayStatus(key),plan=planForDate(key),dow=DAY_NAMES[(date.getDay()+6)%7].slice(0,2);return `<div class="calendar-day ${key===today?'today':''} ${status==='completed'?'complete':''} ${status==='missed'?'missed':''}" aria-label="${esc(DAY_NAMES[(date.getDay()+6)%7])}, ${esc(key)}, ${esc(status|| (plan?'planned':'rest'))}"><span class="dow">${dow}</span><span class="date">${date.getDate()}</span><span class="mark">${status==='completed'?'✓':status==='missed'?'×':plan?'•':'—'}</span></div>`;}).join('')}</div>`;
  }
  function nextWorkoutCard(date,plan) {
    const status=displayStatus(date), s=sessionsForDate(date)[0];
    const inProgress=Boolean(s&&![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(s.phase));
    const locked=isLockedPlan(plan);
    const state=status==='completed'?'Completed':status==='missed'?'Not completed':inProgress?'In progress':locked?'Coach review pending':'Planned';
    const sub=`${fmtShortDate(date)} · ${plan.segments.length} sections${plan.rounds>1?` · ${plan.rounds} rounds`:''}`;
    const action=inProgress?`resume:${s.id}`:`detail:${plan.id}:${date}`;
    const label=inProgress?'Resume active workout':'Open today’s session';
    const note=locked?'Draft template only. Coach review is required before it becomes a prescribed workout.':plan.segments[0]?.note||'A controlled baseline session. Enter actual results as you go.';
    const secondary=status==='completed'&&s?button('Review results',`resume:${s.id}`,'button-secondary'):(!locked&&status!=='completed'&&status!=='missed'?button('Not completed',`mark-missed:${date}`,'button-quiet'):'');
    return `<article class="workout-card next-action-card" aria-labelledby="next-action-title"><div><p class="eyebrow">${esc(inProgress?'NEXT ACTION · WORKOUT IN PROGRESS':locked?'NEXT ACTION · DRAFT SESSION':'NEXT ACTION · TODAY’S SESSION')}</p><div class="workout-meta"><span class="pill pill-yellow">${esc(state)}</span><span class="pill">${esc(sub)}</span></div><h2 id="next-action-title">${esc(plan.title)}</h2><p class="muted small">${esc(note)}</p></div><div class="button-row">${button(label,action,'button-primary')}${secondary}</div></article>`;
  }
  function renderToday() {
    const target=nearestPlannedDate(), current=localDateKey(), todayPlan=planForDate(current), week=monday();
    const active=sessions.find(s=>![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(s.phase));
    const plannedTotal=weekDates(week).filter(d=>Boolean(planForDate(iso(d)))).length||5;
    const done=completedThisWeek(week);
    const clampedDone=Math.min(done,plannedTotal);
    const progressPct=Math.round((clampedDone/plannedTotal)*100);
    const weekNo=programWeekNumber(current);
    const phaseBadge=weekNo===1?'Week 1 · Foundation / Baseline':`Week ${weekNo} · Coach review pending`;
    const nextSummary=active?`Next action: Resume active workout (${planById(active.planDay)?.title||'Training session'})`:todayPlan?`Next action: Open today’s session (${todayPlan.title})`:target.plan?`Recovery day · Next session: ${target.plan.title}`:'Recovery day';
    const weekFocus=`<section class="hero" aria-labelledby="weekly-focus-title"><div class="hero-header"><p class="week-label">WEEKLY FOCUS</p><span class="pill pill-yellow">${esc(phaseBadge)}</span></div><h2 id="weekly-focus-title" class="hero-focus">${esc(currentFocus(current))}</h2><p class="hero-note">${esc(currentFocusDescription(current))}</p><div class="hero-progress"><div class="hero-progress-header"><span id="weekly-sessions-label" class="hero-progress-label">Sessions logged</span><output id="weekly-sessions-count" class="hero-progress-count" aria-live="polite">${done} of ${plannedTotal} sessions logged</output></div><div class="progress-track hero-progress-track" role="progressbar" aria-labelledby="weekly-sessions-label" aria-label="Sessions logged this week" aria-valuemin="0" aria-valuemax="${plannedTotal}" aria-valuenow="${clampedDone}" aria-valuetext="${done} of ${plannedTotal} sessions logged (${progressPct}%)"><div class="progress-fill" style="width:${progressPct}%"></div></div><p class="hero-progress-meta"><span>${done}/${plannedTotal} completed this week (${progressPct}%)</span><span>${esc(nextSummary)}</span></p></div></section>`;
    let todayBlock;
    if(active){
      const activeTitle=planById(active.planDay)?.title||'Training session';
      const segProgress=`Segment ${Math.min(active.segmentIndex+1,active.segments.length)} of ${active.segments.length}`;
      todayBlock=`<div class="section-heading"><h2>Next action</h2><a href="#plan" data-nav="plan">Full plan</a></div><article class="workout-card next-action-card" aria-labelledby="next-action-title"><div><p class="eyebrow">NEXT ACTION · WORKOUT IN PROGRESS</p><div class="workout-meta"><span class="pill pill-yellow">${esc(phaseName(active.phase))}</span><span class="pill">${esc(segProgress)}</span><span class="pill">${esc(fmtShortDate(active.date))}</span></div><h2 id="next-action-title">${esc(activeTitle)}</h2><p class="muted small">Your timer and logged splits are saved locally on this device. Resume where you left off${todayPlan?' or open today’s session details':''}.</p></div><div class="button-row">${button('Resume active workout',`resume:${active.id}`,'button-primary')}${todayPlan?button('Open today’s session',`detail:${todayPlan.id}:${current}`,'button-secondary'):''}</div></article>`;
    }else if(todayPlan){
      todayBlock=`<div class="section-heading"><h2>Next action</h2><a href="#plan" data-nav="plan">Full plan</a></div>${nextWorkoutCard(current,todayPlan)}`;
    }else{
      const fallbackPlan=target.plan||config.baselineWeek[0];
      const fallbackDate=target.date||current;
      todayBlock=`<div class="section-heading"><h2>Next action</h2><a href="#plan" data-nav="plan">Full plan</a></div><article class="workout-card next-action-card" aria-labelledby="next-action-title"><div><p class="eyebrow">NEXT ACTION · RECOVERY DAY</p><div class="workout-meta"><span class="pill pill-yellow">Recovery</span><span class="pill">${esc(fmtShortDate(current))}</span></div><h2 id="next-action-title">Recovery &amp; next session preview</h2><p class="muted small">Your five-day schedule leaves the weekend open for recovery. Next planned workout: ${esc(fallbackPlan.title)} (${esc(fmtShortDate(fallbackDate))}).</p></div><div class="button-row">${button('Open today’s session',`detail:${fallbackPlan.id}:${fallbackDate}`,'button-secondary')}</div></article>`;
    }
    return `${header('Today','Your training, saved on this device.')}${weekFocus}${todayBlock}<div class="section-heading"><h2>This week</h2><a href="#plan" data-nav="plan">Open plan</a></div>${weekStrip()}<section class="card details-card" style="margin-top:14px"><details><summary>Training and safety note</summary><div class="details-body">Training support only, not medical advice. The guide’s plan numbers are provisional pending qualified-coach review. Skip training if unwell; stop if you feel unwell or experience pain.</div></details></section>`;
  }
  function dayCard(date,plan) {
    const key=iso(date), status=displayStatus(key), previous=sessionsForDate(key)[0];
    const state=status==='completed'?'Completed':status==='missed'?'Not completed':previous&&![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(previous.phase)?'In progress':plan?'Planned':'Rest';
    const cls=status==='completed'?'done':status==='missed'?'missed':'';
    const main=plan?plan.title:'Recovery / open day';
    const action=plan?`detail:${plan.id}:${key}`:`rest:${key}`;
    const link=plan?(previous&&![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(previous.phase)?`resume:${previous.id}`:action):action;
    return `<article class="day-card"><span class="day-name">${esc(DAY_NAMES[(date.getDay()+6)%7])}</span><div><strong>${esc(main)}</strong><small>${esc(fmtDate(key))} · ${esc(plan?plan.intensity||'Baseline assessment':'Recovery')}</small></div><button class="text-button day-status ${cls}" data-action="${esc(link)}" aria-label="${esc(`${state}: ${main}`)}">${esc(state)}</button></article>`;
  }
  function renderPlan() {
    const anchor=addDays(monday(),planOffset*7),range=`${fmtShortDate(iso(anchor))} — ${fmtShortDate(iso(addDays(anchor,6)))}`;
    const items=weekDates(anchor).map(date=>dayCard(date,planForDate(iso(date)))).join('');
    const completed=completedThisWeek(anchor),weekNo=programWeekNumber(iso(anchor));
    const phaseTitle=weekNo===1?'Foundation · baseline week':`Foundation · training week ${weekNo}`;
    const phaseFocus=weekNo===1?currentFocus(iso(anchor)):'Coach-reviewed plan required before training targets are enabled';
    return `${header('Plan','A balanced default week. Exercises appear inside each session.')}
      <section class="card"><p class="eyebrow">TRAINING PHASE</p><h2>${esc(phaseTitle)}</h2><p class="muted small">Focus: ${esc(phaseFocus)}. Progression remains disabled until the plan configuration is coach-reviewed.</p><div class="week-nav"><button type="button" data-action="week-prev" aria-label="Previous week">‹</button><strong>${esc(range)}</strong><button type="button" data-action="week-next" aria-label="Next week">›</button></div>${weekStrip(anchor)}<p class="tiny">${weekNo===1?`${completed} of 5 baseline sessions logged`:'Training template shown for orientation only · prescriptions locked'}</p></section>
      <div class="section-heading"><h2>Weekly sessions</h2></div><div class="day-list">${items}</div>
      <section class="card details-card" style="margin-top:14px"><details><summary>Why this phase?</summary><div class="details-body">Baseline tests establish current running and station performance. Use a hard-but-controlled effort and skip testing if unwell. No training-load prescription or progression is activated from placeholder values.</div></details></section>
      <section class="card"><p class="eyebrow">LONG-TERM JOURNEY</p><h2>Training phases</h2><p class="muted small">The sequence is a planning framework, not an active adaptive plan yet. Transition criteria await coach-reviewed rules.</p><div class="list">${[['Foundation','Establish baseline and training consistency.'],['Strength Development','Build station strength and load tolerance.'],['Running Development','Develop repeatable running performance.'],['HYROX Specificity','Integrate running with race stations.'],['Race Preparation','Sharpen race-specific execution after requirements are reviewed.'],['Performance / Maintenance','Maintain qualities and adapt from logged results.']].map((phase,i)=>`<div class="list-item"><div><strong>${i===0?'Current · ':''}${esc(phase[0])}</strong><small>${esc(phase[1])}${i===0?' · Current focus: baseline assessment.':' · Not activated; duration and entry criteria require coach review.'}</small></div></div>`).join('')}</div></section>`;
  }
  function segmentDetails(seg,index) {
    const target=Number.isFinite(seg.targetValue)?`${seg.targetValue} ${seg.unit||''}`.trim():seg.measurement==='max-unbroken'?'Record maximum unbroken reps':'Target to be configured';
    const note=seg.note?`<small>${esc(seg.note)}</small>`:'';
    return `<div class="list-item"><div><strong>${String(index+1).padStart(2,'0')} · ${esc(seg.label||seg.type)}</strong><small>${esc(target)}${seg.device&&seg.device!=='none'?` · ${esc(seg.device)}`:''}${seg.weightKg!=null?` · prescribed ${esc(seg.weightKg)} kg`:''}</small>${note}</div></div>`;
  }
  function renderDetails() {
    const plan=planById(selectedPlanId); if(!plan){view='plan';return renderPlan();}
    const segments=expandSegments(plan), date=selectedDate||localDateKey();
    return `${header(plan.title,`${fmtShortDate(date)} · ${plan.intensity||'Baseline assessment'}`)}
      <section class="card card-dark"><p class="eyebrow">SESSION OVERVIEW</p><h2>${esc(plan.title)}</h2><p class="muted small">${esc(plan.description||plan.segments[0]?.note||'Work steadily and record actual results.')}</p><div class="workout-meta"><span class="pill">${segments.length} segments</span><span class="pill">${plan.rounds||1} ${plan.rounds===1?'round':'rounds'}</span><span class="pill pill-yellow">Coach review pending</span></div></section>
      <div class="section-heading"><h2>Workout detail</h2><span class="tiny">${segments.length} items</span></div><div class="list">${segments.map(segmentDetails).join('')}</div>
      <p class="notice" style="margin:13px 0">Plan numbers are placeholders until qualified-coach review. No sled weight is prescribed by this app.</p>
      <div class="button-row">${isLockedPlan(plan)?'<button class="button button-secondary" type="button" disabled>Locked · coach review pending</button>':button('Start session',`start:${plan.id}:${date}`,'button-primary')}${!isLockedPlan(plan)?button('Not completed',`mark-missed:${date}`,'button-secondary'):''}</div>
      <button type="button" class="text-button" data-action="nav:plan">← Back to plan</button>`;
  }
  function liveClock(session, now) {
    if(session.phase===T.PHASE.PLANNED_REST){const r=session.restEvents[session.activeRestIndex];return {caption:'Planned rest · remaining',value:fmtMs(Math.max(0,r.endsAt-now)),detail:`Planned ${fmtMs(r.plannedMs)}`};}
    if(session.phase===T.PHASE.UNPLANNED_REST){const r=session.restEvents[session.activeRestIndex];return {caption:'Break · elapsed',value:fmtMs(now-r.startedAt),detail:'Segment timer paused'};}
    if(session.phase===T.PHASE.SEGMENT)return {caption:`Segment ${session.segmentIndex+1} · elapsed`,value:fmtMs(T.segmentElapsedMs(session,now)),detail:`Session ${fmtMs(T.sessionElapsedMs(session,now))}`};
    return {caption:'Session · elapsed',value:fmtMs(T.sessionElapsedMs(session,now)),detail:session.phase===T.PHASE.FINISH?'All segments logged':'Ready for the next segment'};
  }
  function renderWorkout() {
    const s=currentSession;if(!s){view='today';return renderToday();}
    const plan=planById(s.planDay),seg=s.segments[s.segmentIndex],clock=liveClock(s,Date.now());
    const percent=Math.round((s.segmentIndex/Math.max(s.segments.length,1))*100);
    const primary=T.primaryLabel(s,Date.now());
    let entry='';
    if(seg&&s.phase===T.PHASE.SEGMENT){
      const primaryLabel=seg.targetKind==='distance'?'Actual distance':seg.targetKind==='reps'?'Actual reps':'Actual value';
      const unit=seg.unit|| (seg.targetKind==='distance'?'m':seg.targetKind==='reps'?'reps':'');
      const def=Number.isFinite(seg.targetValue)?`value="${esc(seg.targetValue)}"`:'';
      entry=`<div class="field-grid"><div class="field"><label for="actual-value">${esc(primaryLabel)} (${esc(unit)})</label><input class="input" id="actual-value" name="actual-value" type="number" inputmode="decimal" min="0" step="any" ${def} placeholder="Optional"></div>${seg.type.includes('sled')?`<div class="field"><label for="actual-weight">Actual sled load (kg)</label><input class="input" id="actual-weight" type="number" inputmode="decimal" min="0" step="0.5" placeholder="Not prescribed"></div>`:''}</div>`;
    }
    const card=seg?`<article class="segment-card"><p class="eyebrow">${esc(seg.round?`ROUND ${seg.round}${seg.rounds?` / ${seg.rounds}`:''} · `:'' )}SEGMENT ${s.segmentIndex+1} / ${s.segments.length}</p><h2>${esc(seg.label)}</h2><p class="segment-target">${esc(Number.isFinite(seg.targetValue)?`${seg.targetValue} ${seg.unit||''}`.trim():seg.measurement==='max-unbroken'?'Max unbroken reps':'Record actual result')}</p><p class="segment-description">${esc([seg.type.replaceAll('_',' '),seg.device&&seg.device!=='none'?seg.device:'',seg.note||''].filter(Boolean).join(' · '))}</p></article>`:`<article class="segment-card"><p class="eyebrow">ALL WORK LOGGED</p><h2>Ready to finish</h2><p class="segment-description">Tap Finish to save this session.</p></article>`;
    const restControl=[T.PHASE.READY,T.PHASE.SEGMENT].includes(s.phase)?button('Rest / break','rest','button-secondary'):'';
    return `${header(plan?.title||'Workout',`${fmtShortDate(s.date)} · ${esc(phaseName(s.phase))}`)}
      <section class="card timer-card"><span class="timer-caption">${esc(clock.caption)}</span><output id="timer-readout" class="timer-readout" aria-label="Timer">${clock.value}</output><p id="timer-detail" class="timer-detail">${esc(clock.detail)}</p><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><p class="tiny">${s.segments.length?`Segment ${Math.min(s.segmentIndex+1,s.segments.length)} of ${s.segments.length}`:'No segments'}</p></section>
      ${card}${entry}
      <div class="button-row" style="margin-top:12px">${button(primary,'primary-action','button-primary')}${restControl}</div>
      <div class="button-row" style="margin-top:5px">${button('Undo last action','undo','button-quiet')}${button('Discard session','discard','button-quiet')}</div>
      <p class="tiny">Timer timestamps and workout actions save locally. Keep this page open for Wake Lock when supported.</p>`;
  }
  function paceText(seg) {
    const distance=seg.actualDistanceM??seg.actualValue??seg.targetValue,duration=seg.durationMs;
    if(!(distance>0)||!(duration>0))return '—';
    const seconds=duration/1000*1000/distance, m=Math.floor(seconds/60),s=Math.floor(seconds%60);
    return `${m}:${String(s).padStart(2,'0')} / km`;
  }
  function renderSummary() {
    const s=currentSession,plan=planById(s.planDay),summary=T.sessionSummary(s,Date.now());
    return `${header('Session saved',`${esc(plan?.title||'Workout')} · ${fmtShortDate(s.date)}`)}
      <section class="hero"><p class="week-label">WORKOUT COMPLETE</p><h2 class="hero-focus">${fmtMs(summary.durationMs)}</h2><p class="hero-note">${summary.hitCount} of ${summary.scoredCount} scored targets hit · ${summary.segmentCount} segments logged.</p></section>
      <div class="section-heading"><h2>Performance splits</h2></div><div class="split-list">${s.segments.map((seg,i)=>`<div class="split-row"><div><strong>${i+1}. ${esc(seg.label)}</strong><small>${fmtMs(seg.durationMs)} · ${seg.actualValue==null?'No actual recorded':`${esc(seg.actualValue)} ${esc(seg.unit)}`} · pace ${esc(paceText(seg))}${seg.actualWeightKg!=null?` · ${esc(seg.actualWeightKg)} kg`:''} · ${esc(seg.result||'unscored')}</small></div><button class="button button-secondary" data-action="edit-split:${i}">Edit</button></div>`).join('')}</div>
      <div class="button-row" style="margin-top:14px">${button('Back to Today','nav:today','button-primary')}${button('Export backup','export','button-secondary')}</div>`;
  }
  function renderHistory() {
    const list=sessions.filter(s=>s.phase===T.PHASE.FINISHED);
    if(!list.length)return `${header('History','Completed sessions on this device.')}<div class="empty-state">No completed workouts yet. Start a session from Today or Plan; it will appear here when finished.</div>`;
    return `${header('History','Completed sessions and recorded performance.')}<div class="list">${list.map(s=>{const p=planById(s.planDay),sum=T.sessionSummary(s,Date.now());return `<article class="list-item"><div><strong>${esc(p?.title||'Training session')}</strong><small>${esc(fmtDate(s.date))} · ${fmtMs(sum.durationMs)} · ${s.segments.length} segments · ${s.restEvents.length} breaks</small>${s.segments.some(x=>x.actualWeightKg!=null)?`<small>Recorded load: ${s.segments.filter(x=>x.actualWeightKg!=null).map(x=>`${esc(x.actualWeightKg)} kg`).join(', ')}</small>`:''}</div><span class="pill pill-yellow">Saved</span></article>`;}).join('')}</div>`;
  }
  function chartSvg(points, label, formatValue) {
    if(points.length<2)return `<div class="empty-state">Add at least two recorded measurements to see a trend.</div>`;
    const W=360,H=155,L=40,R=12,Tp=14,B=26, vals=points.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
    const xy=points.map((p,i)=>({x:L+i*(W-L-R)/(points.length-1),y:Tp+(max-p.value)*(H-Tp-B)/range,p}));
    const poly=xy.map(q=>`${q.x},${q.y}`).join(' ');
    const labels=xy.map(q=>`<text class="chart-label" x="${q.x}" y="${H-7}" text-anchor="middle">${esc(q.p.label||'')}</text>`).join('');
    const dots=xy.map(q=>`<circle class="chart-dot" cx="${q.x}" cy="${q.y}" r="4"><title>${esc(q.p.label)}: ${esc(formatValue(q.p.value))}</title></circle>`).join('');
    return `<div class="chart-wrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} trend"><title>${esc(label)} trend</title><line class="chart-grid" x1="${L}" y1="${Tp}" x2="${W-R}" y2="${Tp}"/><line class="chart-grid" x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}"/><polyline class="chart-line" points="${poly}"/>${dots}${labels}</svg></div>`;
  }
  function formatKg(value) { return `${Number(value).toFixed(1)} kg`; }
  function formatWeight(kg) { return profile.units==='imperial'?`${(Number(kg)*2.2046226218).toFixed(1)} lb`:formatKg(kg); }
  function runPoints() {
    const entries=[];
    sessions.filter(s=>s.phase===T.PHASE.FINISHED).sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>s.segments.forEach(seg=>{
      const distance=seg.actualDistanceM??seg.actualValue??seg.targetValue;
      if(seg.type==='run'&&distance>0&&seg.durationMs>0){entries.push({value:seg.durationMs/1000*1000/distance,label:fromDateKey(s.date).toLocaleDateString(undefined,{day:'numeric',month:'short'})});}
    }));
    return entries.slice(-10);
  }
  function renderProgress() {
    const sorted=measurements.slice().sort((a,b)=>a.date.localeCompare(b.date)),current=sorted[sorted.length-1],runs=runPoints();
    const weightChart=chartSvg(sorted.slice(-8).map(m=>({value:profile.units==='imperial'?m.kg*2.2046226218:m.kg,label:fromDateKey(m.date).toLocaleDateString(undefined,{day:'numeric',month:'short'})})),'Body weight',v=>profile.units==='imperial'?`${Number(v).toFixed(1)} lb`:formatKg(v));
    const paceChart=runs.length<2?'<div class="empty-state">Log two or more run segments to see a pace trend.</div>':chartSvg(runs,'Run pace',v=>`${Math.floor(v/60)}:${String(Math.round(v%60)).padStart(2,'0')} / km`);
    const next=nextMeasurementDate?fmtDate(nextMeasurementDate):'Choose a date below';
    return `${header('Progress','A record of what you have actually logged—not estimated targets.')}
      <section class="card"><p class="eyebrow">BODY WEIGHT</p><h2>${current?formatWeight(current.kg):'No measurement yet'}</h2><p class="muted small">${current?`Latest · ${esc(fmtDate(current.date))}`:'Add dated measurements to build a trend.'}</p>${weightChart}<div class="section-heading"><h2>Add measurement</h2></div><form id="weight-form" class="field-grid"><div class="field"><label for="weight-value">Weight (${profile.units==='imperial'?'lb':'kg'})</label><input class="input" id="weight-value" name="kg" type="number" inputmode="decimal" min="1" max="500" step="0.1" required placeholder="e.g. 83.6"></div><div class="field"><label for="weight-date">Measurement date</label><input class="input" id="weight-date" name="date" type="date" value="${localDateKey()}" required></div><button class="button button-primary" type="submit">Save measurement</button></form><p class="helper">Next measurement: ${esc(next)}. Choose a date that suits your routine; no cadence is assumed.</p><div class="field" style="margin-top:10px"><label for="next-measurement">Set next measurement date</label><input class="input" id="next-measurement" type="date" value="${esc(nextMeasurementDate)}"></div>${sorted.length?`<div class="list" style="margin-top:12px">${sorted.slice().reverse().slice(0,5).map(m=>`<div class="list-item"><div><strong>${formatWeight(m.kg)}</strong><small>${esc(fmtDate(m.date))}</small></div><button class="text-button" data-action="delete-measurement:${esc(m.id)}">Remove</button></div>`).join('')}</div>`:''}</section>
      <section class="card"><p class="eyebrow">RUN PACE</p><h2>Recorded run splits</h2>${paceChart}</section>
      <section class="card"><p class="eyebrow">HYROX PERFORMANCE</p><h2>Logged station metrics</h2>${renderMetricSummary()}</section>`;
  }
  function renderMetricSummary() {
    const all=sessions.filter(s=>s.phase===T.PHASE.FINISHED).flatMap(s=>s.segments.map(seg=>({...seg,date:s.date})));
    const types=['skierg','row','sled_push','sled_pull','farmers_carry','sandbag_lunge','wallball','burpee_broad_jump'];
    const rows=types.map(type=>{const matches=all.filter(x=>x.type===type);return matches.length?`<div class="list-item"><div><strong>${esc(type.replaceAll('_',' '))}</strong><small>${matches.length} logged · latest ${esc(matches[0].actualValue??'—')} ${esc(matches[0].unit||'')} · ${esc(fmtDate(matches[0].date))}</small></div></div>`:''}).filter(Boolean);
    return rows.length?`<div class="list">${rows.join('')}</div>`:'<div class="empty-state">Station performance appears here as you log it. No loads or target values are guessed.</div>';
  }
  function renderProfile() {
    const equip=config.athleteDefaults.equipment||[];
    return `${header('Profile','Only settings that help the training log. No goals questionnaire.')}
      <form id="profile-form" class="card"><p class="eyebrow">ATHLETE SETUP</p><div class="field-grid"><div class="field"><label for="division">Division</label><select class="select" id="division" name="division"><option value="open" ${profile.division==='open'?'selected':''}>Open</option><option value="pro" ${profile.division==='pro'?'selected':''}>Pro</option></select></div><div class="field"><label for="gender">Category</label><select class="select" id="gender" name="gender"><option value="men" ${profile.gender==='men'?'selected':''}>Men</option><option value="women" ${profile.gender==='women'?'selected':''}>Women</option></select></div><div class="field"><label for="units">Units</label><select class="select" id="units" name="units"><option value="metric" ${profile.units==='metric'?'selected':''}>Metric</option><option value="imperial" ${profile.units==='imperial'?'selected':''}>Imperial</option></select></div></div><div class="section-heading"><h2>Available equipment</h2></div><div class="equipment-list">${equip.map(item=>`<label class="check-row"><input type="checkbox" name="equipment" value="${esc(item)}" ${profile.equipment.includes(item)?'checked':''}><span>${esc(item.replaceAll('_',' '))}</span></label>`).join('')}</div><button class="button button-primary button-block" type="submit">Save profile</button><p class="helper">No goals picker, race-date field, benchmark requirement, or sled-weight assumption.</p></form>
      <section class="card details-card"><details><summary>Health & safety</summary><div class="details-body">This app is a training aid, not medical advice. Train within your current capacity, use safe equipment loads, and seek qualified advice if unsure. Stop if you feel unwell or experience pain.</div></details></section>
      <section class="card"><p class="eyebrow">LOCAL DATA</p><h2>Your records stay on this device</h2><p class="muted small">Use the Backup button in the header before changing or replacing your phone.</p><div class="button-row">${button('Export backup','export','button-secondary')}${button('Import backup','import','button-secondary')}</div></section>`;
  }
  function render() {
    if(!config||!profile)return;
    setNav();
    const pages={today:renderToday,plan:renderPlan,details:renderDetails,workout:renderWorkout,'workout-summary':renderSummary,history:renderHistory,progress:renderProgress,profile:renderProfile};
    screen.innerHTML=(pages[view]||renderToday)();
    const running=currentSession&&![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(currentSession.phase);
    $('connection-state').title=window.navigator.onLine?'Online · saved on device':'Offline · saved on device';
    $('connection-state').style.background=window.navigator.onLine?'var(--green)':'var(--yellow)';
    if(view==='workout')updateClock();
  }
  function updateClock() {
    if(view!=='workout'||!currentSession)return;
    const clock=liveClock(currentSession,Date.now());
    const out=$('timer-readout'),detail=$('timer-detail');
    if(out)out.textContent=clock.value;if(detail)detail.textContent=clock.detail;
  }
  async function refreshData() {
    [sessions,profile,measurements,calendar,program]=await Promise.all([
      repo.list(),repo.getMetadata('profile',config.athleteDefaults),repo.getMetadata('measurements',[]),repo.getMetadata('calendar',{}),repo.getMetadata('program',{})
    ]);
    profile={...config.athleteDefaults,...(profile||{})};
    measurements=Array.isArray(measurements)?measurements:[];calendar=calendar&&typeof calendar==='object'?calendar:{};
    if(typeof program==='string')program={nextMeasurementDate:program};
    if(!program||typeof program!=='object')program={};
    if(!program.startWeek){program.startWeek=iso(monday());await repo.setMetadata('program',program);}
    nextMeasurementDate=typeof program.nextMeasurementDate==='string'?program.nextMeasurementDate:'';
    currentSession=sessions.find(s=>![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(s.phase))||null;
    if(currentSession)view='workout';
  }
  async function startWorkout(planId,date=localDateKey()) {
    const plan=planById(planId);if(!plan){showToast('That session is not available.');return;}
    if(isLockedPlan(plan)){showToast('This training template is locked pending qualified-coach review of the plan config.');return;}
    if(currentSession&&![T.PHASE.FINISHED,T.PHASE.DISCARDED].includes(currentSession.phase)){view='workout';render();return;}
    const now=Date.now(), idle=T.createSession({planDay:planId,date,source:'baseline',segments:expandSegments(plan)},now);
    currentSession=T.startSession(idle,now);
    try{await repo.save(idle,{checkpoint:false});await repo.save(currentSession);sessions=await repo.list();view='workout';render();await requestWakeLock();}
    catch(error){currentSession=null;showToast(`Could not save: ${error.message}`);}
  }
  async function requestWakeLock() {
    if(!('wakeLock'in navigator))return;
    try{wakeLock=await navigator.wakeLock.request('screen');wakeLock.addEventListener('release',()=>{wakeLock=null;});}catch(_){wakeLock=null;}
  }
  async function releaseWakeLock(){try{await wakeLock?.release();}catch(_){}wakeLock=null;}
  async function persistSession(next,checkpoint=true) {
    currentSession=next;await repo.save(next,{checkpoint});sessions=await repo.list();render();
  }
  async function primaryAction() {
    if(!currentSession)return;
    try{
      const s=currentSession,now=Date.now();let actual,metrics={};
      if(s.phase===T.PHASE.SEGMENT){
        const seg=s.segments[s.segmentIndex],raw=$('actual-value')?.value;
        actual=raw==null||raw===''?undefined:Number(raw);
        if(raw&& !Number.isFinite(actual))throw new Error('Enter a valid actual result, or leave it blank.');
        if(seg.targetKind==='distance')metrics.actualDistanceM=actual??seg.targetValue;
        if(seg.targetKind==='reps')metrics.actualReps=actual??seg.targetValue;
        const weight=$('actual-weight')?.value;if(weight)metrics.actualWeightKg=Number(weight);
        const next=T.completeSegment(s,now,actual,metrics);
        await persistSession(next);
        if(next.phase===T.PHASE.FINISH)showToast('All segments logged. Tap Finish to save the session.');
      }else{
        const next=T.primaryAction(s,now);
        await persistSession(next);
        if(next.phase===T.PHASE.FINISHED){calendar[next.date]={status:'completed',updatedAt:now};await repo.setMetadata('calendar',calendar);await releaseWakeLock();view='workout-summary';render();}
        else if(next.phase===T.PHASE.READY)await requestWakeLock();
      }
    }catch(error){showToast(error.message);}
  }
  async function markStatus(date,status) {
    if(status==='completed'){
      const plan=planForDate(date);if(plan){selectedDate=date;await startWorkout(plan.id,date);return;}
    }
    calendar[date]={status,updatedAt:Date.now()};await repo.setMetadata('calendar',calendar);render();showToast(status==='missed'?'Marked not completed.':'Status saved.');
  }
  async function undo() {
    if(!currentSession)return;
    try{const restored=await repo.undo(currentSession.id);if(!restored){showToast('Nothing to undo yet.');return;}currentSession=restored;sessions=await repo.list();view='workout';render();showToast('Last action undone.');}
    catch(error){showToast(`Undo failed: ${error.message}`);}
  }
  async function discard() {
    if(!currentSession)return;
    try{await persistSession(T.discardSession(currentSession,Date.now()));await releaseWakeLock();view='today';render();showToast('Session discarded.');}
    catch(error){showToast(error.message);}
  }
  async function editSplit(index) {
    if(!currentSession)return;const seg=currentSession.segments[index];
    const actual=prompt(`Actual ${seg.unit||'value'} for ${seg.label}`,seg.actualValue??'');if(actual===null)return;
    const seconds=prompt(`Split time in seconds for ${seg.label}`,((seg.durationMs||0)/1000).toFixed(1));if(seconds===null)return;
    const patch={actualValue:actual.trim()===''?null:Number(actual),durationMs:seconds.trim()===''?null:Number(seconds)*1000};
    if(String(seg.type).includes('sled')){const weight=prompt(`Actual sled load in kg for ${seg.label}`,seg.actualWeightKg??'');if(weight===null)return;patch.actualWeightKg=weight.trim()===''?null:Number(weight);}
    try{const next=T.editSegmentResult(currentSession,index,patch,Date.now());await persistSession(next,false);view='workout-summary';render();}
    catch(error){showToast(error.message);}
  }
  async function exportBackup() {
    try{const backup=await repo.exportAll(),blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`hyrox40-backup-${localDateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('Backup exported.');}
    catch(error){showToast(`Export failed: ${error.message}`);}
  }
  async function importBackup(file) {
    try{const backup=JSON.parse(await file.text()),count=await repo.importAll(backup);await refreshData();render();showToast(`Imported ${count} workout(s).`);}
    catch(error){showToast(`Import failed: ${error.message}`);}
  }
  async function saveWeight(form) {
    const fd=new FormData(form),kgRaw=Number(fd.get('kg')),date=String(fd.get('date')||'');
    if(!Number.isFinite(kgRaw)||kgRaw<1||kgRaw>500||!/^\d{4}-\d{2}-\d{2}$/.test(date)){showToast('Enter a valid weight and measurement date.');return;}
    const kg=profile.units==='imperial'?kgRaw/2.2046226218:kgRaw;
    const record={id:`weight-${date}`,date,kg:Number(kg.toFixed(2)),enteredValue:kgRaw,units:profile.units,createdAt:Date.now()};
    const existing=measurements.filter(m=>m.date!==date);measurements=[...existing,record].sort((a,b)=>a.date.localeCompare(b.date));
    await repo.setMetadata('measurements',measurements);render();showToast('Measurement saved on this device.');
  }
  async function saveProfile(form) {
    const fd=new FormData(form);profile={...profile,division:String(fd.get('division')),gender:String(fd.get('gender')),units:String(fd.get('units')),equipment:fd.getAll('equipment').map(String)};
    await repo.setMetadata('profile',profile);render();showToast('Profile saved.');
  }
  async function routeAction(action) {
    if(action==='primary-action')return primaryAction();
    if(action==='rest'){if(currentSession)try{await persistSession(T.toggleUnplannedRest(currentSession,Date.now()));await requestWakeLock();}catch(e){showToast(e.message);}return;}
    if(action==='undo')return undo();if(action==='discard'){if($('confirm-dialog').showModal)$('confirm-dialog').showModal();else if(confirm('Discard this workout?'))discard();return;}
    if(action==='export')return exportBackup();if(action==='import'){$('import-file').click();return;}if(action==='week-prev'){planOffset--;render();return;}if(action==='week-next'){planOffset++;render();return;}
    if(action.startsWith('nav:')){nav(action.slice(4));return;}
    if(action.startsWith('start:')){const [,id,date]=action.split(':');await startWorkout(id,date);return;}
    if(action.startsWith('detail:')){const [,id,date]=action.split(':');selectedPlanId=id;selectedDate=date;view='details';render();return;}
    if(action.startsWith('resume:')){const id=action.slice(7);currentSession=sessions.find(s=>s.id===id)||currentSession;view=currentSession?.phase===T.PHASE.FINISHED?'workout-summary':'workout';render();if(currentSession)requestWakeLock();return;}
    if(action.startsWith('mark-completed:')){return markStatus(action.slice(15),'completed');}
    if(action.startsWith('mark-missed:')){return markStatus(action.slice(12),'missed');}
    if(action.startsWith('edit-split:')){return editSplit(Number(action.slice(11)));}
    if(action.startsWith('delete-measurement:')){const id=action.slice(19);measurements=measurements.filter(m=>m.id!==id);await repo.setMetadata('measurements',measurements);render();showToast('Measurement removed.');return;}
    if(action.startsWith('rest:')){showToast('Recovery day.');return;}
  }
  screen.addEventListener('click',event=>{
    const navButton=event.target.closest('[data-nav]');if(navButton){event.preventDefault();nav(navButton.dataset.nav);return;}
    const actionButton=event.target.closest('[data-action]');if(actionButton){event.preventDefault();routeAction(actionButton.dataset.action);}
  });
  screen.addEventListener('submit',event=>{
    if(event.target.id==='weight-form'){event.preventDefault();saveWeight(event.target);}
    if(event.target.id==='profile-form'){event.preventDefault();saveProfile(event.target);}
  });
  screen.addEventListener('change',async event=>{if(event.target.id==='next-measurement'){nextMeasurementDate=event.target.value;program.nextMeasurementDate=nextMeasurementDate;await repo.setMetadata('program',program);showToast('Next measurement date saved.');}});
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>nav(button.dataset.view)));
  $('backup-shortcut').addEventListener('click',exportBackup);
  $('import-file').addEventListener('change',event=>{const file=event.target.files?.[0];if(file)importBackup(file);event.target.value='';});
  $('confirm-dialog').addEventListener('close',()=>{if($('confirm-dialog').returnValue==='confirm')discard();});
  window.addEventListener('online',()=>{if($('connection-state'))$('connection-state').style.background='var(--green)';});
  window.addEventListener('offline',()=>{if($('connection-state'))$('connection-state').style.background='var(--yellow)';});
  document.addEventListener('visibilitychange',async()=>{if(document.visibilityState==='visible'){if(currentSession&&currentSession.phase===T.PHASE.PLANNED_REST){const advanced=T.advance(currentSession,Date.now());if(advanced!==currentSession)await persistSession(advanced,false);}if(currentSession)requestWakeLock();}});
  function enterApp(resumeActive=false){
    document.body.classList.add('app-entered');
    document.querySelector('.app-shell').setAttribute('aria-hidden','false');
    document.querySelector('.bottom-nav').hidden=false;
    view=resumeActive&&currentSession?'workout':'today';
    render();
    requestAnimationFrame(()=>screen.focus({preventScroll:true}));
    if(currentSession&&resumeActive)requestWakeLock();
  }
  $('launch-enter').addEventListener('click',()=>enterApp(false));
  $('launch-resume').addEventListener('click',()=>enterApp(true));
  async function init(){
    try{
      const response=await fetch('./hyrox40-plan-config.json');if(!response.ok)throw new Error('Plan config is missing.');config=await response.json();
      await repo.requestPersistentStorage();await refreshData();
      view=currentSession?(currentSession.phase===T.PHASE.FINISHED?'workout-summary':'workout'):'today';render();
      const enterButton=$('launch-enter'),resumeButton=$('launch-resume'),actions=$('launch-actions');
      if(currentSession){resumeButton.hidden=false;resumeButton.disabled=false;resumeButton.textContent='Resume active workout';}
      enterButton.disabled=false;actions.hidden=false;
      $('launch-status').textContent=currentSession?'Your saved workout is ready. Choose where to pick up.':'Your training space is ready.';
      document.querySelector('.launch-screen').classList.add('launch-ready');
      enterButton.focus({preventScroll:true});
      if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
      tickHandle=setInterval(()=>{
        if(!currentSession)return;
        if(currentSession.phase===T.PHASE.PLANNED_REST){const next=T.advance(currentSession,Date.now());if(next!==currentSession)persistSession(next,false);}
        updateClock();
      },250);
    }catch(error){
      $('launch-status').textContent=`Setup issue: ${error.message} Entry is disabled until setup is complete.`;
      screen.innerHTML=`<section class="card"><p class="eyebrow">SETUP ISSUE</p><h1 class="view-title">Could not load the app</h1><p class="muted">${esc(error.message)} Serve this folder on HTTPS or localhost. The app needs IndexedDB and its local plan config.</p></section>`;
    }
  }
  init();
})();

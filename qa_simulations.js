/* HYROX 40 automated smoke/scenario tests; Node.js built-ins only.
   Run: node qa_simulations.js (from the app directory). */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const html = fs.readFileSync('index.html', 'utf8');
assert(html.includes('prefers-reduced-motion:reduce'), 'Motion respects reduced-motion preferences');
assert(html.includes('id="timerProgress"') && html.includes('workout-progress'), 'Workout and timer progress affordances render');
assert(html.includes('width:44px;height:44px'), 'Movement completion control uses a phone-friendly tap target');
execFileSync(process.execPath, ['build.js']);
const builtVersion = JSON.parse(fs.readFileSync('dist/version.json', 'utf8')).version;
assert(fs.readFileSync('dist/index.html', 'utf8').includes(`name="app-version" content="${builtVersion}"`), 'Deployment build stamps its update ID into the app shell');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert(!html.includes('type="number"'), 'No direct numeric typing controls');
assert(!html.includes('RPE'), 'Jargon RPE is absent from user-facing app');

function boot(profile = null, logs = []) {
  const app = { innerHTML: '' };
  const toast = { textContent: '', classList: { add() {}, remove() {} } };
  let stored = profile ? JSON.stringify({
    page: 'today', selected: null,
    profile: { setupComplete: true, age: 35, weight: 75, height: 175,
      gender: 'women', division: 'open', goals: ['first','run'],
      level: 'intermediate', run1k: 360, ski500: 150, row500: 140,
      sledEmpty: 25, ...profile },
    bodyChecks: [], logs, adjustments: {}, session: null
  }) : null;
  const callbacks = [];
  const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : [Date.UTC(2026, 8, 27, 12)])); } static now() { return Date.UTC(2026, 8, 27, 12); } };
  const ctx = {
    Date: FixedDate,
    localStorage: {
      getItem() { return stored; },
      setItem(_k, v) { stored = v; },
      removeItem() { stored = null; }
    },
    document: { getElementById(id) { return id === 'app' ? app : id === 'toast' ? toast : null; }, querySelector() { return { content: 'dev' }; }, querySelectorAll() { return []; } },
    navigator: {}, window: { scrollTo() {}, location: { protocol: 'http:', pathname: '/', search: '' } }, confirm() { return true; },
    setInterval(fn) { callbacks.push(fn); return callbacks.length; },
    clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {}, console
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  // Passkey-era gate: the app only renders training screens when a user is
  // signed in. Simulate a signed-in athlete (harness stub, no app code touched)
  // and re-render so the scenarios below run as they would after sign-in.
  vm.runInContext('authUser={displayName:"Harness Athlete",roles:["athlete"],recoveryEmailVerified:true};render()', ctx);
  return { ctx, app, toast, callbacks, getStored: () => stored };
}

const goalSets = [];
const ids = ['first','run','stations','strength'];
for (let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++) goalSets.push([ids[a],ids[b]]);
for (let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++) for(let c=b+1;c<ids.length;c++) goalSets.push([ids[a],ids[b],ids[c]]);
const divisions = [
  ['women','open','Women Open',102,78,16,10,4],
  ['women','pro','Women Pro',152,103,24,20,6],
  ['men','open','Men Open',152,103,24,20,6],
  ['men','pro','Men Pro',202,153,32,30,9]
];
const levels = ['beginner','intermediate','advanced'];
let profilesRun=0, workoutViews=0;
for (const [gender,division,label,push,pull,farmer,lunge,wall] of divisions) {
  for (const level of levels) for (const goals of goalSets) {
    const {ctx,app}=boot({gender,division,level,goals,run1k:360,ski500:150,row500:140});
    ctx.go('plan');
    assert.equal((app.innerHTML.match(/class="agenda-row/g)||[]).length,5,'All five days should render');
    assert(app.innerHTML.includes(label),`Division label renders: ${label}`);
    assert(app.innerHTML.includes(`${push} kg`) && app.innerHTML.includes(`${pull} kg`),'Official sled standard reference renders');
    for(let day=0;day<5;day++) {
      ctx.openWorkout(day);
      assert(app.innerHTML.includes('WARM UP') && app.innerHTML.includes('COOL DOWN'),'Warm-up and cool-down shown');
      assert(app.innerHTML.includes('MAIN SET') && app.innerHTML.includes('rounds'.toUpperCase()) || day===1,'Main workout prescription shown');
      assert(!/undefined|NaN|\[object Object\]/.test(app.innerHTML),'No broken template values');
      assert(!app.innerHTML.includes('RPE'),'No unexplained RPE jargon');
      if ([0,2,4].includes(day)) assert(app.innerHTML.includes('Achieved total time'),'Run/erg achieved-time picker shown');
      workoutViews++;
    }
    profilesRun++;
  }
}

// Initial onboarding: button choices, multi-select goal count, optional baselines.
const fresh=boot();
assert(fresh.app.innerHTML.includes('ATHLETE SETUP'));
assert(fresh.app.innerHTML.includes('Women') && fresh.app.innerHTML.includes('Men'));
assert(fresh.app.innerHTML.includes('Open') && fresh.app.innerHTML.includes('Pro'));
assert.equal((fresh.app.innerHTML.match(/onclick="toggleGoal\(/g)||[]).length,4);
assert(fresh.app.innerHTML.includes('Choose 2 or 3 goals'));

// Division/level/goal variations and target-time calculations.
const targetTest=boot({gender:'women',division:'open',level:'intermediate',goals:['run','strength'],run1k:360,ski500:180,row500:180,sledEmpty:25});
targetTest.ctx.openWorkout(0);
assert(targetTest.app.innerHTML.includes('3:10 each'),'Run targets derive from baseline and volume');
assert(targetTest.app.innerHTML.includes('Achieved total time'));
targetTest.ctx.openWorkout(1);
assert(targetTest.app.innerHTML.includes('add 40 kg plates'),'Sled target converts total to plates when tare is supplied');
targetTest.ctx.openWorkout(3);
assert(targetTest.app.innerHTML.includes('3 kg ball'),'Wall-ball load is division/experience dependent');

// No benchmark: starter estimate is visible; after a logged time the next target adapts.
const noBase=boot({gender:'men',division:'pro',level:'beginner',goals:['first','stations'],run1k:'',ski500:'',row500:''});
noBase.ctx.openWorkout(0);
assert(noBase.app.innerHTML.includes('STARTER ESTIMATE'));
noBase.ctx.setEntry(0,'1500'); noBase.ctx.setEntry(1,'720'); noBase.ctx.setFeel('easy'); noBase.ctx.saveWorkout(0);
assert(noBase.ctx.localStorage.getItem('hyrox40'));
noBase.ctx.openWorkout(0);
assert(noBase.app.innerHTML.includes('Achieved total time'));
assert.equal(vm.runInContext("state.logs.length",noBase.ctx),1);
assert.equal(vm.runInContext("state.session.checked instanceof Object",noBase.ctx),true,'Completion map persists as an object');

// Validation boundaries.
assert.equal(targetTest.ctx.validateProfile({age:35,weight:75,height:175,level:'beginner',gender:'women',division:'open',goals:['run','first']}),true);
assert.equal(targetTest.ctx.validateProfile({age:35,weight:75,height:175,level:'beginner',gender:'women',division:'open',goals:['run']}),false);

// Timer start/pause/40-minute stop.
const timer=boot({gender:'men',division:'open',level:'intermediate',goals:['run','first']});
timer.ctx.openWorkout(0);timer.ctx.toggleTimer();assert.equal(vm.runInContext('state.session.running',timer.ctx),true);
vm.runInContext('state.session.elapsed=2399',timer.ctx);timer.callbacks.at(-1)();
assert.equal(vm.runInContext('state.session.elapsed',timer.ctx),2400);
assert.equal(vm.runInContext('state.session.running',timer.ctx),false);

// Edge scenario 1: slowest accepted benchmark plus extra run volume is scaled to fit the main-set budget.
const slow=boot({gender:'women',division:'open',level:'beginner',goals:['first','run'],run1k:900,ski500:600,row500:600});
for (const day of [0,2,4]) {
  const seconds=vm.runInContext(`DAYS[${day}].ex.reduce((sum,e,j)=>sum+(['Run','SkiErg','Row'].includes(e[0])?targetInterval(${day},j,e)*intervalCount(${day},e):0),0)+(${day}===4?90*intervalCount(${day},DAYS[${day}].ex[0]):0)`,slow.ctx);
  assert(seconds<=24*60,`Day ${day} target plus station allowance must stay within the 24-minute planned-work budget (28-minute block)`);
  slow.ctx.openWorkout(day);
  assert(slow.app.innerHTML.includes('Achieved total time'));
  const target=vm.runInContext(`targetInterval(${day},0,DAYS[${day}].ex[0])*intervalCount(${day},DAYS[${day}].ex[0])`,slow.ctx);
  const picker=slow.app.innerHTML.match(/<select id="entry0"[\s\S]*?<\/select>/)?.[0]||'';
  assert(picker.includes(`value="${target}"`),`Day ${day} achieved-time picker must contain the target total`);
}

// Edge scenario 2: partial interval times must not be used to make a faster next target.
const partial=boot({gender:'women',division:'open',level:'intermediate',goals:['first','run'],run1k:'',ski500:'',row500:''});
const beforePartial=vm.runInContext('targetInterval(0,0,DAYS[0].ex[0])',partial.ctx);
partial.ctx.openWorkout(0);partial.ctx.setEntry(0,'300');partial.ctx.setFeel('easy');partial.ctx.saveWorkout(0);
const afterPartial=vm.runInContext('targetInterval(0,0,DAYS[0].ex[0])',partial.ctx);
assert.equal(afterPartial,beforePartial,'Unconfirmed/partial work must not progress a target');
const partialLog=vm.runInContext('state.logs.find(l=>l.day===0)',partial.ctx);
assert.equal(partialLog.completed[0],false,'Partial result is persisted as incomplete');
assert(partialLog.distances[0]>0,'Per-rep distance is persisted with the result');

// A completed, explicitly checked time is accepted as a future target source.
const complete=boot({gender:'women',division:'open',level:'intermediate',goals:['first','run'],run1k:'',ski500:'',row500:''});
const starterTarget=vm.runInContext('targetInterval(0,0,DAYS[0].ex[0])',complete.ctx);
complete.ctx.openWorkout(0);complete.ctx.setEntry(0,'600');complete.ctx.toggleCheck(0);complete.ctx.saveWorkout(0);
const completedTarget=vm.runInContext('targetInterval(0,0,DAYS[0].ex[0])',complete.ctx);
assert.notEqual(completedTarget,starterTarget,'A complete, checked result updates its future target');
assert.equal(vm.runInContext('state.logs.find(l=>l.day===0).completed[0]',complete.ctx),true);

// Edge scenario 3: weekend label and preview/save navigation return to the actual next session.
const route=boot({gender:'women',division:'open',level:'intermediate',goals:['first','run']});
assert(route.app.innerHTML.includes('NEXT SESSION · MONDAY'));
route.ctx.openWorkout(4);route.ctx.saveWorkout(4);
const afterPreview=route.app.innerHTML.match(/<p class="hero-desc">([^<]*)/)[1];
assert(afterPreview.includes('500 m run'),'Saving a Friday preview on Sunday returns to Monday’s plan');
assert(!afterPreview.includes('400 m run'),'Friday preview does not leak into Today');

console.log(`PASS: ${profilesRun} profile combinations × 5 workout screens = ${workoutViews} workout render scenarios; onboarding, input validation, target times, load conversion, save/history, and timer boundary checks passed.`);
console.log('FIX VERIFICATION: slow-pace sessions fit; partial entries do not progress targets; weekend and preview navigation return to the correct day.');

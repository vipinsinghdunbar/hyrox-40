'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/timer-engine.js');

function fixture() {
  return T.createSession({ id: 'test-session', segments: [
    { id: 'run', type: 'run', label: 'Run', targetKind: 'distance', targetValue: 500, unit: 'm', targetTimeMs: 120000, plannedRestMs: 5000 },
    { id: 'row', type: 'row', label: 'Row', targetKind: 'distance', targetValue: 250, unit: 'm', plannedRestMs: 0 },
  ] }, 1000);
}

test('session timer begins only on Start and runs from timestamps, including epoch zero', () => {
  let s = fixture();
  assert.equal(T.sessionElapsedMs(s, 4000), 0);
  s = T.startSession(s, 0);
  assert.equal(s.startedAt, 0);
  assert.equal(T.sessionElapsedMs(s, 9500), 9500);
  assert.equal(T.primaryLabel(s, 9500), 'Go');
});

test('segment timer begins on Go, logs on Done, then planned rest counts down and can be skipped', () => {
  let s = T.startSession(fixture(), 1000);
  s = T.startSegment(s, 2000);
  assert.equal(T.segmentElapsedMs(s, 12000), 10000);
  s = T.completeSegment(s, 12000);
  assert.equal(s.segments[0].durationMs, 10000);
  assert.equal(s.phase, T.PHASE.PLANNED_REST);
  assert.equal(T.primaryLabel(s, 15000), 'Skip Rest');
  assert.equal(T.advance(s, 15000), s, 'timer display should not create state transitions before rest expiry');
  const auto = T.advance(s, 17000);
  assert.equal(auto.phase, T.PHASE.READY);
  assert.equal(auto.restEvents[0].endedAt, 17000);
  s = T.skipPlannedRest(s, 13000);
  assert.equal(s.restEvents[0].skipped, true);
  assert.equal(s.restEvents[0].actualMs, 1000);
  assert.equal(s.phase, T.PHASE.READY);
});

test('planned rest automatically finishes at its exact scheduled timestamp', () => {
  let s = T.startSegment(T.startSession(fixture(), 0), 1);
  s = T.completeSegment(s, 101, 500);
  const advanced = T.advance(s, 5101);
  assert.equal(advanced.phase, T.PHASE.READY);
  assert.equal(advanced.restEvents[0].endedAt, 5101);
  assert.equal(advanced.restEvents[0].actualMs, 5000);
});

test('unplanned rest pauses segment elapsed time and resumes the same segment', () => {
  let s = T.startSegment(T.startSession(fixture(), 0), 1000);
  s = T.toggleUnplannedRest(s, 4000);
  assert.equal(T.segmentElapsedMs(s, 10000), 3000);
  assert.equal(T.primaryLabel(s, 10000), 'Resume');
  s = T.toggleUnplannedRest(s, 9000);
  assert.equal(s.phase, T.PHASE.SEGMENT);
  assert.equal(s.segments[0].pausedMs, 5000);
  assert.equal(T.segmentElapsedMs(s, 11000), 5000);
  s = T.completeSegment(s, 12000, 500);
  assert.equal(s.segments[0].durationMs, 6000);
  assert.equal(s.restEvents[0].actualMs, 5000);
});

test('unplanned rest during ready state counts up but does not affect segment time', () => {
  let s = T.startSession(fixture(), 100);
  s = T.toggleUnplannedRest(s, 200);
  s = T.toggleUnplannedRest(s, 3200);
  assert.equal(s.phase, T.PHASE.READY);
  assert.equal(s.restEvents[0].actualMs, 3000);
  assert.equal(T.sessionElapsedMs(s, 3200), 3100);
});

test('force-quit/reopen needs no ticking writes: timestamps reconstruct elapsed time', () => {
  let s = T.startSegment(T.startSession(fixture(), 1000), 2000);
  const persisted = JSON.parse(JSON.stringify(s));
  const reopened = JSON.parse(JSON.stringify(persisted));
  assert.equal(T.segmentElapsedMs(reopened, 62000), 60000);
  assert.equal(T.sessionElapsedMs(reopened, 62000), 61000);
});

test('last segment leads to Finish; Finish tap ends session timer', () => {
  let s = fixture();
  s = T.startSession(s, 100);
  s = T.startSegment(s, 200);
  s = T.completeSegment(s, 400, 500);
  s = T.skipPlannedRest(s, 401);
  s = T.startSegment(s, 500);
  s = T.completeSegment(s, 900, 250);
  assert.equal(s.phase, T.PHASE.FINISH);
  assert.equal(s.segmentIndex, s.segments.length);
  assert.equal(s.endedAt, null);
  assert.equal(T.primaryLabel(s, 900), 'Finish');
  s = T.finishSession(s, 1000);
  assert.equal(s.phase, T.PHASE.FINISHED);
  assert.equal(T.sessionElapsedMs(s, 2000), 900);
  assert.equal(T.sessionSummary(s, 1000).hitPercent, 100);
});

test('discard closes active unplanned rest and marks session discarded', () => {
  let s = T.startSession(fixture(), 0);
  s = T.toggleUnplannedRest(s, 100);
  s = T.discardSession(s, 500);
  assert.equal(s.phase, T.PHASE.DISCARDED);
  assert.equal(s.restEvents[0].actualMs, 400);
  assert.throws(() => T.discardSession(s, 600));
});

test('actual values are scored without inventing a result when no target exists', () => {
  const base = T.createSession({ segments: [
    { id: 'a', targetKind: 'distance', targetValue: 1000 },
    { id: 'b', targetKind: 'distance', targetValue: null },
  ] }, 0);
  let s = T.startSegment(T.startSession(base, 1), 2);
  s = T.completeSegment(s, 3, 1000);
  s = T.startSegment(s, 5);
  s = T.completeSegment(s, 6);
  assert.equal(s.segments[0].result, 'hit');
  assert.equal(s.segments[1].result, 'unscored');
});

test('plan display metadata such as rounds, notes and unprescribed load survives session creation', () => {
  const s = T.createSession({ segments: [{id:'sled',type:'sled_push',targetKind:'distance',targetValue:50,unit:'m',weightKg:null,round:2,rounds:4,note:'Coach review pending'}] }, 0);
  assert.equal(s.segments[0].round, 2);
  assert.equal(s.segments[0].rounds, 4);
  assert.equal(s.segments[0].weightKg, null);
  assert.equal(s.segments[0].note, 'Coach review pending');
});

test('split editing updates time, actual distance, and score', () => {
  let s = T.startSession(fixture(), 10);
  s = T.startSegment(s, 20);
  s = T.completeSegment(s, 100, 400);
  s = T.skipPlannedRest(s, 105);
  s = T.startSegment(s, 106);
  s = T.completeSegment(s, 200, 200);
  const edited = T.editSegmentResult(s, 0, { actualValue: 300, durationMs: 95000 }, 210);
  assert.equal(edited.segments[0].result, 'missed');
  assert.equal(edited.segments[0].durationMs, 95000);
  assert.equal(edited.segments[0].actualDistanceM, 300);
  assert.equal(edited.segments[0].editedAt, 210);
});

test('invalid actions fail loudly and timestamps must be finite', () => {
  assert.throws(() => T.startSession(fixture(), NaN), /timestamp/);
  assert.throws(() => T.completeSegment(fixture(), 10), /not available/);
  assert.throws(() => T.createSession({ segments: [] }, 0), /at least one segment/);
});

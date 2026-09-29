/* HYROX 40 local timer engine. Pure timestamp-based state transitions; no server or dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HyroxTimer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PHASE = Object.freeze({
    IDLE: 'idle',
    READY: 'ready',
    SEGMENT: 'segment-running',
    PLANNED_REST: 'planned-rest',
    UNPLANNED_REST: 'unplanned-rest',
    FINISH: 'ready-to-finish',
    FINISHED: 'finished',
    DISCARDED: 'discarded',
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  function requireFiniteTime(now) {
    if (!Number.isFinite(now)) throw new TypeError('A finite timestamp is required.');
  }
  function assertPhase(session, expected) {
    if (!session || session.phase !== expected) {
      throw new Error(`Action is not available while the session is ${session?.phase || 'missing'}.`);
    }
  }
  function normalizeSegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) throw new Error('A session needs at least one segment.');
    return segments.map((item, index) => ({
      id: String(item.id || `segment-${index + 1}`),
      type: String(item.type || 'custom'),
      label: String(item.label || item.type || `Segment ${index + 1}`),
      targetKind: item.targetKind || null,
      targetValue: Number.isFinite(item.targetValue) ? item.targetValue : null,
      unit: item.unit || '',
      device: item.device || 'none',
      targetTimeMs: Number.isFinite(item.targetTimeMs) ? item.targetTimeMs : null,
      hitTolerance: Number.isFinite(item.hitTolerance) ? item.hitTolerance : 0,
      plannedRestMs: Number.isFinite(item.plannedRestMs) ? Math.max(0, item.plannedRestMs) : 0,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      pausedMs: 0,
      actualValue: null,
      result: null,
    }));
  }

  function createSession({ id, date, planDay, segments, source = 'training' }, now) {
    requireFiniteTime(now);
    return {
      id: id || `session-${now}`,
      date: date || new Date(now).toISOString().slice(0, 10),
      planDay: planDay ?? null,
      source,
      phase: PHASE.IDLE,
      createdAt: now,
      startedAt: null,
      endedAt: null,
      segmentIndex: 0,
      segments: normalizeSegments(segments),
      restEvents: [],
      activeRestIndex: null,
      resumePhase: null,
      revision: 0,
    };
  }

  function bump(session) {
    session.revision = (session.revision || 0) + 1;
    return session;
  }

  function startSession(input, now) {
    requireFiniteTime(now);
    assertPhase(input, PHASE.IDLE);
    const s = clone(input);
    s.startedAt = now;
    s.phase = PHASE.READY;
    return bump(s);
  }

  function startSegment(input, now) {
    requireFiniteTime(now);
    assertPhase(input, PHASE.READY);
    const s = clone(input);
    const segment = s.segments[s.segmentIndex];
    if (!segment) throw new Error('There is no remaining segment to start.');
    segment.startedAt = now;
    segment.endedAt = null;
    segment.durationMs = null;
    segment.pausedMs = 0;
    s.phase = PHASE.SEGMENT;
    return bump(s);
  }

  function segmentElapsedMs(session, now) {
    requireFiniteTime(now);
    const segment = session?.segments?.[session.segmentIndex];
    if (!segment || segment.startedAt == null) return 0;
    if (segment.durationMs != null) return Math.max(0, segment.durationMs);
    const end = session.phase === PHASE.UNPLANNED_REST && session.resumePhase === PHASE.SEGMENT
      ? session.restEvents[session.activeRestIndex]?.startedAt
      : now;
    return Math.max(0, end - segment.startedAt - (segment.pausedMs || 0));
  }

  function sessionElapsedMs(session, now) {
    requireFiniteTime(now);
    if (session?.startedAt == null) return 0;
    return Math.max(0, (session.endedAt ?? now) - session.startedAt);
  }

  function finishOpenRest(session, now) {
    const ev = session.restEvents[session.activeRestIndex];
    if (!ev || ev.endedAt != null) return;
    ev.endedAt = now;
    ev.actualMs = Math.max(0, now - ev.startedAt);
    if (session.resumePhase === PHASE.SEGMENT) {
      const seg = session.segments[session.segmentIndex];
      seg.pausedMs = (seg.pausedMs || 0) + ev.actualMs;
    }
    session.activeRestIndex = null;
  }

  function closePlannedRest(session, now, skipped) {
    const ev = session.restEvents[session.activeRestIndex];
    if (ev && ev.endedAt == null) {
      ev.endedAt = now;
      ev.actualMs = Math.max(0, now - ev.startedAt);
      ev.skipped = Boolean(skipped);
    }
    session.activeRestIndex = null;
    session.phase = PHASE.READY;
    session.resumePhase = null;
  }

  function advance(input, now) {
    requireFiniteTime(now);
    if (input?.phase !== PHASE.PLANNED_REST) return input;
    const active = input.restEvents[input.activeRestIndex];
    if (!active || now < active.endsAt) return input;
    const s = clone(input);
    closePlannedRest(s, active.endsAt, false);
    return bump(s);
  }

  function completeSegment(input, now, actualValue) {
    requireFiniteTime(now);
    assertPhase(input, PHASE.SEGMENT);
    const s = clone(input);
    const seg = s.segments[s.segmentIndex];
    seg.endedAt = now;
    seg.durationMs = segmentElapsedMs(input, now);
    seg.actualValue = Number.isFinite(actualValue) ? actualValue : seg.targetValue;
    seg.result = scoreSegment(seg);
    const hasNext = s.segmentIndex < s.segments.length - 1;
    if (!hasNext) {
      s.segmentIndex = s.segments.length;
      s.phase = PHASE.FINISH;
      return bump(s);
    }
    if (seg.plannedRestMs > 0) {
      const rest = {
        afterSegmentId: seg.id,
        type: 'planned',
        plannedMs: seg.plannedRestMs,
        startedAt: now,
        endsAt: now + seg.plannedRestMs,
        endedAt: null,
        actualMs: null,
        skipped: false,
      };
      s.restEvents.push(rest);
      s.activeRestIndex = s.restEvents.length - 1;
      s.phase = PHASE.PLANNED_REST;
      s.resumePhase = PHASE.READY;
    } else {
      s.phase = PHASE.READY;
    }
    s.segmentIndex += 1;
    return bump(s);
  }

  function skipPlannedRest(input, now) {
    requireFiniteTime(now);
    assertPhase(input, PHASE.PLANNED_REST);
    const s = clone(input);
    closePlannedRest(s, now, true);
    return bump(s);
  }

  function toggleUnplannedRest(input, now) {
    requireFiniteTime(now);
    if (![PHASE.READY, PHASE.SEGMENT, PHASE.UNPLANNED_REST].includes(input?.phase)) {
      throw new Error('An unplanned break is only available during an active session.');
    }
    const s = clone(input);
    if (s.phase === PHASE.UNPLANNED_REST) {
      finishOpenRest(s, now);
      s.phase = s.resumePhase || PHASE.READY;
      s.resumePhase = null;
    } else {
      s.resumePhase = s.phase;
      s.restEvents.push({
        afterSegmentId: s.phase === PHASE.SEGMENT ? s.segments[s.segmentIndex].id : null,
        type: 'unplanned',
        plannedMs: null,
        startedAt: now,
        endsAt: null,
        endedAt: null,
        actualMs: null,
        skipped: false,
      });
      s.activeRestIndex = s.restEvents.length - 1;
      s.phase = PHASE.UNPLANNED_REST;
    }
    return bump(s);
  }

  function editSegmentResult(input, index, patch, now) {
    requireFiniteTime(now);
    if (![PHASE.FINISHED, PHASE.FINISH, PHASE.READY].includes(input?.phase)) throw new Error('Splits can only be edited between segments or after Finish.');
    if (!Number.isInteger(index) || index < 0 || index >= input.segments.length) throw new RangeError('Segment index is out of range.');
    const s = clone(input);
    const segment = s.segments[index];
    if (Object.prototype.hasOwnProperty.call(patch, 'actualValue')) {
      if (patch.actualValue !== null && !Number.isFinite(patch.actualValue)) throw new TypeError('Actual value must be a number.');
      segment.actualValue = patch.actualValue;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'durationMs')) {
      if (patch.durationMs !== null && (!Number.isFinite(patch.durationMs) || patch.durationMs < 0)) throw new TypeError('Split duration must be a non-negative number of milliseconds.');
      segment.durationMs = patch.durationMs;
    }
    segment.result = scoreSegment(segment);
    segment.editedAt = now;
    return bump(s);
  }

  function finishSession(input, now) {
    requireFiniteTime(now);
    assertPhase(input, PHASE.FINISH);
    const s = clone(input);
    s.endedAt = now;
    s.phase = PHASE.FINISHED;
    return bump(s);
  }

  function discardSession(input, now) {
    requireFiniteTime(now);
    if ([PHASE.FINISHED, PHASE.DISCARDED].includes(input?.phase)) throw new Error('This session is already closed.');
    const s = clone(input);
    if (s.phase === PHASE.UNPLANNED_REST) finishOpenRest(s, now);
    if (s.phase === PHASE.PLANNED_REST) closePlannedRest(s, now, true);
    s.endedAt = now;
    s.phase = PHASE.DISCARDED;
    return bump(s);
  }

  function primaryLabel(session, now) {
    const s = session?.phase === PHASE.PLANNED_REST ? advance(session, now) : session;
    switch (s?.phase) {
      case PHASE.IDLE: return 'Start';
      case PHASE.READY: return 'Go';
      case PHASE.SEGMENT: return 'Done';
      case PHASE.PLANNED_REST: return 'Skip Rest';
      case PHASE.UNPLANNED_REST: return 'Resume';
      case PHASE.FINISH: return 'Finish';
      case PHASE.FINISHED: return 'Review';
      case PHASE.DISCARDED: return 'Discarded';
      default: return 'Start';
    }
  }

  function primaryAction(input, now, actualValue) {
    switch (input?.phase) {
      case PHASE.IDLE: return startSession(input, now);
      case PHASE.READY: return startSegment(input, now);
      case PHASE.SEGMENT: return completeSegment(input, now, actualValue);
      case PHASE.PLANNED_REST: return skipPlannedRest(input, now);
      case PHASE.UNPLANNED_REST: return toggleUnplannedRest(input, now);
      case PHASE.FINISH: return finishSession(input, now);
      default: throw new Error('No primary action is available.');
    }
  }

  function scoreSegment(segment) {
    if (!Number.isFinite(segment.actualValue) || !Number.isFinite(segment.targetValue)) return 'unscored';
    const tolerance = Math.max(0, segment.hitTolerance || 0);
    if (segment.targetKind === 'time') {
      return segment.actualValue <= segment.targetValue + tolerance ? 'hit' : 'missed';
    }
    return segment.actualValue >= segment.targetValue - tolerance ? 'hit' : 'missed';
  }

  function sessionSummary(session, now) {
    const s = session.phase === PHASE.PLANNED_REST ? advance(session, now) : session;
    const scored = s.segments.filter(x => x.result === 'hit' || x.result === 'missed');
    const hits = scored.filter(x => x.result === 'hit').length;
    const plannedDistance = s.segments.filter(x => x.targetKind === 'distance').reduce((n, x) => n + (x.targetValue || 0), 0);
    const actualDistance = s.segments.filter(x => x.targetKind === 'distance').reduce((n, x) => n + Math.min(x.targetValue || 0, x.actualValue || 0), 0);
    return {
      durationMs: sessionElapsedMs(s, now),
      hitCount: hits,
      scoredCount: scored.length,
      hitPercent: scored.length ? Math.round(hits / scored.length * 100) : 0,
      plannedDistance,
      actualDistance,
      segmentCount: s.segments.length,
      restEvents: s.restEvents.length,
    };
  }

  return {
    PHASE,
    createSession,
    startSession,
    startSegment,
    completeSegment,
    editSegmentResult,
    skipPlannedRest,
    toggleUnplannedRest,
    finishSession,
    discardSession,
    advance,
    primaryLabel,
    primaryAction,
    segmentElapsedMs,
    sessionElapsedMs,
    scoreSegment,
    sessionSummary,
  };
});

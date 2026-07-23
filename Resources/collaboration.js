(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadCollaboration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function tasksFor(config) {
    const mode = config.mode || 'independent';
    const lead = config.lead === 'claude' ? 'claude' : 'codex';
    const other = lead === 'codex' ? 'claude' : 'codex';
    const rounds = Math.max(1, Math.min(5, Number(config.rounds) || 1));
    const tasks = [];

    if (mode === 'debate') {
      for (let round = 1; round <= rounds; round += 1) {
        tasks.push({ agent: lead, kind: 'debate', round });
        tasks.push({ agent: other, kind: 'debate', round });
      }
      if (config.finalizer === 'codex' || config.finalizer === 'claude') {
        tasks.push({ agent: config.finalizer, kind: 'synthesize', round: rounds + 1 });
      }
    } else if (mode === 'review') {
      tasks.push({ agent: lead, kind: 'draft', round: 0 });
      for (let round = 1; round <= rounds; round += 1) {
        tasks.push({ agent: other, kind: 'critique', round });
        tasks.push({ agent: lead, kind: 'revise', round });
      }
    }
    return tasks;
  }

  // The shared-board protocol deliberately has no provider preference.  The
  // configured (or tagged) lead owns the proposal and final decision; the
  // other provider is the reviewer.  A resolution turn is only needed after
  // an actual disagreement, not as an expensive "I agree" confirmation.
  function rolesFor(lead) {
    const owner = lead === 'claude' ? 'claude' : 'codex';
    return { owner, reviewer: owner === 'codex' ? 'claude' : 'codex' };
  }

  function harnessTasks(lead) {
    const roles = rolesFor(lead);
    return [
      { agent: roles.owner, kind: 'proposal', phase: 'proposal' },
      { agent: roles.reviewer, kind: 'verdict', phase: 'review' },
      { agent: roles.owner, kind: 'resolve', phase: 'resolve', conditional: true },
      { agent: roles.owner, kind: 'decision', phase: 'complete' }
    ];
  }

  function shouldRunResolution(verdict) {
    return verdict === 'disagree' || verdict === 'conditional';
  }

  // A missing orchestration is the normal independent-run state.  Optional
  // chaining with `!==` turns that absence into true, so keep this predicate
  // explicit at the native-process boundary.
  function shouldEnableMcp(orchestration) {
    return !!orchestration && orchestration.mode !== 'independent';
  }

  function requiredBoardField(task) {
    const kind = typeof task === 'string' ? task : task?.kind;
    return ({ proposal: 'proposal', verdict: 'verdict', decision: 'decision' })[kind] || null;
  }

  function boardStageError(task, board) {
    const field = requiredBoardField(task);
    if (!field) return null;
    const value = board?.[field];
    if (field === 'verdict') return ['agree', 'disagree', 'conditional'].includes(value) ? null : '검토자는 shared board에 verdict를 기록해야 합니다.';
    return typeof value === 'string' && value.trim() ? null : `shared board의 ${field} 기록이 필요합니다.`;
  }

  function promptEnvelope(input = {}) {
    const roles = rolesFor(input.lead);
    const task = input.task || {};
    const board = input.board || {};
    const sections = Array.isArray(input.sections) ? input.sections : [];
    const manifest = board.manifest || board;
    return {
      objective: String(input.objective || ''),
      role: task.agent === roles.reviewer ? 'reviewer' : 'owner',
      phase: task.phase || task.kind || 'proposal',
      owner: roles.owner,
      reviewer: roles.reviewer,
      manifest,
      sections,
      // This is intentionally a boolean rather than a transcript field.  It
      // makes the no-transcript contract observable in unit tests.
      includesTranscript: false
    };
  }

  function extractHandoff(text, from) {
    const source = String(text || '');
    const match = source.match(/\[\[TRIAD_HANDOFF\]\]\s*([\s\S]*?)\s*\[\[\/TRIAD_HANDOFF\]\]/u);
    if (!match) return { text: source, handoff: null, error: null };
    const cleaned = `${source.slice(0, match.index)}${source.slice(match.index + match[0].length)}`.trim();
    try {
      const value = JSON.parse(match[1]);
      const expected = from === 'codex' ? 'claude' : 'codex';
      if (value?.to !== expected) return { text: cleaned, handoff: null, error: `인계 대상은 ${expected}여야 합니다.` };
      if (typeof value.question !== 'string' || !value.question.trim()) return { text: cleaned, handoff: null, error: '인계 질문이 비어 있습니다.' };
      return {
        text: cleaned,
        handoff: { to: expected, question: value.question.trim(), reason: typeof value.reason === 'string' ? value.reason.trim() : '' },
        error: null
      };
    } catch (error) {
      return { text: cleaned, handoff: null, error: `인계 JSON 해석 실패: ${error.message}` };
    }
  }

  return { tasksFor, rolesFor, harnessTasks, shouldRunResolution, shouldEnableMcp, requiredBoardField, boardStageError, promptEnvelope, extractHandoff };
});

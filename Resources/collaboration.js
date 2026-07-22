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

  return { tasksFor, extractHandoff };
});

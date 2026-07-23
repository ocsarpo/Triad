(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadSessionBudget = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AGENTS = ['codex', 'claude'];
  const DEFAULT_POLICY = { sessionPolicy: 'auto', sessionTurnLimit: 6, sessionTokenLimit: 48000 };

  function estimateTokens(value) {
    const text = String(value || '');
    if (!text) return 0;
    let ascii = 0;
    let nonAscii = 0;
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code <= 0x7f) ascii += 1;
      else nonAscii += 1;
    }
    // Korean/CJK usually consumes more than the simple UTF-8-bytes/4 rule.
    // Keep ASCII at roughly four characters per token, but count each
    // non-ASCII code point conservatively as one token (including emoji).
    return Math.ceil(ascii / 4) + nonAscii;
  }

  function numberAt(source, keys) {
    for (const key of keys) {
      const value = Number(source?.[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    return 0;
  }

  function logicalInputTokens(agent, usage) {
    const input = numberAt(usage, ['input_tokens', 'inputTokens']);
    if (agent === 'claude') {
      return input
        + numberAt(usage, ['cache_read_input_tokens', 'cacheReadInputTokens'])
        + numberAt(usage, ['cache_creation_input_tokens', 'cacheCreationInputTokens']);
    }
    return input;
  }

  function outputTokens(usage) { return numberAt(usage, ['output_tokens', 'outputTokens']); }
  function clamp(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
  }
  function normalizePolicy(value = {}) {
    return {
      sessionPolicy: ['auto', 'continue', 'alwaysNew'].includes(value.sessionPolicy) ? value.sessionPolicy : DEFAULT_POLICY.sessionPolicy,
      sessionTurnLimit: clamp(value.sessionTurnLimit, DEFAULT_POLICY.sessionTurnLimit, 2, 50),
      sessionTokenLimit: clamp(value.sessionTokenLimit, DEFAULT_POLICY.sessionTokenLimit, 8000, 500000)
    };
  }
  function blankAgentStats(value = {}, options = {}) {
    const hasMeasuredUsage = Number(value.turns) > 0
      || Number(value.sessionInputTokens) > 0
      || Number(value.lastInputTokens) > 0
      || Number(value.lastOutputTokens) > 0;
    // v0.40 introduced per-session accounting after existing CLI session IDs
    // had already been persisted.  Treat an unmarked zero-usage resumed
    // session as unknown rather than as a cheap, empty session: auto policy
    // must rotate it once before using it again.
    const requiresFreshSession = typeof value.requiresFreshSession === 'boolean'
      ? value.requiresFreshSession
      : !!options.hasResumeSession && !hasMeasuredUsage;
    return {
      turns: Math.max(0, Number(value.turns) || 0),
      sessionInputTokens: Math.max(0, Number(value.sessionInputTokens) || 0),
      lastInputTokens: Math.max(0, Number(value.lastInputTokens) || 0),
      lastOutputTokens: Math.max(0, Number(value.lastOutputTokens) || 0),
      sessionId: typeof value.sessionId === 'string' && value.sessionId ? value.sessionId : null,
      rotations: Math.max(0, Number(value.rotations) || 0),
      requiresFreshSession
    };
  }
  function normalizeStats(value = {}, sessions = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const resumed = sessions && typeof sessions === 'object' ? sessions : {};
    return Object.fromEntries(AGENTS.map(agent => {
      const current = source[agent] || {};
      return [agent, blankAgentStats(current, {
        hasResumeSession: typeof resumed[agent] === 'string' && resumed[agent]
          || typeof current.sessionId === 'string' && current.sessionId
      })];
    }));
  }
  function recordUsage(stats, agent, usage, options = {}) {
    const next = normalizeStats(stats);
    if (!AGENTS.includes(agent)) return next;
    const current = next[agent];
    const input = logicalInputTokens(agent, usage);
    const output = outputTokens(usage);
    const replaceLast = options.replaceLast === true && current.turns > 0;
    if (replaceLast) current.sessionInputTokens = Math.max(0, current.sessionInputTokens - current.lastInputTokens) + input;
    else { current.turns += 1; current.sessionInputTokens += input; }
    current.lastInputTokens = input;
    current.lastOutputTokens = output;
    current.requiresFreshSession = false;
    if (typeof options.sessionId === 'string' && options.sessionId) current.sessionId = options.sessionId;
    return next;
  }
  function recordCompletion(stats, agent, options = {}) {
    return recordUsage(stats, agent, {}, options);
  }
  function resetAgent(stats, agent, options = {}) {
    const next = normalizeStats(stats);
    if (!AGENTS.includes(agent)) return next;
    const rotations = next[agent].rotations + (options.incrementRotation ? 1 : 0);
    next[agent] = blankAgentStats({ rotations, requiresFreshSession: false });
    return next;
  }
  function shouldRotate(policy, stats, hasResumeSession) {
    const normalized = normalizePolicy(policy);
    const current = blankAgentStats(stats);
    return normalized.sessionPolicy === 'auto' && !!hasResumeSession
      && (current.requiresFreshSession || current.turns >= normalized.sessionTurnLimit || current.sessionInputTokens >= normalized.sessionTokenLimit);
  }
  return { estimateTokens, logicalInputTokens, outputTokens, normalizePolicy, normalizeStats, recordUsage, recordCompletion, resetAgent, shouldRotate, DEFAULT_POLICY };
});

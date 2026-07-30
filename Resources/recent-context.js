(function (root) {
  const REQUEST_LIMIT = 900;
  const RESPONSE_LIMIT = 1900;
  // Older turns are compressed harder than the newest one so a multi-turn
  // packet stays a hint, not a transcript.
  const OLDER_REQUEST_LIMIT = 400;
  const OLDER_RESPONSE_LIMIT = 700;
  const MAX_TURNS = 6;
  const TOTAL_LIMIT = 9000;

  function clip(text, limit) {
    const value = String(text || '').trim();
    if (value.length <= limit) return value;
    const marker = '\n…(중략)…\n';
    const available = Math.max(0, limit - marker.length);
    const head = Math.ceil(available * 0.42);
    return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`;
  }

  // Walk backwards collecting this agent's own (request → response) exchanges,
  // newest first.  Answers from the other agent never enter the packet, and a
  // user request is only paired with the response that directly followed it —
  // requests aimed at the other agent stay out.
  function collectTurns(messages, agent, maxTurns) {
    const list = Array.isArray(messages) ? messages : [];
    const turns = [];
    let searchEnd = list.length;
    while (turns.length < maxTurns && searchEnd > 0) {
      let responseIndex = -1;
      for (let index = searchEnd - 1; index >= 0; index--) {
        if (list[index]?.author === agent) { responseIndex = index; break; }
      }
      if (responseIndex < 0) break;
      const response = String(list[responseIndex]?.text || '').trim();
      let requestIndex = -1;
      for (let index = responseIndex - 1; index >= 0; index--) {
        if (list[index]?.author === 'user') { requestIndex = index; break; }
      }
      const request = requestIndex >= 0 ? String(list[requestIndex]?.text || '').trim() : '';
      if (response || request) turns.push({ request, response });
      if (requestIndex < 0) break;
      searchEnd = requestIndex;
    }
    return turns; // newest first
  }

  // A deliberately compact continuation hint injected only when a fresh/rotated
  // CLI session would otherwise start blind.  It carries the most recent turns
  // (not just one) so context does not collapse at a rotation boundary, while
  // the newest turn keeps the most room and older turns are trimmed under a
  // total budget.
  function packetFor(messages, agent, options = {}) {
    const maxTurns = Math.max(1, Number(options.maxTurns) || MAX_TURNS);
    const requestLimit = Number(options.requestLimit) || REQUEST_LIMIT;
    const responseLimit = Number(options.responseLimit) || RESPONSE_LIMIT;
    const olderRequestLimit = Number(options.olderRequestLimit) || OLDER_REQUEST_LIMIT;
    const olderResponseLimit = Number(options.olderResponseLimit) || OLDER_RESPONSE_LIMIT;
    const totalLimit = Number(options.totalLimit) || TOTAL_LIMIT;

    const collected = collectTurns(messages, agent, maxTurns); // newest first
    if (!collected.length) return '';

    let budget = totalLimit;
    const kept = [];
    for (let order = 0; order < collected.length; order++) {
      const turn = collected[order];
      const reqLimit = order === 0 ? requestLimit : olderRequestLimit;
      const resLimit = order === 0 ? responseLimit : olderResponseLimit;
      const request = turn.request ? clip(turn.request, reqLimit) : '';
      const response = turn.response ? clip(turn.response, resLimit) : '';
      const cost = request.length + response.length;
      // Always keep the newest turn; stop once older turns exceed the budget so
      // the kept window stays contiguous and most-recent.
      if (kept.length && cost > budget) break;
      budget -= cost;
      kept.push({ request, response });
    }

    kept.reverse(); // chronological: oldest → newest
    const multi = kept.length > 1;
    const blocks = kept.map((turn, index) => {
      const tag = multi ? `${index + 1}) ` : '';
      const parts = [];
      if (turn.request) parts.push(`[${tag}이전 사용자 요청]\n${turn.request}`);
      if (turn.response) parts.push(`[${tag}${agent}의 답변]\n${turn.response}`);
      return parts.join('\n\n');
    });
    const header = multi ? `최근 ${kept.length}턴 대화(오래된 순):\n\n` : '';
    return header + blocks.join('\n\n');
  }

  // 방 따라잡기(cross-agent catch-up): 태그된 메시지는 그 슬롯 세션에만 들어가므로
  // 상대 AI의 답변은 이 에이전트의 어떤 세션에도 존재하지 않는다.  "A가 얘기한
  // 대로 해줘" 같은 연결을 위해, 이 에이전트의 마지막 발언 이후에 나온 상대
  // 답변(사용자에게 보인 그 질문 포함)을 압축해 넘긴다.  이 에이전트가 한 번
  // 답하고 나면 그 이전 상대 답변은 다시 실리지 않아 중복 누적이 없다.
  const CROSS_RESPONSE_LIMIT = 1700;
  const CROSS_REQUEST_LIMIT = 350;
  const CROSS_MAX_ANSWERS = 2;
  function crossAgentPacket(messages, agent, names = {}) {
    const list = Array.isArray(messages) ? messages : [];
    let ownLast = -1;
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index]?.author === agent) { ownLast = index; break; }
    }
    const other = agent === 'codex' ? 'claude' : 'codex';
    const picked = [];
    for (let index = list.length - 1; index > ownLast && picked.length < CROSS_MAX_ANSWERS; index--) {
      const message = list[index];
      if (message?.author !== other) continue;
      const response = String(message.text || '').trim();
      if (!response) continue;
      let request = '';
      for (let back = index - 1; back > ownLast; back--) {
        if (list[back]?.author === 'user') { request = String(list[back].text || '').trim(); break; }
      }
      picked.push({ request, response });
    }
    if (!picked.length) return '';
    picked.reverse(); // chronological
    const label = names[other] || other;
    const blocks = picked.map(turn => {
      const parts = [];
      if (turn.request) parts.push(`[사용자 → ${label}]\n${clip(turn.request, CROSS_REQUEST_LIMIT)}`);
      parts.push(`[${label}의 답변]\n${clip(turn.response, CROSS_RESPONSE_LIMIT)}`);
      return parts.join('\n\n');
    });
    return blocks.join('\n\n');
  }

  const api = {
    clip, packetFor, collectTurns, crossAgentPacket,
    REQUEST_LIMIT, RESPONSE_LIMIT, OLDER_REQUEST_LIMIT, OLDER_RESPONSE_LIMIT, MAX_TURNS, TOTAL_LIMIT,
    CROSS_RESPONSE_LIMIT, CROSS_REQUEST_LIMIT, CROSS_MAX_ANSWERS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TriadRecentContext = api;
})(typeof window !== 'undefined' ? window : globalThis);
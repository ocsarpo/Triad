(function (root) {
  const REQUEST_LIMIT = 900;
  const RESPONSE_LIMIT = 1900;

  function clip(text, limit) {
    const value = String(text || '').trim();
    if (value.length <= limit) return value;
    const marker = '\n…(중략)…\n';
    const available = Math.max(0, limit - marker.length);
    const head = Math.ceil(available * 0.42);
    return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`;
  }

  // This is deliberately a tiny continuation hint, not a transcript.  Find
  // the latest response from the called agent and only the user request that
  // preceded it; answers from the other agent never enter this packet.
  function packetFor(messages, agent, options = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const responseIndex = [...list].map(item => item?.author).lastIndexOf(agent);
    if (responseIndex < 0) return '';
    const response = String(list[responseIndex]?.text || '').trim();
    if (!response) return '';
    let request = '';
    for (let index = responseIndex - 1; index >= 0; index--) {
      if (list[index]?.author === 'user') { request = String(list[index]?.text || '').trim(); break; }
    }
    const requestLimit = Number(options.requestLimit) || REQUEST_LIMIT;
    const responseLimit = Number(options.responseLimit) || RESPONSE_LIMIT;
    const parts = [];
    if (request) parts.push(`[이전 사용자 요청]\n${clip(request, requestLimit)}`);
    parts.push(`[${agent}의 직전 답변]\n${clip(response, responseLimit)}`);
    return parts.join('\n\n');
  }

  const api = { clip, packetFor, REQUEST_LIMIT, RESPONSE_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TriadRecentContext = api;
})(typeof window !== 'undefined' ? window : globalThis);

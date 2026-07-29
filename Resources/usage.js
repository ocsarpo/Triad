(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadUsage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

  function windowLabel(duration, hint = '', lang = 'ko') {
    const en = lang === 'en';
    const normalized = String(hint).toLowerCase();
    if (normalized.includes('five') || normalized.includes('5h')) return en ? '5h' : '5시간';
    if (normalized.includes('seven') || normalized.includes('7d') || normalized.includes('week')) return en ? 'Weekly' : '주간';
    if (duration && duration <= 360) return en ? `${Math.round(duration / 60)}h` : `${Math.round(duration / 60)}시간`;
    if (duration && duration >= 9000) return en ? 'Weekly' : '주간';
    return duration ? (en ? `${duration}m` : `${duration}분`) : (en ? 'Limit' : '한도');
  }

  function normalizeCodex(payload, lang = 'ko') {
    const buckets = payload?.rateLimitsByLimitId;
    const snapshot = buckets?.codex || (buckets && Object.values(buckets)[0]) || payload?.rateLimits || payload;
    const windows = [];
    for (const [key, value] of [['primary', snapshot?.primary], ['secondary', snapshot?.secondary]]) {
      if (!value || typeof value.usedPercent !== 'number') continue;
      windows.push({
        label: windowLabel(value.windowDurationMins, key, lang),
        usedPercent: clamp(value.usedPercent),
        remainingPercent: clamp(100 - value.usedPercent),
        resetsAt: value.resetsAt || null
      });
    }
    return { windows, credits: snapshot?.credits || null, planType: snapshot?.planType || null };
  }

  function normalizeClaude(payload, lang = 'ko') {
    const windows = [];
    const seen = new Set();
    function visit(value, hint = '') {
      if (!value || typeof value !== 'object') return;
      const rawUsed = value.used_percentage ?? value.usedPercent ?? value.utilization;
      const rawRemaining = value.remaining_percentage ?? value.remainingPercent ?? value.remaining;
      const numericUsed = rawUsed === '' || rawUsed == null ? NaN : Number(rawUsed);
      const numericRemaining = rawRemaining === '' || rawRemaining == null ? NaN : Number(rawRemaining);
      if (Number.isFinite(numericUsed) || Number.isFinite(numericRemaining)) {
        const normalizedRemaining = Number.isFinite(numericRemaining) ? (numericRemaining <= 1 ? numericRemaining * 100 : numericRemaining) : null;
        const used = Number.isFinite(numericUsed) ? (numericUsed <= 1 ? numericUsed * 100 : numericUsed) : 100 - normalizedRemaining;
        const resetsAt = value.resets_at ?? value.resetsAt ?? value.reset_at ?? null;
        const label = windowLabel(value.window_duration_mins ?? value.windowDurationMins, value.rate_limit_type ?? value.rateLimitType ?? hint, lang);
        const signature = `${label}:${resetsAt || ''}`;
        if (!seen.has(signature)) {
          seen.add(signature);
          windows.push({ label, usedPercent: clamp(used), remainingPercent: clamp(100 - used), resetsAt });
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') visit(child, key);
      }
    }
    visit(payload);
    return { windows: windows.slice(0, 3), status: payload?.status || null };
  }

  function formatReset(value, now = Date.now(), lang = 'ko') {
    if (!value) return '';
    const en = lang === 'en';
    const timestamp = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    const minutes = Math.max(0, Math.ceil((timestamp - now) / 60000));
    if (minutes < 60) return en ? `in ${minutes}m` : `${minutes}분 후`;
    if (minutes < 1440) return en ? `in ${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후`;
    return new Date(timestamp).toLocaleString(en ? 'en-US' : 'ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function summary(usage, now = Date.now(), lang = 'ko') {
    const en = lang === 'en';
    if (!usage?.windows?.length) return en ? 'No usage data' : '잔여량 정보 없음';
    return usage.windows.slice(0, 2).map(window => en ? `${window.label} ${window.remainingPercent}% left` : `${window.label} ${window.remainingPercent}% 남음`).join(' · ');
  }

  return { normalizeCodex, normalizeClaude, formatReset, summary };
});

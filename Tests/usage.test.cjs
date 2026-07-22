const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Resources/usage.js'), 'utf8'), context);
const usage = context.TriadUsage;
const plain = value => JSON.parse(JSON.stringify(value));

test('Codex 사용률을 남은 비율로 변환한다', () => {
  const result = usage.normalizeCodex({ rateLimits: {
    primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 2000000000 },
    secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 2000001000 }
  }});
  assert.deepEqual(plain(result.windows), [
    { label: '5시간', usedPercent: 28, remainingPercent: 72, resetsAt: 2000000000 },
    { label: '주간', usedPercent: 61, remainingPercent: 39, resetsAt: 2000001000 }
  ]);
});

test('Claude 소수 utilization과 중첩 한도 창을 처리한다', () => {
  const result = usage.normalizeClaude({ five_hour: { utilization: 0.36, resets_at: '2030-01-01T00:00:00Z' }, seven_day: { used_percentage: 70, resets_at: '2030-01-07T00:00:00Z' } });
  assert.deepEqual(plain(result.windows), [
    { label: '5시간', usedPercent: 36, remainingPercent: 64, resetsAt: '2030-01-01T00:00:00Z' },
    { label: '주간', usedPercent: 70, remainingPercent: 30, resetsAt: '2030-01-07T00:00:00Z' }
  ]);
});

test('사용량 요약은 두 창의 남은 비율을 표시한다', () => {
  assert.equal(usage.summary({ windows: [{ label: '5시간', remainingPercent: 72 }, { label: '주간', remainingPercent: 39 }] }), '5시간 72% 남음 · 주간 39% 남음');
});

test('요청 토큰 fallback을 잔여량으로 표시하지 않는다', () => {
  assert.equal(usage.summary({ windows: [], fallback: '이번 요청 12,345 토큰' }), '잔여량 정보 없음');
});

test('Claude remaining 비율과 숫자 문자열을 잔여량으로 처리한다', () => {
  const normalized = usage.normalizeClaude({ rateLimitType: 'five_hour', remaining_percentage: '0.72' });
  assert.equal(normalized.windows[0].remainingPercent, 72);
  assert.equal(normalized.windows[0].usedPercent, 28);
});

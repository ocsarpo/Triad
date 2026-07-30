const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

// Prompt-prefix caching only holds when the byte-stable content forms a
// contiguous prefix and the per-turn volatile board delta comes last.  These
// guard against a future edit silently moving the board snapshot ahead of the
// stable objective/role/policy text (which would break caching every turn).

test('buildCollaborationPrompt은 안정 콘텐츠를 volatile 보드 스냅샷 앞에 둔다', () => {
  const block = renderer.slice(
    renderer.indexOf('function buildCollaborationPrompt'),
    renderer.indexOf('function agentHandoffProtocol')
  );
  assert.ok(block.indexOf('사용자 의제') >= 0 && block.indexOf('공유 보드 스냅샷') >= 0);
  assert.ok(block.indexOf('사용자 의제') < block.indexOf('공유 보드 단계'), '의제는 보드 단계보다 앞');
  assert.ok(block.indexOf('공유 보드는 프로젝트가 아니라') < block.indexOf('공유 보드 스냅샷'), '정책 문구는 스냅샷보다 앞');
  // 재개 턴이면 불변 정책 문단을 생략(첫 턴 히스토리에 이미 있음) — 의제·역할은 유지
  assert.match(block, /const policy=resuming\?'':/);
  // 빈 보드면 스냅샷 블록 생략
  assert.match(block, /const snapshot=packet\?/);
});

test('buildAgentPrompt은 안정 콘텐츠를 volatile 보드 스냅샷 앞에 둔다', () => {
  const block = renderer.slice(
    renderer.indexOf('function buildAgentPrompt'),
    renderer.indexOf('function runAgentTurn')
  );
  assert.ok(block.indexOf('사용자의 원래 작업') >= 0 && block.indexOf('공유 보드 스냅샷') >= 0);
  // 스냅샷은 별도 const로 준비되지만, 최종 프롬프트 템플릿에서는 안정 콘텐츠
  // (작업·역할·정책) 뒤에 ${snapshot}으로 삽입되어야 캐시 prefix가 유지된다.
  assert.match(block, /사용자의 원래 작업:[^`]*전체 채팅 기록은 제공되지 않습니다[^`]*\$\{snapshot\}/);
  // 빈 보드면 스냅샷 블록 대신 짧은 안내 한 줄
  assert.match(block, /const snapshot=boardIndex\?/);
});

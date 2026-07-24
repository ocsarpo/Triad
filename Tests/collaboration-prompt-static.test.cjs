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
});

test('buildAgentPrompt은 안정 콘텐츠를 volatile 보드 스냅샷 앞에 둔다', () => {
  const block = renderer.slice(
    renderer.indexOf('function buildAgentPrompt'),
    renderer.indexOf('function runAgentTurn')
  );
  assert.ok(block.indexOf('사용자의 원래 작업') >= 0 && block.indexOf('공유 보드 스냅샷') >= 0);
  assert.ok(block.indexOf('사용자의 원래 작업') < block.indexOf('공유 보드 스냅샷'), '작업은 스냅샷보다 앞');
  assert.ok(block.indexOf('전체 채팅 기록은 제공되지 않습니다') < block.indexOf('공유 보드 스냅샷'), '정책 문구는 스냅샷보다 앞');
});

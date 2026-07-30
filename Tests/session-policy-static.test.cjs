const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('렌더러는 세션 정책(회전 없음)·대화별 stats migration을 포함한다', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  // 자동 회전 제거: 기본은 '계속 유지', 한도 설정·회전 분기·레거시 마이그레이션 없음
  assert.match(renderer, /sessionPolicy:'continue'/);
  assert.doesNotMatch(renderer, /sessionTurnLimit|sessionTokenLimit/);
  assert.doesNotMatch(renderer, /shouldRotate/);
  assert.doesNotMatch(renderer, /liftLegacySessionDefaults/);
  assert.doesNotMatch(renderer, /자동 회전 ·/);
  // '항상 새 세션' 정책과 수동 초기화만 세션을 리셋
  assert.match(renderer, /config\.sessionPolicy==='alwaysNew'/);
  assert.match(renderer, /'정책: 항상 새 세션'/);
  assert.match(renderer, /\.reset-session/);
  assert.match(renderer, /collaboration: \{mode:'independent',lead:'codex',rounds:2/);
  // 통계는 표시용으로 유지
  assert.match(renderer, /const contextInput=Math\.round\(\(stats\.lastInputTokens\|\|0\)\/1000\)/);
  assert.match(renderer, /L\('sessionSummary',\{policy,turns:stats\.turns\|\|0,total:totalInput,context:contextInput,fresh\}\)/);
  assert.match(renderer, /function ensureAgentSessionStats\(agent\)/);
  assert.match(renderer, /const stats=ensureAgentSessionStats\(agent\)/); // 슬롯 키 (provider 분리)
  assert.match(renderer, /sessionStats:clone\(state\.sessionStats\)/);
  assert.match(renderer, /normalizeSessionStats\(conversation\.sessionStats\|\|\{\}\)/);
  assert.match(renderer, /normalizeStats\(value\)/);
  assert.match(renderer, /recordCompletion\(state\.sessionStats,agent/);
  assert.match(renderer, /addTrace\('system','error','전송 준비 실패',detail\)/);
  assert.match(renderer, /공유 문서를 준비하지 못했습니다/);
});

test('문맥 한도 에러는 무차별 회전 대신 새 세션 자동 재시도로 처리한다 (headless 압축 실패 안전망)', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
  assert.match(renderer, /function scheduleContextLimitRetry\(agent, message\)/);
  assert.match(renderer, /prompt is too long\|too many tokens\|context \(\?:window\|length\|limit\)/);
  // claude(is_error)와 codex(error 이벤트) 양쪽에 배선
  assert.match(renderer, /else if \(scheduleContextLimitRetry\(agent,message\)\)/);
  assert.match(renderer, /scheduleContextLimitRetry\(agent,codexErr\)/);
  // isolated(협업) 세션은 flow store를, 채팅은 state.sessions를 리셋
  assert.match(renderer, /if\(p\.isolated\)\{if\(p\.sessionStore\)p\.sessionStore\[agent\]=null;\}/);
  // 재시도 트레이스가 사유를 구분
  assert.match(renderer, /pending\.retryReason==='context'\?'문맥 한도 초과, 새 세션으로 자동 재시도'/);
});

test('README은 세션 유지 정책과 과금 추정의 차이를 명시한다', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  assert.match(readme, /자동 회전\(턴·토큰 한도\) 정책은 제거되었습니다/);
  assert.match(readme, /CLI가 스스로 문맥을 압축·관리/);
  assert.match(readme, /전송 미리보기의 토큰 수는 UTF-8 문자 특성을 반영한 보수적 \*\*추정치\*\*/);
  assert.match(readme, /세션의 현재 문맥·누적 입력은 CLI 사용량 이벤트 기반 논리 토큰/);
  assert.match(readme, /실제 청구 토큰 또는 과금액과는 다를 수 있습니다/);
});

test('패키저는 세션 예산 모듈을 앱 리소스로 복사한다', () => {
  const packager = fs.readFileSync(path.join(__dirname, '../scripts/package-app.sh'), 'utf8');
  assert.match(packager, /Resources\/session-budget\.js/);
});

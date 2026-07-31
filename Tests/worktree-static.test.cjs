const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');

test('runAgent는 async로 격리 스왑을 기다린 뒤 spawn한다', () => {
  assert.match(main, /async function runAgent\(/);
  assert.match(main, /await worktree\.ensureIsolation\(/);
  // 스왑은 workspace 읽기(config.workspacePath → workspace)보다 앞서야 한다
  assert.ok(main.indexOf('await worktree.ensureIsolation(') < main.indexOf("stringOrDefault(config.workspacePath"));
  // await 후 슬롯 busy 재확인 (async 재진입 방어)
  const after = main.slice(main.indexOf('await worktree.ensureIsolation('));
  assert.match(after, /running\.has\(slotId\)/);
});

test('격리 노트는 이미지 프롬프트 재조립 이후에 덧붙는다', () => {
  assert.ok(main.indexOf('promptToSend += isolationNote') > main.indexOf('[첨부 이미지]'));
});

test('worktreeAdopt/worktreeDiscard 액션과 대화 삭제 정리·부팅 GC가 배선돼 있다', () => {
  assert.match(main, /case 'worktreeAdopt': return void worktreeAdoptAction\(payload\);/);
  assert.match(main, /case 'worktreeDiscard': return void worktreeDiscardAction\(payload\);/);
  assert.match(main, /case 'deleteConversation': void worktree\.cleanupConversation\(/);
  assert.match(main, /worktree\.configure\(\{ userDataDir: app\.getPath\('userData'\), gitBin: platform\.gitBin\(\) \}\)/);
  assert.match(main, /void worktree\.gcOrphans\(\)/);
});

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');

test('렌더러가 worktree 이벤트 5종을 처리하고 diff 요청이 워크트리 경로를 우선한다', () => {
  for (const type of ['worktreeState', 'worktreeWarning', 'worktreeAdoptResult', 'worktreeDiscardResult', 'worktreeError']) {
    assert.match(renderer, new RegExp(`event\\.type==='${type}'`));
  }
  assert.match(renderer, /activeWorktree\(agent\)/);
  assert.match(renderer, /wt\?\.path\|\|effectiveWorkspacePath\(agent\)/);
});

test('채택/폐기 버튼이 confirm 후 IPC로 나가고 실행 중엔 비활성화된다', () => {
  assert.match(renderer, /action:'worktreeAdopt'/);
  assert.match(renderer, /action:'worktreeDiscard'/);
  assert.match(renderer, /id="wt-adopt"/);
  assert.match(renderer, /id="wt-discard"/);
  assert.match(renderer, /wt-adopt'\)\.disabled=busy/);
});

test('격리 중엔 workspaceContextLine이 워크트리 상황을 설명하고 슬롯 배지가 있다', () => {
  assert.match(renderer, /서로 다른 격리 워크트리/);
  assert.match(renderer, /id="wt-codex"/);
  assert.match(renderer, /id="wt-claude"/);
});
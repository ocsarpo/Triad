const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '../Resources/index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '../electron/lib/auth.js'), 'utf8');

test('슬롯은 provider로 어떤 CLI를 돌릴지 분리한다 (멀티세션)', () => {
  assert.match(renderer, /provider:'codex'/);
  assert.match(renderer, /provider:'claude'/);
  assert.match(renderer, /const providerOf = agent => \(state\.settings\?\.\[agent\]\?\.provider\) \|\| agent/);
  assert.match(renderer, /function applyProvider\(agent, provider\)/);
  // 기본 병합으로 pre-provider 저장 상태가 자동 마이그레이션
  assert.match(renderer, /\{ \.\.\.providerDefaults\(\)\.codex, \.\.\.slotPrefs\(home\) \}/);
});

test('표시 이름은 provider 기반, 두 슬롯이 같은 provider면 A/B 접미사', () => {
  assert.match(renderer, /function recomputeNames\(\)/);
  assert.match(renderer, /same=pc===pp/);
  assert.match(renderer, /names\.codex = providerName\(pc\)\+\(same\?/);
});

test('설정에 슬롯별 provider 선택 + 프리셋이 있다', () => {
  assert.match(renderer, /class="provider-select" data-provider-slot="\$\{agent\}"/);
  assert.match(renderer, /data-preset="codex:claude"/);
  assert.match(renderer, /data-preset="claude:claude"/);
  assert.match(renderer, /data-preset="codex:codex"/);
  // 프리셋은 두 슬롯 provider를 세팅
  assert.match(renderer, /const\[p1,p2\]=b\.dataset\.preset\.split\(':'\);applyProvider\('codex',p1\);applyProvider\('claude',p2\)/);
  // 설정 카드 분기는 slot id가 아니라 provider 기준
  assert.match(renderer, /const provider=providerOf\(agent\)/);
  assert.match(renderer, /const permissionOptions=provider==='codex'/);
  assert.match(renderer, /const discovered=providerOf\(agent\)==='codex'/);
});

test('슬롯 라벨(핀·알약·필터·폴더)이 provider 이름을 따라간다', () => {
  assert.match(renderer, /function syncSlotLabels\(\)/);
  assert.match(renderer, /set\('#pill-codex strong',names\.codex\)/);
  assert.match(renderer, /if\(t==='codex'\)\{b\.textContent=L\('pinLabel',\{name:names\.codex\}\)/);
  assert.match(renderer, /set\('\[data-trace-filter="codex"\]',names\.codex\)/);
  // recomputeNames가 라벨 동기화까지 호출
  assert.match(renderer, /names\.claude = providerName\(pp\)[\s\S]{0,80}syncSlotLabels\(\)/);
});

test('사용량(코덱스 계정 기능)은 codex provider 슬롯이 있을 때만 조회한다', () => {
  assert.match(renderer, /const codexSlot=agents\.find\(a=>providerOf\(a\)==='codex'\)/);
  assert.match(renderer, /if\(!codexSlot\)\{renderUsage\(\);return;\}/);
  assert.match(renderer, /if\(providerOf\(agent\)!=='codex'\)\{element\.textContent='';/);
  assert.match(renderer, /if\(providerOf\(agent\)==='codex'&&!failed\)refreshUsage\(true\)/);
});

test('provider 전환 시 그 슬롯의 세션을 리셋한다 (교차-provider 세션 오염 방지)', () => {
  assert.match(renderer, /if\(state\.sessions\)state\.sessions\[agent\]=null/);
  assert.match(renderer, /if\(providerOf\(agent\)===provider\)return;/);
});

test('실행/인증은 slot이 아니라 provider 기준으로 CLI를 고른다', () => {
  assert.match(main, /const provider = \(config && util\.stringOrNil\(config\.provider\)\) \|\| agent/);
  assert.match(main, /if \(provider === 'codex'\) \{/);
  assert.match(auth, /const provider = util\.stringOrNil\(config\.provider\) \|\| agent/);
  assert.match(auth, /const args = argsFor\(provider, operation\)/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const renderer=fs.readFileSync(path.join(__dirname,'../Resources/index.html'),'utf8');

test('공통 작업 폴더 설정은 legacy 대화의 서로 다른 경로를 에이전트별 모드로 보존한다',()=>{
  assert.match(renderer,/function normalizeWorkspace\(value, settings=state\.settings, fallback=''\)/);
  assert.match(renderer,/const legacySeparate=!!codexPath&&!!claudePath&&codexPath!==claudePath/);
  assert.match(renderer,/separate:typeof value\?\.separate==='boolean'\?value\.separate:legacySeparate/);
  assert.match(renderer,/workspace:clone\(state\.workspace\)/);
  assert.match(renderer,/state\.workspace=normalizeWorkspace\(conversation\.workspace,conversation\.settings\|\|state\.settings\)/);
  assert.match(renderer,/workspace:normalizeWorkspace\(null,state\.settings,event\.home\)/);
  assert.match(renderer,/const migratedWorkspaceIds=new Set\(\)/);
  assert.match(renderer,/migratedWorkspaceIds\.has\(conversation\.id\)/);
});

test('실제 실행과 큐는 중앙 effective workspace 설정의 snapshot을 사용한다',()=>{
  assert.match(renderer,/function effectiveWorkspacePath\(agent, settings=state\.settings, workspace=state\.workspace\)/);
  assert.match(renderer,/function effectiveAgentConfig\(agent, settings=state\.settings, workspace=state\.workspace\)/);
  assert.match(renderer,/function effectiveAgentConfigs\(settings=state\.settings, workspace=state\.workspace\)/);
  assert.match(renderer,/const config=clone\(options\.config\|\|effectiveAgentConfig\(agent\)\)/);
  assert.match(renderer,/const agentConfigs=clone\(options\.agentConfigs\|\|effectiveAgentConfigs\(\)\)/);
  assert.match(renderer,/settings:clone\(effectiveAgentConfigs\(\)\)/);
  assert.match(renderer,/const workspace=effectiveWorkspacePath\(agent\)/);
  assert.match(renderer,/workspace:effectiveWorkspacePath\(agent\),conversationId:state\.activeConversationId/);
});

test('공통 모드 UI는 공통 picker만 활성화하고 에이전트별 workspace control만 비활성화한다',()=>{
  assert.match(renderer,/에이전트별 작업 폴더 사용/);
  assert.match(renderer,/class="common-workspace"/);
  assert.match(renderer,/post\(\{action:'chooseDirectory',agent:'common'\}\)/);
  assert.match(renderer,/const workspaceDisabled=separate\?'':'disabled'/);
  assert.match(renderer,/data-key="workspacePath" value="\$\{escapeAttr\(c\.workspacePath\)\}" \$\{workspaceDisabled\}/);
  assert.match(renderer,/workspaceCard\.querySelector\('\.workspace-separate'\)\.onchange/);
  assert.match(renderer,/event\.agent==='common'\)\{state\.workspace\.commonPath=event\.path;\}/);
  assert.match(renderer,/workspace:effectiveWorkspacePath\('codex'\)\|\|''/);
  assert.match(renderer,/\.workspace-path-field \{ padding: 7px; border: 1px solid transparent; border-radius: 9px;/);
  assert.match(renderer,/\.workspace-path-field\.is-disabled \{ border-color:/);
  assert.match(renderer,/\.workspace-path-field\.is-disabled input:disabled, \.workspace-path-field\.is-disabled button:disabled/);
  assert.match(renderer,/\.workspace-path-field\.is-disabled \.branch-row\.active, \.workspace-path-field\.is-disabled \.branch-row\.detached/);
  assert.match(renderer,/field workspace-path-field \$\{separate\?'is-disabled':''\}/);
  assert.match(renderer,/field workspace-path-field \$\{separate\?'':'is-disabled'\}/);
});

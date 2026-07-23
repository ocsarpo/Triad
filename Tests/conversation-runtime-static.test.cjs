const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const renderer=fs.readFileSync(path.join(__dirname,'../Resources/index.html'),'utf8');
test('renderer runtime은 대화별 상태와 slot payload를 분리한다',()=>{assert.match(renderer,/const runtimeKeys=\['running','pending','responseIds'/);assert.match(renderer,/Object\.defineProperty\(state,key/);assert.match(renderer,/conversationId,slotId:`\$\{conversationId\}:\$\{agent\}`/);assert.match(renderer,/event\?\.conversationId&&event\.conversationId!==state\.activeConversationId/);assert.match(renderer,/const conversationId=state\.activeConversationId;state\.queueDrainScheduled=true/);});

test('대화별 설정과 세션 통계는 스냅샷으로 복원하고, 큐는 실행 당시 설정을 보존한다',()=>{
  assert.match(renderer,/state\.settings=clone\(conversation\.settings\|\|state\.settings\)/);
  assert.match(renderer,/state\.collaboration=normalizeCollaboration\(conversation\.collaboration\)/);
  assert.match(renderer,/state\.defaultTarget=normalizeDefaultTarget\(conversation\.defaultTarget\)/);
  assert.match(renderer,/state\.sessions=clone\(conversation\.sessions\|\|\{codex:null,claude:null\}\)/);
  assert.match(renderer,/normalizeSessionStats\(conversation\.sessionStats\|\|\{\}\)/);
  assert.match(renderer,/settings:clone\(state\.settings\),collaboration:clone\(activeCollaboration\(\)\)/);
  assert.match(renderer,/config:clone\(state\.settings\[agent\]\),agentConfigs:clone\(state\.settings\)/);
});

test('대화 목록의 실행·대기 배지와 삭제 가드는 대상 대화 런타임을 사용한다',()=>{
  assert.match(renderer,/const runtime=runtimeFor\(item\.id\);const running=Object\.keys\(runtime\.pending\)\.length>0\|\|!!runtime\.orchestration/);
  assert.match(renderer,/const queued=runtime\.queue\.length>0/);
  assert.match(renderer,/const runtime=runtimeFor\(conversationId\);if\(Object\.keys\(runtime\.pending\)\.length\|\|state\.backgroundWaits\.has\(conversationId\)\|\|runtime\.queue\.length\|\|runtime\.orchestration\)return/);
});

test('실행 식별자가 다른 늦은 네이티브 이벤트는 현재 런타임에 반영하지 않는다',()=>{
  assert.match(renderer,/event\?\.runId&&event\.agent&&\['raw','stderr','terminated','error','brokerEvent','brokerWarning','session'\]\.includes\(event\.type\)&&state\.pending\[event\.agent\]\?\.runId!==event\.runId\)return/);
});

test('같은 공유 문서는 모든 대화의 실행 런타임에서 충돌을 검사한다',()=>{
  assert.match(renderer,/return Object\.values\(state\.runtimes\)\.some\(runtime=>Object\.values\(runtime\.pending\)\.some\(pending=>\{/);
  assert.match(renderer,/pending\.conversationId===conversationId&&pending\.sharedContext\?\.board\?\.phase==='independent'&&pending\.sharedContext\?\.runId===sharedContext\?\.runId/);
});

test('브랜치·파일 목록·diff 캐시는 대화별 런타임에 두고 요청과 응답을 대화 ID로 연결한다',()=>{
  assert.match(renderer,/freshBranchStatus=\(\)=>\(\{codex:/);
  assert.match(renderer,/freshProjectFiles=\(\)=>\(\{codex:/);
  assert.match(renderer,/freshDiff=\(\)=>\(\{visible:false/);
  assert.match(renderer,/'branchStatus','projectFiles','diff'/);
  assert.match(renderer,/action:'gitBranch',agent,workspace,conversationId:state\.activeConversationId/);
  assert.match(renderer,/action:'projectFiles',agent,workspace,conversationId:state\.activeConversationId/);
  assert.match(renderer,/action:'projectDiff',agent,workspace:state\.settings\[agent\]\.workspacePath,conversationId:state\.activeConversationId/);
  assert.match(renderer,/event\?\.conversationId&&event\.conversationId!==state\.activeConversationId/);
  assert.match(renderer,/if\(!isBackgroundRuntime\(\)\)renderDiff\(\)/);
  assert.match(renderer,/if\(!isBackgroundRuntime\(\)\)renderSettings\(\)/);
  assert.match(renderer,/function renderAll\(\)\{[\s\S]*?renderSettings\(\)[\s\S]*?renderDiff\(\)/);
});

test('종료·실패·중지는 pending 제거 뒤 대화 목록 배지를 한 번만 갱신한다',()=>{
  const sections=[
    renderer.slice(renderer.indexOf('function failAgent'),renderer.indexOf('function finishStoppedAgent')),
    renderer.slice(renderer.indexOf('function finishStoppedAgent'),renderer.indexOf('function finishAgent(agent')),
    renderer.slice(renderer.indexOf('function finishAgent(agent'),renderer.indexOf('function advanceCollaboration(agent'))
  ];
  for(const section of sections){
    assert.match(section,/delete state\.pending\[agent\];delete state\.responseIds\[agent\];[\s\S]*?renderStatus\(false\);renderConversations\(\)/);
    assert.equal((section.match(/renderConversations\(\)/g)||[]).length,1);
  }
  const stream=renderer.slice(renderer.indexOf("else if (event.type==='raw')"),renderer.indexOf("else if (event.type==='stderr')"));
  assert.doesNotMatch(stream,/renderConversations\(\)/);
});

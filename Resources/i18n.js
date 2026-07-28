(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TriadI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Triad ships English by default and auto-switches to the user's OS language
  // (Korean supported for now).  Korean stays the SOURCE string in the code so
  // the existing static tests keep matching; English is applied at runtime.
  //
  //  - CHROME: a ko→en map for app-chrome text.  A scoped DOM sweep translates
  //    matching text/placeholder/title/aria-label/option nodes at boot and after
  //    renders.  Exact full-string match only, and message/agent/diff content
  //    subtrees are skipped, so user or AI text is never rewritten.
  //  - MSG: keyed en/ko templates ({x} placeholders) for the interpolated
  //    system/error strings that are wrapped with L() at their call sites.
  //  - AI_DIRECTIVE: appended to agent prompts so the AI answers in the UI
  //    language without translating the (Korean) prompt scaffolding.

  const CHROME = {
    // conversation panel
    '대화': 'Chats',
    '＋ 새 대화': '＋ New chat',
    '대화 검색': 'Search chats',
    '대화 목록': 'Conversations',
    '새 대화': 'New chat',
    '이름 변경': 'Rename',
    '삭제': 'Delete',
    '삭제?': 'Delete?',
    '한 번 더 누르면 삭제': 'Press again to delete',
    // header / brand
    '나 · Codex · Claude — 멘션 기반 AI 작업방': 'You · Codex · Claude — mention-based AI workspace',
    '사용량 새로고침': 'Refresh usage',
    '변경 사항': 'Changes',
    '변경 사항 닫기': 'Close changes',
    '공유 보드': 'Shared board',
    '실행 과정 숨기기': 'Hide run log',
    '실행 과정 보기': 'Show run log',
    '오른쪽 실행 과정 패널 숨기기': 'Hide the run-log panel on the right',
    '오른쪽 실행 과정 패널 보기': 'Show the run-log panel on the right',
    '↓ 맨 아래': '↓ Bottom',
    // diff pane
    '프로젝트 변경 사항': 'Project changes',
    'Codex 폴더': 'Codex folder',
    'Claude 폴더': 'Claude folder',
    '닫기': 'Close',
    '변경 파일 목록': 'Changed files',
    '변경 사항을 불러오는 중…': 'Loading changes…',
    '변경된 파일이 없습니다.': 'No changed files.',
    '내용 변경 없이 파일 메타데이터만 변경되었습니다.': 'Only file metadata changed; no content change.',
    '추가': 'Added',
    '수정': 'Modified',
    // board pane
    '에이전트 공유 문서': 'Agent shared document',
    '공유 문서': 'Shared document',
    '공유 문서 닫기': 'Close shared document',
    '＋ 새 문서': '＋ New document',
    '새 공유 문서': 'New shared document',
    '참고': 'Ref',
    '이 실행 기록을 다음 AI 요청에 참고합니다.': 'Reference this run in the next AI request.',
    '결론': 'Conclusion',
    '결론이 기록되지 않았습니다.': 'No conclusion recorded.',
    'AI 기여 요약': 'AI contribution summary',
    '아직 공유 문서가 없습니다.': 'No shared document yet.',
    '새 문서를 만들거나 협업 작업을 시작하면, 이 문서를 두 AI가 이어서 사용합니다.': 'Create a document or start a collaboration, and both AIs will build on it.',
    '저장': 'Save',
    '삭제 확인': 'Confirm delete',
    '현재 작업': 'Current work',
    '아직 기록되지 않았습니다.': 'Not recorded yet.',
    '이 문서의 이전 실행 기록이 아직 없습니다.': 'No earlier runs recorded for this document yet.',
    '이전 실행': 'Earlier run',
    'AI 작업 또는 대기열이 끝난 뒤 새 문서를 만들 수 있습니다.': 'You can create a new document after the AI work or queue finishes.',
    'AI 작업 또는 대기열이 끝난 뒤 제목을 바꿀 수 있습니다.': 'You can rename after the AI work or queue finishes.',
    'AI 작업 또는 대기열이 끝난 뒤 삭제할 수 있습니다.': 'You can delete after the AI work or queue finishes.',
    // composer — collaboration
    '진행 방식': 'Mode',
    '독립 실행': 'Independent',
    '에이전트 협업': 'Agent collaboration',
    '상호 토론': 'Debate',
    '교차 검토': 'Cross-review',
    '첫 발언': 'First speaker',
    '라운드': 'Rounds',
    '보조 AI 제한(분)': 'Helper AI limit (min)',
    '보조 AI 응답 제한 시간(분)': 'Helper AI response time limit (minutes)',
    '최종 종합': 'Final synthesis',
    '없음': 'None',
    '각 AI가 독립적으로 응답': 'Each AI answers independently',
    // composer — pins / tags
    '순차 대기열': 'Sequential queue',
    '태그 없는 메시지 기본 대상': 'Default target for untagged messages',
    '태그 없는 메시지를 Codex와 Claude 모두에게 전달': 'Send untagged messages to both Codex and Claude',
    '태그 없는 메시지를 Codex에게만 전달': 'Send untagged messages to Codex only',
    '태그 없는 메시지를 Claude에게만 전달': 'Send untagged messages to Claude only',
    '둘 다': 'Both',
    'Codex 고정': 'Codex only',
    'Claude 고정': 'Claude only',
    '블록 지시': 'Block instructions',
    '@ 문서': '@ Docs',
    '🖼 이미지': '🖼 Image',
    '# AI 지정 · @ 문서 참조 · 태그가 고정보다 우선': '# picks the AI · @ references docs · tags override the pin',
    '■ Codex 중지': '■ Stop Codex',
    '■ Claude 중지': '■ Stop Claude',
    '그냥 보내면 둘 다 · #으로 AI 선택 · 긴 개별 명령은 ‘블록 지시’ 사용': 'Send as-is for both · # to pick an AI · use “Block instructions” for long per-AI commands',
    'Enter 전송 · Shift+Enter 줄바꿈 · 태그가 없으면 두 AI에게 동시에 전달': 'Enter to send · Shift+Enter for a newline · untagged goes to both AIs',
    '보내기': 'Send',
    '제거': 'Remove',
    '취소': 'Cancel',
    '실행 전 대기 항목 취소': 'Cancel this queued item before it runs',
    // message bubble actions
    '전체 복사': 'Copy all',
    '마크다운과 줄바꿈을 포함한 원문 전체 복사': 'Copy the full original including markdown and line breaks',
    '답장': 'Reply',
    '이 AI에게 이 실행 기록을 참고해 답장합니다.': 'Reply to this AI, referencing this run.',
    '이 AI에게 답장합니다.': 'Reply to this AI.',
    '복사됨': 'Copied',
    '복사 실패': 'Copy failed',
    '복사 중…': 'Copying…',
    '원문 전체를 클립보드에 복사했습니다.': 'Copied the full original to the clipboard.',
    '클립보드에 복사하지 못했습니다.': 'Could not copy to the clipboard.',
    '원문을 클립보드에 복사하고 있습니다.': 'Copying the original to the clipboard…',
    // settings panel
    '에이전트 설정': 'Agent settings',
    '대화 비우기': 'Clear chat',
    // trace panel
    '실행 과정': 'Run log',
    '복사': 'Copy',
    '비우기': 'Clear',
    '숨기기': 'Hide',
    '실행 과정 숨기기 (다시 보기: 메뉴 → 보기)': 'Hide the run log (show again: menu → View)',
    '현재 필터된 실행 과정을 토큰·캐시 요약과 함께 클립보드로 복사': 'Copy the currently filtered run log with token/cache summary to the clipboard',
    '내부 사고 원문이 아닌 실행 이벤트·도구·명령·오류를 실시간 표시합니다.': 'Shows run events, tools, commands, and errors in real time — not raw internal reasoning.',
    '전체': 'All',
    '최신순': 'Newest first',
    '시간순': 'Oldest first',
    '정렬 전환': 'Toggle sort order',
    '명령을 보내면 실행 과정과 오류가 여기에 표시됩니다.': 'Send a command and the run log and errors appear here.',
    '상세 보기': 'Details',
    '오류 원문': 'Error output',
    // usage
    '잔여량 조회 중…': 'Checking usage…',
    '조회 실패 · ↻ 재시도': 'Check failed · ↻ retry',
    '잔여량 정보 미제공': 'Usage not available',
    // conversation status
    '답변 중 · 새 답변': 'Answering · new reply',
    '답변 중': 'Answering',
    '대기 중': 'Queued',
    '새 답변': 'New reply',
    'AI가 답변 중이며 새 응답이 도착했습니다.': 'An AI is answering and a new reply arrived.',
    'AI가 이 대화에서 답변 중입니다.': 'An AI is answering in this conversation.',
    '이 대화의 작업이 전역 순차 대기열에 있습니다.': "This conversation's work is in the global queue.",
    '새 AI 응답이 있습니다.': 'There is a new AI reply.',
    // language toggle (settings)
    '언어': 'Language',
    '자동 (OS)': 'Auto (OS)',
    '한국어': '한국어',
    'English': 'English',
    // ---- settings panel (renderSettings) --------------------------------
    '공통 작업 폴더': 'Common workspace',
    '에이전트별 작업 폴더 사용': 'Use a separate folder per agent',
    '기본은 두 AI가 같은 작업 폴더를 사용합니다. 켜면 아래 각 AI의 저장된 작업 폴더를 다시 사용합니다.': 'By default both AIs share one workspace. Turn this on to reuse each AI’s saved folder below.',
    '기본 작업 폴더': 'Default workspace folder',
    '에이전트별 작업 폴더 사용 중입니다.': 'Using a separate folder per agent.',
    '두 AI에 공통으로 적용됩니다.': 'Applies to both AIs.',
    '선택': 'Select',
    '읽기 전용': 'Read-only',
    '작업 폴더 쓰기 (권장)': 'Write to workspace (recommended)',
    '샌드박스 밖 실행 (Gradle·로컬 서버)': 'Run outside sandbox (Gradle · local server)',
    '매번 확인': 'Ask every time',
    '파일 수정 자동 허용 (권장)': 'Auto-allow file edits (recommended)',
    '자동': 'Auto',
    '추가 권한 요청 안 함': 'Don’t ask for extra permissions',
    '계획 전용': 'Plan only',
    '이 AI에만 적용되는 저장된 작업 폴더입니다.': 'A saved folder that applies to this AI only.',
    '공통 작업 폴더를 사용 중입니다. 위 설정에서 변경하세요.': 'Using the common workspace. Change it in the setting above.',
    '모델 · 응답': 'Model · Response',
    '언어 모델': 'Language model',
    '추론 강도': 'Reasoning effort',
    '응답 속도': 'Response speed',
    'Fast 모드는 지원 모델/계정에서만 동작하며 더 높은 비용 또는 크레딧을 사용할 수 있습니다.': 'Fast mode only works on supported models/accounts and may cost more or use credits.',
    '실행 환경': 'Environment',
    '샌드박스 밖': 'Outside sandbox',
    '브랜치 확인 전': 'Branch not checked',
    '작업 권한': 'Permissions',
    '⚠️ 에이전트가 사용자 계정 권한으로 명령을 실행합니다. 신뢰하는 프로젝트에서만 사용하세요.': '⚠️ The agent runs commands with your account’s privileges. Use only on projects you trust.',
    'Gradle 테스트·개발 서버처럼 자식 프로세스가 직접 소켓을 열어야 하면 ‘샌드박스 밖 실행’을 선택하세요.': 'If a child process must open sockets directly (e.g. Gradle tests, dev servers), choose “Run outside sandbox”.',
    '작업 폴더': 'Workspace folder',
    '확인 전': 'Not checked',
    '브랜치 새로고침': 'Refresh branch',
    '추가 쓰기 폴더 · 쉼표 구분': 'Extra writable folders · comma-separated',
    '빌드 캐시처럼 작업 폴더 밖에서 쓰기가 필요한 경로만 추가하세요.': 'Add only paths that need writes outside the workspace, like build caches.',
    '외부 네트워크': 'External network',
    '차단': 'Block',
    '허용': 'Allow',
    '로컬 바인딩': 'Local binding',
    '로컬 바인딩은 에이전트의 네트워크 프록시용입니다. 의존성 다운로드가 필요할 때만 외부 네트워크도 허용하세요.': 'Local binding is for the agent’s network proxy. Allow external network only when dependency downloads are needed.',
    '계정 연결': 'Account',
    'CLI 실행 파일': 'CLI executable',
    '인증 연동': 'Authentication',
    '구독 계정 (CLI)': 'Subscription account (CLI)',
    'API 키': 'API key',
    'Codex 계정': 'Codex account',
    'Claude 계정': 'Claude account',
    '다시 연결': 'Reconnect',
    '로그아웃': 'Log out',
    'OpenAI API 키 · macOS 키체인 저장': 'OpenAI API key · saved in the macOS Keychain',
    'Anthropic API 키 · macOS 키체인 저장': 'Anthropic API key · saved in the macOS Keychain',
    '키 입력': 'Enter key',
    '✓ 키체인에 저장됨': '✓ Saved to Keychain',
    '저장된 키 없음': 'No key saved',
    '연결됨': 'Connected',
    '확인 필요': 'Check needed',
    '세션': 'Session',
    '세션 정책': 'Session policy',
    '자동 회전 (권장)': 'Auto-rotate (recommended)',
    '계속 유지': 'Keep session',
    '항상 새 세션': 'Always new session',
    '턴 기준': 'Turn threshold',
    '현재 문맥 기준': 'Context threshold',
    '직전 요청의 실측 문맥이 기준(기본 170k)이거나 턴 기준(기본 50턴)에 도달한 다음 일반 작업부터 새 세션으로 시작합니다. 기본값이 높아 일반 대화는 거의 회전하지 않고 세션·프롬프트 캐시를 유지하며, 회전은 문맥이 모델 윈도우에 근접할 때의 안전장치입니다. 캐시 포함 논리 입력은 문맥 측정용이며 과금 추정이 아닙니다.': 'A new session starts from the next ordinary task once the last request’s measured context (default 170k) or the turn threshold (default 50 turns) is reached. The defaults are high, so ordinary chats rarely rotate and keep the session/prompt cache; rotation is a safeguard for when context nears the model window. The cache-inclusive logical input is for measuring context, not a billing estimate.',
    '다음 작업부터 새 세션': 'New session from next task',
    // ---- account status (accountLabel) ----------------------------------
    '로그아웃 중…': 'Logging out…',
    '브라우저 로그인 대기 중…': 'Waiting for browser login…',
    '연결 확인 중…': 'Checking connection…',
    '연결 필요': 'Not connected',
    '✓ API 계정 연결됨': '✓ API account connected',
    '✓ ChatGPT 연결됨': '✓ ChatGPT connected',
    '✓ Codex 계정 연결됨': '✓ Codex account connected',
    '✓ Claude 계정 연결됨': '✓ Claude account connected',
    '브랜치 확인 중…': 'Checking branch…',
    // ---- collaboration controls (renderCollaboration) -------------------
    '작업 시작': 'Start work',
    '초안 작성': 'Draft',
    'AI 간 호출 한도': 'AI-call limit',
    '다음 작업 준비 중': 'Preparing the next task',
    '필요할 때 서로 질문하고 답을 돌려받아 작업': 'They ask each other and exchange answers as needed',
    '작성 → 검토 → 수정': 'Draft → review → revise',
    '두 AI가 번갈아 토론': 'The two AIs debate in turns',
    '첫 발언 설정 사용': 'Use first-speaker setting',
    // integrated terminal
    '터미널': 'Terminal',
    '터미널 닫기': 'Close terminal',
    '셸 다시 시작': 'Restart shell',
    '셸 종료': 'Shell exited',
    '협업': 'Collaboration',
    // collaboration task labels (translated via tc(task.label))
    '제안 작성': 'Draft proposal',
    '좁은 검토': 'Focused review',
    '이견 해결': 'Resolve disputes',
    '최종 결정': 'Final decision',
    '답변 반영 후 작업 재개': 'Resume after reply',
  };

  // Interpolated / dynamic strings wrapped with L('key', params) at call sites.
  const MSG = {
    refMax3: { en: 'You can reference at most 3 runs.', ko: '실행 기록은 최대 3개까지 참고할 수 있습니다.' },
    refNeedsText: { en: 'Enter the task along with the run reference.', ko: '실행 기록 참조와 함께 작업 내용을 입력해주세요.' },
    needTask: { en: 'Enter the task.', ko: '작업 내용을 입력해주세요.' },
    collabLeadOne: { en: 'In collaboration, call exactly one of #codex or #claude as the starting AI.', ko: '협업에서는 #codex 또는 #claude 중 하나만 시작 AI로 호출해주세요.' },
    debateDone: { en: 'The debate is complete.', ko: '상호 토론이 완료되었습니다.' },
    reviewDone: { en: 'The cross-review is complete.', ko: '교차 검토가 완료되었습니다.' },
    agentCollabDone: { en: 'The agent collaboration is complete.', ko: '에이전트 협업이 완료되었습니다.' },
    agentStart: { en: '{lead} is starting the work. It will ask the other AI when needed and continue with the answers.', ko: '{lead}가 작업을 시작합니다. 필요한 경우 상대 AI에게 질문하고 답을 받아 계속 진행합니다.' },
    collabAborted: { en: 'The collaboration flow was stopped. {reason}', ko: '협업 흐름을 중단했습니다. {reason}' },
    sendPrepFailed: { en: '⚠️ Could not prepare the message. {detail}', ko: '⚠️ 전송을 준비하지 못했습니다. {detail}' },
    contribUnconfirmed: { en: "⚠️ Could not confirm {agent}'s shared-document contribution for this run. The answer is kept and the next task continues.", ko: '⚠️ {agent}의 공유 문서 기여가 이번 실행에 기록됐는지 확인하지 못했습니다. 답변은 유지되며 다음 작업은 계속 진행합니다.' },
    boardWriteFail: { en: '⚠️ {agent} could not record this step ({phase}) on the shared board. Continuing without recording.', ko: '⚠️ {agent}가 이 단계({phase})를 공유 보드에 기록하지 못했습니다. 기록 없이 계속 진행합니다.' },
    handoffAsk: { en: '**{from} → {to} · question ({count})**\n\n{question}{reason}', ko: '**{from} → {to} · 질문 ({count})**\n\n{question}{reason}' },
    callReason: { en: '\n\nreason: {r}', ko: '\n\n호출 이유: {r}' },
    handoffReq: { en: '{from} → {to} · collab request {n}/{max}\n{question}{reason}', ko: '{from} → {to} · 협업 요청 {n}/{max}\n{question}{reason}' },
    agentErrAbort: { en: 'Stopped the collaboration flow due to an AI run error. See the raw error in the run log on the right.', ko: 'AI 실행 오류로 협업 흐름을 중단했습니다. 오른쪽 실행 과정에서 오류 원문을 확인할 수 있습니다.' },
    maxHandoff: { en: '{agent} is wrapping up with the current information after reaching the max of {n} handoffs.', ko: '최대 위임 {n}회에 도달해 {agent}가 현재 정보로 작업을 마무리합니다.' },
    askingNote: { en: 'Asking…', ko: '질문 중…' },
    aiCallLabel: { en: 'AI call', ko: 'AI 호출' },
    collabReqLabel: { en: 'collab request', ko: '협업 요청' },
    // interpolated UI strings (renderer functions wrap these with L())
    sessionSummary: { en: '{policy} · {turns} turns · cumulative input {total}k · context {context}k{fresh}', ko: '{policy} · {turns}턴 · 누적 입력 {total}k · 현재 문맥 {context}k{fresh}' },
    sessionFresh: { en: ' · new session', ko: ' · 새 세션' },
    pinApplied: { en: '{target} pin applied', ko: '{target} 고정 적용' },
    hintIndependent: { en: 'Enter to send · extra sends while busy queue per-AI · untagged goes to {target}', ko: 'Enter 전송 · 작업 중 추가 전송은 AI별 순차 대기 · 태그가 없으면 {target}' },
    hintAgent: { en: '#codex·#claude sets the starting AI for this task · untagged {hint}', ko: '#codex·#claude로 이번 작업의 시작 AI 지정 · 태그 없으면 {hint}' },
    hintDebate: { en: 'Enter to send · extra sends while busy queue up · untagged {hint}', ko: 'Enter 전송 · 작업 중 추가 전송은 순차 대기 · 태그 없으면 {hint}' },
    flowAgentState: { en: '{agent} · {label} · AI call {n}/{max}', ko: '{agent} · {label} · AI 호출 {n}/{max}' },
    flowState: { en: '{agent} · {label} ({index}/{total})', ko: '{agent} · {label} ({index}/{total})' },
    docCurrent: { en: 'Current run: {title}', ko: '현재 실행: {title}' },
    docNext: { en: ' · next: {title}', ko: ' · 다음: {title}' },
    docSelected: { en: 'Selected doc: {title}', ko: '선택 문서: {title}' },
    logoutConfirm: { en: 'Log out of the {agent} CLI account?', ko: '{agent} CLI 계정에서 로그아웃할까요?' },
    queueIndependent: { en: 'Independent run · waiting {n}', ko: '독립 실행 대기 {n}번' },
    queueWaiting: { en: '{who} · waiting {pos}', ko: '{who} 대기 {pos}번' },
    handoffAnswer: { en: '**{from} ← {to} · answer received ✓ · {count}**\n\n{body}\n\n{from} continues with the answer applied.', ko: '**{from} ← {to} · 답변 도착 ✓ · {count}**\n\n{body}\n\n{from}가 답변을 반영해 작업을 계속합니다.' },
    handoffFailed: { en: '**{from} → {to} · AI call failed · {count}**\n\n⚠️ {error}\n\n{from} continues with the current information.', ko: '**{from} → {to} · AI 호출 실패 · {count}**\n\n⚠️ {error}\n\n{from}가 현재 정보로 작업을 계속합니다.' },
    answerTruncated: { en: '… The answer is long, so only part is shown.', ko: '… 답변이 길어 일부만 표시했습니다.' },
    viewFullAnswer: { en: 'View full answer', ko: '답변 전문 보기' },
    collapseAnswer: { en: 'Collapse', ko: '접기' },
    unknownError: { en: 'Unknown error', ko: '알 수 없는 오류' },
    pinLabel: { en: '{name} only', ko: '{name} 고정' },
    pinTitle: { en: 'Send untagged messages to {name} only', ko: '태그 없는 메시지를 {name}에게만 전달' },
    pinAllTitle: { en: 'Send untagged messages to both {a} and {b}', ko: '태그 없는 메시지를 {a}와 {b} 모두에게 전달' },
    folderLabel: { en: '{name} folder', ko: '{name} 폴더' },
    runHistory: { en: 'Run history ({n})', ko: '실행 기록 ({n})' },
    runN: { en: 'Run {n}', ko: '실행 {n}' },
    ownerLabel: { en: 'owner {name}', ko: '담당 {name}' },
    reviewerLabel: { en: 'reviewer {name}', ko: '검토 {name}' },
    busy: { en: 'Already working.', ko: '이미 작업 중입니다.' },
    cliNotFound: { en: 'CLI executable not found: {path}', ko: 'CLI 실행 파일을 찾을 수 없습니다: {path}' },
    // main-process menu + dialogs
    menuView: { en: 'View', ko: '보기' },
    menuTrace: { en: 'Show/Hide Run Log', ko: '실행 과정 표시/숨기기' },
    dlgSelect: { en: 'Select', ko: '선택' },
    dlgReference: { en: 'Reference', ko: '참조' },
    dlgAttach: { en: 'Attach', ko: '첨부' },
    dlgImages: { en: 'Images', ko: '이미지' },
  };

  function interp(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? String(params[k]) : m; });
  }

  // lang: 'en' | 'ko'.  For 'ko' the source string is returned unchanged.
  function chrome(lang, ko) {
    if (lang !== 'en') return ko;
    return Object.prototype.hasOwnProperty.call(CHROME, ko) ? CHROME[ko] : ko;
  }
  function translate(lang, key, params) {
    const entry = MSG[key];
    const base = entry ? (entry[lang] || entry.ko) : key;
    return interp(base, params);
  }
  function detect(navLang) {
    return /^ko\b/i.test(String(navLang || '')) ? 'ko' : 'en';
  }
  function aiDirective(lang) {
    return lang === 'ko'
      ? '사용자에게 보이는 답변은 한국어로 작성하세요.'
      : 'Write the user-facing answer in English.';
  }

  return { CHROME, MSG, chrome, translate, detect, aiDirective, interp, LANGS: ['en', 'ko'] };
});

# 슬롯별 git-worktree 격리 — 설계

2026-07-30 · 브레인스토밍 승인본

## 문제

두 슬롯(에이전트)이 같은 git 레포를 workspace로 물면 동시 편집 충돌이 날 수 있다.
ask_agent가 모든 런에서 열려 있으므로(v0.48.20 ONE ROOM) 단일 타겟 런도 헬퍼를 통해
같은 레포를 만질 수 있다. 오르카(Orca) 모델을 참고하되, 오르카의 운영 철학대로
"구체적 충돌이 예상될 때만 격리"한다.

## 확정된 결정

| 결정 | 선택 |
|---|---|
| 격리 트리거 | 두 슬롯의 workspace가 **같은 git 레포 루트**로 해석될 때만 자동 발동. 수동 토글 없음 |
| 격리 대상 | 충돌 런에서 **두 슬롯 모두** 각자 워크트리로. 원본 워킹카피는 항상 깨끗하게 유지 |
| 수명 | **대화당 슬롯별 1개** 생성·재사용. CLI 세션 resume과 cwd 일관성 유지 |
| dirty 베이스 | 원본의 커밋 안 된 변경(untracked 포함)을 워크트리에 **복사** 후 시작 |
| 병합 주체 | **사용자 채택 버튼**. 에이전트 자동 병합 없음 |
| 채택 메커니즘 | **A안: 베이스라인 커밋 + `git apply --3way` 패치 적용** (merge --squash·파일 복사 기각) |

## 아키텍처

새 모듈 **`electron/lib/worktree.js`** (메인 프로세스, `git-ops.js`의 async-spawn
`runGit` 패턴 재사용). 렌더러는 감지 판정을 하지 않고 IPC로 위임한다.

### 데이터 흐름

1. **감지** — 메인 `runAgent()`가 실행 요청을 받을 때마다(모든 경로 — 직접 전송·
   큐·재시도·대화 — 가 이 지점으로 수렴) `worktree.ensureIsolation()`으로 두 슬롯의
   workspacePath 루트를 `git rev-parse --show-toplevel`로 해석해 **같으면** 슬롯별
   워크트리를 확보하고, 다르거나 비-git이면 아무것도 하지 않는다. (구현 중 정제:
   렌더러 디스패치 직전 IPC 방식은 config 캡처 지점이 3곳+라 누락 위험 — 메인 단일
   지점 스왑으로 변경.)
2. **생성** (최초 1회, 이후 재사용)
   - 위치: `app.getPath('userData')/worktrees/<레포해시>/<대화ID8>-<슬롯>`
     (사용자 레포 안을 오염시키지 않음)
   - `git worktree add <dir> -b triad/<대화ID8>-<슬롯> HEAD`
   - dirty 스냅샷: `git stash create`(원본 무접촉)로 만든 커밋을 워크트리에 apply,
     untracked 파일은 `ls-files --others --exclude-standard` 목록으로 별도 복사
   - **베이스라인 커밋**: 워크트리 브랜치 안에서만 `add -A && commit`.
     이후 에이전트 델타 = 베이스라인 대비 diff. 베이스라인 SHA·경로·대화 키는
     userData의 레지스트리 JSON에 기록
3. **경로 스왑** — 메인이 요청의 `config.workspacePath`와
   `request.agentConfigs[*].workspacePath`를 in-place 교체. 이 값이 그대로 spawn
   cwd/`--cd`와 MCP 헬퍼 설정(triad-mcp-server.cjs `agents[slot].workspacePath`)으로
   흐르므로 본체 런과 ask_agent 헬퍼가 자동으로 같은 워크트리를 본다. 렌더러는
   `worktreeState` 이벤트로 미러(`state.worktrees`)만 유지해 배지·diff·채택 UI를
   표시한다.
4. **프롬프트** — 기존 workspace-context 라인에 "격리 워크트리에서 작업 중 — 원본
   반영은 사용자 채택으로" 한 줄 추가.

### 채택 (`worktree:adopt` IPC)

1. 워크트리에서 `add -A && commit` (현재 상태 봉인)
2. 패치 = `git diff --binary <베이스라인>..HEAD`
3. 원본에서 `git apply --3way` — 단, `--3way`는 `--index`를 함축해 dirty 워킹트리를
   거부하므로 **임시 인덱스(GIT_INDEX_FILE)에 워킹트리를 스테이징한 뒤 적용**한다.
   원본 브랜치·히스토리·실제 스테이징 무변화, 작업 카피에 변경만 얹힘. 사용자가
   평소 도구로 검토·커밋
4. 3-way 충돌: 채택은 완료하되 충돌 파일 목록을 채팅에 표시(마커는 파일에 남음).
   패치 전체 적용 불가면 원본 무변경 + 에러 메시지
5. 채택/폐기 후 워크트리 제거, **다음 런 전 재생성**(새 HEAD + 새 dirty 스냅샷).
   세션은 유지되므로 다음 프롬프트에 "워크스페이스가 최신 원본 기준으로 재생성됨"
   한 줄 주입

### UI

- 격리 런 중 배지: `🌿 격리 작업 중 (triad/<대화ID8>-<슬롯>)`
- 기존 슬롯별 diff 패널이 워크트리 경로를 받아 그대로 델타 표시
- diff 패널에 **[채택]** / **[폐기]** 버튼

### 에러 처리 (reactive 철학)

- `worktree add` 실패 → 런을 막지 않고 격리 없이 진행 + "격리 실패 — 원본에서 직접
  작업" 경고 배지. 예방적 차단 없음
- 크래시 잔재 → 앱 시작 시 레지스트리 대조, 고아 워크트리 `git worktree prune` +
  디렉토리 정리. 대화 삭제 시 해당 워크트리 동반 정리

## 테스트

- `Tests/` 패턴: `worktree.js`를 `vm.runInNewContext`로 로드(Node 25 UMD 이슈),
  runGit 목으로 — 감지(같은 루트/다른 루트/비-git), 생성·베이스라인, adopt 3-way
  충돌 리포트
- 통합 테스트 1개: 임시 실제 레포 → dirty 스냅샷 포함 생성 → 에이전트 편집 시뮬 →
  채택 → 원본 작업 카피에 델타만 반영 검증

## 범위 밖 (YAGNI)

- 오르카식 태스크 DAG / decision gate / heartbeat — Triad엔 [[검토요청]]·브로커가
  이미 그 역할
- 리드 에이전트 자동 병합 — 사용자 채택으로 확정했으므로 없음
- Windows 경로 처리 — Electron 마이그레이션의 Windows 단계에서 함께

---

구현: 2026-07-31, 계획 docs/superpowers/plans/2026-07-31-worktree-isolation.md
'use strict';

// git-backed actions: ports Native/main.m's projectFiles (main.m:386-432),
// gitBranch (main.m:434-454), runGit: (main.m:456-473), and projectDiff
// (main.m:475-556). Uses async child_process.spawn (rather than main.m's
// synchronous NSTask + readDataToEndOfFile) so a slow/huge repo can't freeze
// the Electron main process's event loop.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const platform = require('../platform');

const TRIAD_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function runGit(args, cwd) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(platform.gitBin(), args, { cwd });
    } catch (error) {
      resolve({ code: -1, output: '', error: (error && error.message) || 'Git 실행 실패', data: Buffer.alloc(0) });
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));
    child.on('error', error => {
      resolve({ code: -1, output: '', error: (error && error.message) || 'Git 실행 실패', data: Buffer.alloc(0) });
    });
    child.on('close', code => {
      const stdout = Buffer.concat(stdoutChunks);
      resolve({ code: code == null ? -1 : code, output: stdout.toString('utf8'), error: Buffer.concat(stderrChunks).toString('utf8'), data: stdout });
    });
  });
}

function splitLines(text) {
  return text.split('\n');
}

// Mirrors main.m:386-432 loadProjectFiles:agent:conversationId:.
async function loadProjectFiles(workspace, agent, conversationId, emit) {
  if (typeof workspace !== 'string' || workspace.length === 0 || typeof agent !== 'string') return;
  const sourceConversationId = typeof conversationId === 'string' ? conversationId : '';

  let stat = null;
  try { stat = fs.statSync(workspace); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) {
    emit({ type: 'projectFiles', agent, conversationId: sourceConversationId, workspace, files: [], error: '작업 폴더를 찾을 수 없습니다.' });
    return;
  }

  const files = [];
  let truncated = false;
  const rootResult = await runGit(['rev-parse', '--show-toplevel'], workspace);
  const root = rootResult.output.trim();
  const gitRepository = rootResult.code === 0 && root.length > 0;

  if (gitRepository) {
    const [listed, changed, untracked] = await Promise.all([
      runGit(['ls-files', '--cached', '--others', '--exclude-standard'], root),
      runGit(['diff', '--name-only', 'HEAD', '--', '.'], root),
      runGit(['ls-files', '--others', '--exclude-standard'], root),
    ]);
    const changedPaths = new Set(splitLines(changed.output));
    const untrackedPaths = new Set(splitLines(untracked.output));
    for (const filePath of splitLines(listed.output)) {
      if (!filePath) continue;
      const status = untrackedPaths.has(filePath) ? 'U' : (changedPaths.has(filePath) ? 'M' : '');
      files.push({ path: filePath, status });
      if (files.length >= 20000) { truncated = true; break; }
    }
    emit({ type: 'projectFiles', agent, conversationId: sourceConversationId, workspace: root, files, truncated, error: '' });
    return;
  }

  // The home directory is not a project. Recursively scanning it descends into
  // ~/Pictures, ~/Music, ~/Library, ... which trips macOS privacy (TCC) prompts
  // for Photos, Music, and friends — so skip the walk and return an empty list
  // until the user picks a real workspace. (The git branch above stays cheap.)
  if (path.resolve(workspace) === path.resolve(os.homedir())) {
    emit({ type: 'projectFiles', agent, conversationId: sourceConversationId, workspace, files: [], truncated: false, error: '' });
    return;
  }

  const excluded = new Set(['.git', '.gradle', 'node_modules', 'build', 'dist', 'out', 'target', 'vendor']);
  // Never descend into macOS photo/music/tv library bundles even inside a real
  // workspace — reading them triggers the same TCC prompts.
  const mediaLibraryBundle = /\.(photoslibrary|musiclibrary|tvlibrary|photolibrary|aplibrary)$/i;
  const stack = [workspace];
  walk:
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // mirrors NSDirectoryEnumerationSkipsHiddenFiles
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name) && !mediaLibraryBundle.test(entry.name)) stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = fullPath.length > workspace.length ? fullPath.slice(workspace.length + 1) : entry.name;
      files.push({ path: relative || '', status: '' });
      if (files.length >= 20000) { truncated = true; break walk; }
    }
  }
  emit({ type: 'projectFiles', agent, conversationId: sourceConversationId, workspace, files, truncated, error: '' });
}

// Mirrors main.m:434-454 loadGitBranch:agent:conversationId:.
async function loadGitBranch(workspace, agent, conversationId, emit) {
  if (typeof workspace !== 'string' || workspace.length === 0 || typeof agent !== 'string') return;
  const sourceConversationId = typeof conversationId === 'string' ? conversationId : '';

  const root = await runGit(['rev-parse', '--show-toplevel'], workspace);
  if (root.code !== 0) {
    emit({ type: 'branchResult', agent, conversationId: sourceConversationId, workspace, kind: 'none', label: 'Git 저장소 아님' });
    return;
  }
  const branch = await runGit(['branch', '--show-current'], workspace);
  let name = branch.output.trim();
  let kind = 'branch';
  if (!name.length) {
    const commit = await runGit(['rev-parse', '--short', 'HEAD'], workspace);
    const short = commit.output.trim();
    name = short.length ? `detached · ${short}` : '브랜치 확인 불가';
    kind = 'detached';
  }
  emit({ type: 'branchResult', agent, conversationId: sourceConversationId, workspace, kind, label: name });
}

function workspacePathspec(workspace, root) {
  const normalizedWorkspace = path.resolve(workspace);
  const normalizedRoot = path.resolve(root);
  const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedWorkspace.startsWith(rootPrefix) ? normalizedWorkspace.slice(rootPrefix.length) : '.';
}

function pathIsInsideRoot(relative, root) {
  if (!relative || relative.startsWith('/')) return false;
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, relative);
  return candidate.startsWith(rootPath + path.sep);
}

function largeNewFileDiff(relative, stat) {
  const mode = (stat.mode & 0o111) ? '100755' : '100644';
  return `diff --git a/${relative} b/${relative}\nnew file mode ${mode}\n--- /dev/null\n+++ b/${relative}\n@@ -0,0 +0,0 @@\n새 파일 내용이 ${stat.size} bytes로 커서 표시하지 않았습니다.\n`;
}

// Mirrors main.m:475-556 loadProjectDiff:agent:conversationId: (tracked diff
// against HEAD/the empty tree for unborn repos, plus a synthesized diff per
// untracked file, with the same size/count truncation limits).
async function loadProjectDiff(workspace, agent, conversationId, emit) {
  if (typeof workspace !== 'string' || workspace.length === 0) return;
  const sourceAgent = typeof agent === 'string' ? agent : 'codex';
  const sourceConversationId = typeof conversationId === 'string' ? conversationId : '';

  const check = await runGit(['rev-parse', '--is-inside-work-tree'], workspace);
  if (check.code !== 0) {
    emit({ type: 'diffResult', agent: sourceAgent, conversationId: sourceConversationId, workspace, text: '', error: '선택한 작업 폴더가 Git 저장소가 아닙니다.' });
    return;
  }
  const rootResult = await runGit(['rev-parse', '--show-toplevel'], workspace);
  const root = rootResult.output.trim();
  if (rootResult.code !== 0 || !root.length) {
    emit({ type: 'diffResult', agent: sourceAgent, conversationId: sourceConversationId, workspace, text: '', error: 'Git 저장소 루트를 찾을 수 없습니다.' });
    return;
  }

  const pathspec = workspacePathspec(workspace, root);
  const head = await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  let incomplete = false;
  const tracked = head.code === 0
    ? await runGit(['diff', '--no-ext-diff', '--no-color', 'HEAD', '--', pathspec], root)
    : await runGit(['diff', '--no-ext-diff', '--no-color', TRIAD_EMPTY_TREE, '--', pathspec], root);
  if (tracked.code !== 0) incomplete = true;

  let diff = tracked.output || '';
  const maximumDiffLength = 2000000;
  const maximumNewFileSize = 524288;
  const untracked = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', pathspec], root);
  if (untracked.code !== 0) incomplete = true;
  // `git status -z` NUL-delimits records instead of quoting them, which keeps
  // spaces/Korean filenames intact (mirrors main.m's TriadNullSeparatedStrings,
  // main.m:108-124). Split on String.fromCharCode(0) rather than a raw NUL
  // byte literal so the delimiter stays visible/searchable in source.
  const nulByte = String.fromCharCode(0);
  const records = untracked.data.length ? untracked.data.toString('utf8').split(nulByte).filter(Boolean) : [];
  const paths = records.filter(record => record.startsWith('?? ')).map(record => record.slice(3));

  let truncated = incomplete || diff.length > maximumDiffLength;
  if (diff.length > maximumDiffLength) diff = diff.slice(0, maximumDiffLength);

  let included = 0;
  for (const relative of paths) {
    if (!relative.length) continue;
    if (included >= 100 || diff.length >= maximumDiffLength) { truncated = true; break; }
    if (!pathIsInsideRoot(relative, root)) continue;
    const absolute = path.join(root, relative);
    let stat;
    try { stat = fs.statSync(absolute); } catch { continue; }
    if (stat.isDirectory()) continue;

    let newFileDiff;
    if (stat.size > maximumNewFileSize) {
      newFileDiff = largeNewFileDiff(relative, stat);
      truncated = true;
    } else {
      const generated = await runGit(['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', relative], root);
      newFileDiff = generated.output || '';
      if (!newFileDiff.length && generated.code !== 0) {
        newFileDiff = largeNewFileDiff(relative, stat);
        truncated = true;
      }
    }
    if (newFileDiff.length > maximumDiffLength || diff.length + newFileDiff.length > maximumDiffLength) {
      truncated = true;
      break;
    }
    if (diff.length && !diff.endsWith('\n')) diff += '\n';
    diff += newFileDiff;
    included += 1;
  }

  emit({ type: 'diffResult', agent: sourceAgent, conversationId: sourceConversationId, workspace, text: diff, truncated, error: '' });
}

module.exports = { loadProjectFiles, loadGitBranch, loadProjectDiff };

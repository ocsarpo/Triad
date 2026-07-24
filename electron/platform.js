'use strict';

// Single cross-platform seam for everything OS-specific. `main.js` and the
// `lib/*` modules never branch on `process.platform` directly — they call
// through here so a Windows implementation can be dropped in later without
// touching the rest of the app.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function isExecutable(candidate) {
  if (!candidate) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function searchPathDirectories(name) {
  const pathValue = process.env.PATH || '';
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

// ----- darwin ---------------------------------------------------------------
// Mirrors Native/main.m's `firstExecutable:` search lists (main.m:295-305)
// plus the ~/.volta/bin location main.m's own PATH augmentation uses
// elsewhere (main.m:587, 679, 1298), then falls back to a full PATH scan.
function resolveExecutableDarwin(name) {
  const home = app.getPath('home');
  const candidates = [];
  if (name === 'codex') candidates.push('/Applications/ChatGPT.app/Contents/Resources/codex');
  candidates.push(
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name,
    path.join(home, '.local/bin', name),
    path.join(home, '.volta/bin', name)
  );
  return firstExecutable(candidates) || searchPathDirectories(name) || name;
}

function agentPathEnvDarwin(home) {
  return `/opt/homebrew/bin:/usr/local/bin:${home}/.volta/bin:${home}/.local/bin:${home}/bin:${process.env.PATH || ''}`;
}

function gitBinDarwin() {
  return isExecutable('/usr/bin/git') ? '/usr/bin/git' : 'git';
}

// ----- win32 (TODO: implement when building on a Windows machine) ----------
// Windows has no Homebrew/`/usr/local` layout and CLIs installed via npm show
// up as `.cmd` shims on PATH (or under %APPDATA%\npm), so this needs its own
// resolution strategy rather than reusing the darwin candidate list.
function resolveExecutableWin32(name) {
  // TODO(win32): shell out to `where <name>` (or `where.exe <name>`) and take
  // the first match; also probe `%APPDATA%\npm\<name>.cmd` (global npm
  // installs) and any known ChatGPT/Claude desktop install directories once
  // they're documented. Falling back to the bare name still lets `spawn` try
  // PATH resolution itself (with `shell: true` likely needed for `.cmd`).
  return name;
}

function agentPathEnvWin32(home) {
  // TODO(win32): compose PATH from `%APPDATA%\npm`, a Volta shim directory
  // (`%LOCALAPPDATA%\Volta\bin` or similar), and the existing PATH — there is
  // no Homebrew-equivalent prefix on Windows.
  return process.env.PATH || '';
}

function gitBinWin32() {
  // TODO(win32): resolve via `where git` or fall back to the standard
  // `C:\Program Files\Git\cmd\git.exe` install path; the bare 'git' works
  // whenever Git for Windows added itself to PATH during install.
  return 'git';
}

// ----- seam -------------------------------------------------------------------
function resolveExecutable(name) {
  return process.platform === 'win32' ? resolveExecutableWin32(name) : resolveExecutableDarwin(name);
}

function agentPathEnv(home) {
  return process.platform === 'win32' ? agentPathEnvWin32(home) : agentPathEnvDarwin(home);
}

function gitBin() {
  return process.platform === 'win32' ? gitBinWin32() : gitBinDarwin();
}

function appDataDir() {
  return app.getPath('userData');
}

module.exports = { resolveExecutable, agentPathEnv, gitBin, appDataDir, isExecutable };

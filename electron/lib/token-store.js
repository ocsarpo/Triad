'use strict';

// Token store: mirrors the Keychain-backed tokenForAgent/saveToken/
// deleteTokenForAgent/emitTokenStatus behavior in Native/main.m:1554-1612,
// but persists to `${userData}/tokens.json` using Electron's safeStorage
// (OS keychain/DPAPI-backed encryption) instead of raw Security.framework
// SecItem calls, since safeStorage already abstracts that per-OS mechanism.

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const platform = require('../platform');

function tokensFilePath() {
  return path.join(platform.appDataDir(), 'tokens.json');
}

function readAll() {
  try {
    const raw = fs.readFileSync(tokensFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  const filePath = tokensFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(map), { mode: 0o600 });
}

function getToken(agent) {
  if (!agent) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const map = readAll();
  const encoded = map[agent];
  if (typeof encoded !== 'string' || !encoded.length) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return null;
  }
}

// Mirrors main.m:1574-1591 saveToken:forAgent: (trims, rejects empty, and
// reports keychain-style failures back through the same tokenError shape).
function saveToken(agent, token) {
  const trimmed = typeof token === 'string' ? token.trim() : '';
  if (!agent || !trimmed.length) {
    return { success: false, message: '토큰을 입력해주세요.' };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { success: false, message: '이 시스템에서는 안전한 저장소를 사용할 수 없습니다.' };
  }
  try {
    const encrypted = safeStorage.encryptString(trimmed);
    const map = readAll();
    map[agent] = encrypted.toString('base64');
    writeAll(map);
    return { success: true };
  } catch (error) {
    return { success: false, message: (error && error.message) || '키체인 저장 실패' };
  }
}

function deleteToken(agent) {
  if (!agent) return;
  const map = readAll();
  if (Object.prototype.hasOwnProperty.call(map, agent)) {
    delete map[agent];
    writeAll(map);
  }
}

// Shape matches main.m:1604-1612 emitTokenStatus (`{codex, claude}` nested
// under `status`, not flattened onto the event like the boot payload is).
function status() {
  return { codex: getToken('codex') != null, claude: getToken('claude') != null };
}

module.exports = { getToken, saveToken, deleteToken, status };

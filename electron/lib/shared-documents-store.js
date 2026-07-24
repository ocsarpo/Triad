'use strict';

// Shared documents store: JSON-file replacement for the one-file-per-document
// directory in Native/main.m:834-972 (sharedContextDirectoryCreate:/
// emitSharedDocuments/saveSharedDocument/deleteSharedDocument). Persists
// `${userData}/sharedDocuments.json` as a plain array, per the prototype's
// design, but keeps main.m's documentId derivation/validation rules and
// user-facing error messages so index.html's handling stays byte-identical.

const fs = require('fs');
const path = require('path');
const platform = require('../platform');

function filePath() {
  return path.join(platform.appDataDir(), 'sharedDocuments.json');
}

function readAll() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(list));
}

// Mirrors main.m:834-839 safeSharedContextIdentifier: — alphanumeric plus
// dash/underscore only, 1-128 characters.
function safeSharedContextIdentifier(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 128) return null;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function nonEmptyStringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

// Mirrors main.m:873-886 sharedDocumentIdFromDocument:allowConversationFallback:
// — prefers document.documentId, falls back to document.board.documentId,
// then (optionally) document.conversationId, each validated as an identifier.
function sharedDocumentIdFromDocument(document, allowConversationFallback) {
  if (!document || typeof document !== 'object') return null;
  const hasOwnDocumentId = Object.prototype.hasOwnProperty.call(document, 'documentId') && document.documentId != null;
  let candidate = nonEmptyStringOrEmpty(document.documentId);
  if (hasOwnDocumentId && candidate.length === 0) return null;

  if (candidate.length === 0) {
    const board = document.board && typeof document.board === 'object' ? document.board : null;
    const hasBoardDocumentId = !!board && Object.prototype.hasOwnProperty.call(board, 'documentId') && board.documentId != null;
    candidate = board ? nonEmptyStringOrEmpty(board.documentId) : '';
    if (hasBoardDocumentId && candidate.length === 0) return null;
  }

  if (candidate.length === 0 && allowConversationFallback) {
    candidate = nonEmptyStringOrEmpty(document.conversationId);
  }

  return candidate.length ? safeSharedContextIdentifier(candidate) : null;
}

function timestampOrZero(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

// Mirrors main.m:888-931 emitSharedDocuments's sort: newest updatedAt first,
// documentId ascending as the tie-break.
function sortDocuments(documents) {
  return documents.slice().sort((left, right) => {
    const leftUpdated = timestampOrZero(left.updatedAt);
    const rightUpdated = timestampOrZero(right.updatedAt);
    if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
    return String(left.documentId).localeCompare(String(right.documentId));
  });
}

function listDocuments() {
  const documents = [];
  for (const document of readAll()) {
    if (!document || typeof document !== 'object') continue;
    const documentId = sharedDocumentIdFromDocument(document, true);
    if (!documentId) continue;
    documents.push({ ...document, documentId });
  }
  return sortDocuments(documents);
}

// Mirrors main.m:933-957 saveSharedDocument: — same validation order and
// Korean error strings so the UI's sharedDocumentsError handling matches.
function saveDocument(document) {
  if (!document || typeof document !== 'object') {
    return { ok: false, message: '저장할 공유 문서가 올바르지 않습니다.' };
  }
  const documentId = sharedDocumentIdFromDocument(document, true);
  if (!documentId) {
    return { ok: false, message: '공유 문서 ID는 영문, 숫자, -, _만 사용할 수 있습니다.' };
  }
  const stored = { ...document, documentId };
  let serialized;
  try {
    serialized = JSON.stringify(stored);
  } catch {
    serialized = null;
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) {
    return { ok: false, message: '공유 문서는 2MB 이하의 JSON이어야 합니다.' };
  }
  try {
    const list = readAll();
    const index = list.findIndex(item => sharedDocumentIdFromDocument(item, true) === documentId);
    if (index >= 0) list[index] = stored; else list.push(stored);
    writeAll(list);
    return { ok: true };
  } catch {
    return { ok: false, message: '공유 문서를 저장하지 못했습니다.' };
  }
}

// Mirrors main.m:959-972 deleteSharedDocument:.
function deleteDocument(documentId) {
  const safeId = safeSharedContextIdentifier(documentId);
  if (!safeId) {
    return { ok: false, message: '삭제할 공유 문서 ID가 올바르지 않습니다.' };
  }
  try {
    writeAll(readAll().filter(item => sharedDocumentIdFromDocument(item, true) !== safeId));
    return { ok: true };
  } catch {
    return { ok: false, message: '공유 문서를 삭제하지 못했습니다.' };
  }
}

module.exports = { listDocuments, saveDocument, deleteDocument };

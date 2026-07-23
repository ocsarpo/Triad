'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

// The lock is normally held for only a few milliseconds.  Thirty seconds is
// deliberately generous: it recovers processes killed by Stop/app shutdown
// without taking over a slow but still healthy filesystem operation.
const DEFAULT_STALE_LOCK_AGE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 200;
const DEFAULT_RETRY_DELAY_MS = 10;

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function lockToken() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

function readLock(lockPath) {
  let stat;
  let raw;
  try {
    stat = fs.statSync(lockPath);
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  let metadata = null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isInteger(parsed.pid) && parsed.pid > 0 &&
      Number.isFinite(parsed.at) && parsed.at > 0 &&
      typeof parsed.token === 'string' && parsed.token.length > 0
    ) metadata = parsed;
  } catch {}

  return {
    raw,
    metadata,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
  };
}

function isProcessDefinitelyDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM and every other uncertain failure must be treated as alive.  Only
    // ESRCH proves that the original owner has gone away.
    return error && error.code === 'ESRCH';
  }
}

function isStaleLock(lock, now = Date.now(), staleAgeMs = DEFAULT_STALE_LOCK_AGE_MS) {
  if (!lock) return false;
  if (lock.metadata) {
    return isProcessDefinitelyDead(lock.metadata.pid) || now - lock.metadata.at > staleAgeMs;
  }
  // A half-written/corrupt lock is never taken immediately.  It can only be
  // recovered once its filesystem timestamp has aged past the same threshold.
  return now - lock.mtimeMs > staleAgeMs;
}

function sameLock(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino && left.raw === right.raw);
}

function quarantinePath(lockPath) {
  return `${lockPath}.${process.pid}.${lockToken()}.stale`;
}

function recoverStaleLock(lockPath, options = {}) {
  const staleAgeMs = options.staleAgeMs ?? DEFAULT_STALE_LOCK_AGE_MS;
  const observed = readLock(lockPath);
  if (!isStaleLock(observed, Date.now(), staleAgeMs)) return false;

  const isolatedPath = quarantinePath(lockPath);
  try {
    // rename is atomic.  After this point we only ever unlink the isolated
    // inode, never lockPath, so a new owner cannot be accidentally deleted.
    fs.renameSync(lockPath, isolatedPath);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }

  const isolated = readLock(isolatedPath);
  if (sameLock(observed, isolated)) {
    try { fs.unlinkSync(isolatedPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return true;
  }

  // The path changed between observation and rename.  Do not delete the
  // unfamiliar lock; restore it when no newer owner has appeared.  If a third
  // owner has already created the canonical path (EEXIST), preserve this
  // isolated file too: deleting an unverified lock is worse than leaving a
  // later stale candidate for the normal recovery pass.
  try { fs.renameSync(isolatedPath, lockPath); } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EEXIST') throw error;
  }
  return false;
}

function acquireFileLock(filePath, options = {}) {
  const lockPath = `${filePath}.lock`;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const staleAgeMs = options.staleAgeMs ?? DEFAULT_STALE_LOCK_AGE_MS;
  const token = lockToken();
  const metadata = { pid: process.pid, at: Date.now(), token };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let descriptor = null;
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(metadata), 'utf8');
      fs.closeSync(descriptor);
      return { lockPath, token };
    } catch (error) {
      try { if (descriptor != null) fs.closeSync(descriptor); } catch {}
      if (error.code !== 'EEXIST') throw error;
      recoverStaleLock(lockPath, { staleAgeMs });
      pause(retryDelayMs);
    }
  }
  throw new Error(options.failureMessage || '잠금을 얻지 못했습니다.');
}

function releaseFileLock(lock) {
  if (!lock) return;
  const current = readLock(lock.lockPath);
  // A stale recovery may have replaced this path.  Token matching prevents an
  // old owner's finally block from unlinking that newer owner's lock.
  if (!current || !current.metadata || current.metadata.token !== lock.token) return;
  try { fs.unlinkSync(lock.lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function withFileLock(filePath, work, options = {}) {
  const lock = acquireFileLock(filePath, options);
  try { return work(); }
  finally { releaseFileLock(lock); }
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_STALE_LOCK_AGE_MS,
  acquireFileLock,
  isProcessDefinitelyDead,
  isStaleLock,
  readLock,
  recoverStaleLock,
  releaseFileLock,
  withFileLock,
};

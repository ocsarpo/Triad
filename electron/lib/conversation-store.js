'use strict';

// Conversation store: JSON-file replacement for the SQLite table in
// Native/main.m:767-832 (setupDatabase/loadConversations/saveConversation/
// deleteConversation). Persists `${userData}/conversations.json` as a plain
// array of conversation objects keyed by `.id`, per the prototype's design.

const fs = require('fs');
const path = require('path');
const platform = require('../platform');

function filePath() {
  return path.join(platform.appDataDir(), 'conversations.json');
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

// main.m:785 loads `ORDER BY updated_at DESC`; replicate that ordering here
// since the JSON file has no inherent order guarantee.
function loadConversations() {
  const list = readAll();
  return list.slice().sort((left, right) => (Number(right && right.updatedAt) || 0) - (Number(left && left.updatedAt) || 0));
}

function saveConversation(conversation) {
  if (!conversation || typeof conversation !== 'object') return;
  const id = conversation.id;
  const title = conversation.title;
  if (typeof id !== 'string' || typeof title !== 'string') return;
  const list = readAll();
  const index = list.findIndex(item => item && item.id === id);
  if (index >= 0) list[index] = conversation; else list.push(conversation);
  writeAll(list);
}

function deleteConversation(id) {
  if (typeof id !== 'string') return;
  writeAll(readAll().filter(item => !(item && item.id === id)));
}

module.exports = { loadConversations, saveConversation, deleteConversation };

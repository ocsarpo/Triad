'use strict';

// Small helpers mirroring the TriadStringOrNil / TriadDictionaryOrNil guards
// in Native/main.m (main.m:82-93) -- WKWebView/IPC can hand us anything a JS
// caller decided to send, so narrow before trusting shapes.

function stringOrNil(value) {
  return typeof value === 'string' ? value : null;
}

function stringOrDefault(value, fallback) {
  const string = stringOrNil(value);
  return string === null ? fallback : string;
}

function dictOrNil(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

// Mirrors emit:'s JSON encoding (main.m:1543-1551). JSON.stringify is free to
// emit the raw Unicode line-separator and paragraph-separator code points
// (hex 2028 and 2029) inside string values. Those two code points are valid
// JSON but were illegal unescaped inside a JS string literal before ES2019,
// and executeJavaScript evaluates our payload as a script rather than
// parsing it as JSON, so we defensively rewrite each one as the equivalent
// six-character backslash-u escape sequence text. Built via charCodes and
// concatenation, never as a source literal containing the raw separator or
// its escape form, so no editor or intermediate encoding step can turn the
// intended literal backslash text into an actual separator character.
function safeJson(payload) {
  const backslash = String.fromCharCode(92);
  const lineSeparator = String.fromCharCode(8232);
  const paragraphSeparator = String.fromCharCode(8233);
  const escapedLineSeparator = backslash + 'u2028';
  const escapedParagraphSeparator = backslash + 'u2029';
  return JSON.stringify(payload)
    .split(lineSeparator).join(escapedLineSeparator)
    .split(paragraphSeparator).join(escapedParagraphSeparator);
}

module.exports = { stringOrNil, stringOrDefault, dictOrNil, safeJson };

'use strict';

// Reads the same version string the native shell reports at boot
// (main.m:308: NSBundle.mainBundle.infoDictionary[CFBundleShortVersionString]),
// but from the un-bundled Resources/Info.plist this prototype loads directly.
// Not OS-specific (it's just a small XML read), so it lives outside platform.js.

const fs = require('fs');
const path = require('path');
const resources = require('./resources');

function readAppVersion() {
  try {
    const contents = fs.readFileSync(path.join(resources.dir(), 'Info.plist'), 'utf8');
    const match = contents.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/);
    return match && match[1] ? match[1] : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

module.exports = { readAppVersion };

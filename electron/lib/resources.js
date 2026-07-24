'use strict';

// Resolves the shared web UI directory (repo `Resources/`, reused unchanged)
// in BOTH run modes:
//  - dev (`npm start`): it sits two levels up from this file (electron/lib → repo root → Resources).
//  - packaged (.app): electron-packager's `--extra-resource=../Resources` copies
//    it into the bundle's Contents/Resources/Resources, i.e. process.resourcesPath/Resources.
// Everything else (main.js, app-info.js) goes through here so packaging can't
// silently break the index.html / Info.plist paths.

const path = require('path');
const { app } = require('electron');

function dir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'Resources')
    : path.join(__dirname, '..', '..', 'Resources');
}

module.exports = { dir };

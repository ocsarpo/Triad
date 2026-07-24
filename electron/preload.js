'use strict';

// Bridge, renderer side.  index.html talks to the shell exactly as it did to
// the native WKWebView: it calls window.webkit.messageHandlers.triad.postMessage
// (index.html:519) and expects the shell to invoke window.nativeEvent(payload)
// (defined at index.html:1904).  We recreate only the outbound half here; the
// inbound half is delivered by main.js via webContents.executeJavaScript, which
// mirrors the native emit: (main.m:1543) precisely — so index.html is unchanged.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    triad: {
      postMessage: (payload) => ipcRenderer.send('triad:post', payload),
    },
  },
});

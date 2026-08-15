'use strict';

// 预加载脚本:给 shell.html 暴露窗口控制 IPC
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});

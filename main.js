'use strict';

/**
 * dsh 桌面端主进程。
 *
 * 架构(参考 reasonix 的「壳 + 本地服务 + WebView」):
 *   1. 启动时 spawn 内置的 @deepseek-ai/dsh web(用 Electron 自带的 Node 跑)
 *   2. 轮询等 127.0.0.1:3080 就绪
 *   3. BrowserWindow 加载 3080 —— UI 与 web 版完全一致
 *   4. 托盘 / 单实例 / 窗口状态 / 日志 / 更新检查
 *   5. 退出时优雅关闭 dsh 子进程
 */

const { app, BrowserWindow, Tray, Menu, dialog, Notification, nativeImage, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const APP_NAME = 'DeepSeek Harness';
const APP_PORT = 3080;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

let mainWindow = null;
let tray = null;
let dshChild = null;
let isQuitting = false;

const userDataDir = app.getPath('userData');
const logsDir = path.join(userDataDir, 'logs');
const stateFile = path.join(userDataDir, 'window-state.json');

// ---------- 日志 ----------
function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'main.log'), line);
  } catch {}
  console.log(line.trim());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- dsh 定位与启动 ----------
function resolveDshPackageJson() {
  const candidates = [
    () => require.resolve('@deepseek-ai/dsh/package.json'),
    () => path.join(__dirname, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  ];
  for (const c of candidates) {
    try {
      const p = c();
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function resolveDshBin() {
  const pkgJson = resolveDshPackageJson();
  if (!pkgJson) return null;
  return path.join(path.dirname(pkgJson), 'lib', 'bin.js');
}

function portServing(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portServing(port)) return true;
    await sleep(400);
  }
  return false;
}

function spawnDsh() {
  const bin = resolveDshBin();
  if (!bin) {
    log('error', '找不到 @deepseek-ai/dsh/lib/bin.js');
    return null;
  }
  log('info', '启动 dsh: ' + bin);
  // ELECTRON_RUN_AS_NODE=1 让 Electron 自带的 Node 以纯 Node 方式运行 dsh 的 bin.js
  // --expose-internals:dsh 的 HMR 服务(web profile 会挂 watch-only 实例)要求这个标志
  const child = spawn(process.execPath, ['--expose-internals', bin, 'web'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (d) => log('dsh', d.toString().trim()));
  child.stderr.on('data', (d) => log('dsh', d.toString().trim()));
  child.on('error', (e) => log('error', 'dsh 启动失败: ' + e.message));
  child.on('exit', (code, signal) => {
    log('info', `dsh 退出 code=${code} signal=${signal}`);
    dshChild = null;
  });
  return child;
}

async function startDsh() {
  // 端口已有服务(比如用户手动跑过 dsh web)就直接复用,不再重复启动
  if (await portServing(APP_PORT)) {
    log('info', `端口 ${APP_PORT} 已有服务,直接复用`);
    return true;
  }
  dshChild = spawnDsh();
  if (!dshChild) return false;
  const ok = await waitForServer(APP_PORT, 60000);
  if (!ok) log('error', `等待 dsh 就绪超时(${APP_PORT})`);
  return ok;
}

// ---------- 窗口 ----------
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    fs.writeFileSync(stateFile, JSON.stringify({ bounds: mainWindow.getBounds() }));
  } catch {}
}

function createWindow(state) {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  const opts = {
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    icon,
    title: APP_NAME,
    show: false,
    frame: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  };
  if (state && state.bounds) Object.assign(opts, state.bounds);

  const win = new BrowserWindow(opts);
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    // 点关闭 = 最小化到托盘;真正退出走托盘菜单或系统退出
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  return win;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- 托盘 ----------
function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon-32.png'));
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showWindow },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ])
  );
  tray.on('click', showWindow);
}

// ---------- 更新检查 ----------
function installedDshVersion() {
  const pkgJson = resolveDshPackageJson();
  if (!pkgJson) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
  } catch {
    return null;
  }
}

function latestDshVersion() {
  return new Promise((resolve) => {
    const url = 'https://registry.npmmirror.com/@deepseek-ai%2fdsh';
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data)['dist-tags'].latest || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function checkForUpdates() {
  try {
    const installed = installedDshVersion();
    const latest = await latestDshVersion();
    if (!installed || !latest) return;
    log('info', `dsh 版本检查: 当前 ${installed}, 最新 ${latest}`);
    if (latest !== installed) {
      new Notification({
        title: 'dsh 有新版本',
        body: `当前 ${installed} → 最新 ${latest}`,
        icon: path.join(__dirname, 'build', 'icon.png'),
      }).show();
      // 稍等再弹窗,避免遮住启动过程
      setTimeout(async () => {
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'dsh 更新',
          message: `发现 dsh 新版本 ${latest}`,
          detail: `当前内置 ${installed}。是否现在更新?`,
          buttons: ['立即更新', '稍后'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) await runUpdate(latest);
      }, 3000);
    }
  } catch (e) {
    log('error', '更新检查异常: ' + e.message);
  }
}

async function runUpdate(version) {
  log('info', `开始更新 dsh 到 ${version}`);
  await new Promise((resolve) => {
    // 用系统 npm 更新(需要 npm 在 PATH;打包环境若没有 npm 会在日志里体现)
    const child = spawn('npm', ['install', `@deepseek-ai/dsh@${version}`, '--no-save'], {
      cwd: __dirname,
      shell: true,
      windowsHide: true,
    });
    child.stdout.on('data', (d) => log('dsh-update', d.toString().trim()));
    child.stderr.on('data', (d) => log('dsh-update', d.toString().trim()));
    child.on('exit', (code) => {
      log('info', `npm install 退出 code=${code}`);
      resolve();
    });
  });
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '更新完成',
    message: 'dsh 已更新,重启应用后生效。',
    buttons: ['重启'],
  });
  isQuitting = true;
  app.relaunch();
  app.quit();
}

// ---------- 生命周期 ----------
function shutdown() {
  log('info', '关闭中,清理 dsh 子进程');
  if (dshChild) {
    try {
      dshChild.kill('SIGTERM');
    } catch {}
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    log('info', `${APP_NAME} 启动`);
    const state = loadWindowState();
    mainWindow = createWindow(state);
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
      if (!mainWindow) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.on('window:close', () => mainWindow?.close());
    const ok = await startDsh();
    if (ok) {
      await mainWindow.loadFile('shell.html');
    } else {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'dsh 启动失败',
        message: '无法启动 dsh 服务。',
        detail: `请查看日志:${path.join(logsDir, 'main.log')}`,
      });
    }
    setupTray();
    checkForUpdates();

    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    saveWindowState();
  });
  app.on('will-quit', shutdown);
}

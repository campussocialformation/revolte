// Revolte — Electron main process
const { app, BrowserWindow, ipcMain, dialog, Menu, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// keep the audio thread at full speed when the window is in the background
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let win = null;
let pendingOpen = null;
let allowClose = false;

function fileFromArgs(argv) {
  return argv.find((a) => /\.rvlt$/i.test(a) && fs.existsSync(a)) || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1180, minHeight: 720,
    backgroundColor: '#0c0d11', title: 'Revolte', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('did-finish-load', () => {
    const f = pendingOpen || fileFromArgs(process.argv);
    pendingOpen = null;
    if (f) sendOpen(f);
  });
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('close-request');
    // fallback if the UI does not answer (crashed renderer)
    clearTimeout(win._closeTimer);
    win._closeTimer = setTimeout(() => { if (win.webContents.isCrashed()) { allowClose = true; app.quit(); } }, 4000);
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function sendOpen(f) {
  try { win.webContents.send('open-file', f, fs.readFileSync(f, 'utf8')); } catch (e) { /* ignore */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (e, argv) => {
  const f = fileFromArgs(argv);
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) sendOpen(f); }
});

app.whenReady().then(() => {
  // WebMIDI permissions (MIDImix, Launchkey)
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['midi', 'midiSysex', 'media'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ['midi', 'midiSysex', 'media'].includes(permission));
  createWindow();
});
app.on('window-all-closed', () => app.quit());

const PROJECT_FILTERS = [{ name: 'Projet Revolte', extensions: ['rvlt'] }, { name: 'Tous', extensions: ['*'] }];
const docs = () => { const d = path.join(app.getPath('documents'), 'Revolte'); try { fs.mkdirSync(d, { recursive: true }); } catch { } return d; };

ipcMain.handle('save-project', async (e, { json, path: p, name }) => {
  let target = p;
  if (!target || !path.isAbsolute(target)) {
    const r = await dialog.showSaveDialog(win, { title: 'Sauvegarder le projet', defaultPath: path.join(docs(), `${(name || 'Projet').replace(/[\\/:*?"<>|]/g, '_')}.rvlt`), filters: PROJECT_FILTERS });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(target)) { try { fs.copyFileSync(target, target + '.bak'); } catch { } }
  fs.renameSync(tmp, target);
  return target;
});
ipcMain.handle('open-project', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Ouvrir un projet', defaultPath: docs(), filters: PROJECT_FILTERS, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('save-binary', async (e, { bytes, name, filters }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Enregistrer', defaultPath: path.join(docs(), name), filters: filters || [] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});
ipcMain.handle('confirm', async (e, { message, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return r.response;
});
ipcMain.on('quit', () => { allowClose = true; app.quit(); });

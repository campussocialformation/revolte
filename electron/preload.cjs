// Revolte — safe bridge between the UI and the main process
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('revolteNative', {
  saveProject: (o) => ipcRenderer.invoke('save-project', o),
  openProject: () => ipcRenderer.invoke('open-project'),
  saveBinary: (o) => ipcRenderer.invoke('save-binary', o),
  confirm: (message, buttons) => ipcRenderer.invoke('confirm', { message, buttons }),
  quit: () => ipcRenderer.send('quit'),
  onCloseRequest: (fn) => ipcRenderer.on('close-request', () => fn()),
  onOpenFile: (fn) => ipcRenderer.on('open-file', (e, path, json) => fn(path, json)),
  // native audio: the MessagePort is forwarded to the page with window.postMessage
  audioConnect: () => ipcRenderer.send('audio-connect'),
  audioDisconnect: () => ipcRenderer.send('audio-disconnect'),
  onAudioHostExit: (fn) => ipcRenderer.on('audio-host-exit', (e, code) => fn(code)),
});
ipcRenderer.on('audio-port', (e) => { window.postMessage({ type: 'revolte-audio-port' }, '*', e.ports); });

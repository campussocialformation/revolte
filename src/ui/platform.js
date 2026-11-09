// Revolte — file access (Electron native dialogs, or browser fallback) and autosave
const native = typeof window !== 'undefined' ? window.revolteNative : null;
export const isElectron = !!native;

export async function saveProjectFile(json, path, name, saveAs = false) {
  if (native) return native.saveProject({ json, path: saveAs ? null : path, name });
  // browser: File System Access API or download
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({ suggestedName: `${name}.rvlt`, types: [{ description: 'Projet Revolte', accept: { 'application/json': ['.rvlt'] } }] });
    const w = await handle.createWritable(); await w.write(json); await w.close();
    return handle.name;
  }
  download(new Blob([json], { type: 'application/json' }), `${name}.rvlt`);
  return `${name}.rvlt`;
}
export async function openProjectFile() {
  if (native) return native.openProject();
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.rvlt,.json';
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return resolve(null); resolve({ path: f.name, json: await f.text() }); };
    inp.click();
  });
}
export async function saveBinary(bytes, name, filters) {
  if (native) return native.saveBinary({ bytes, name, filters });
  download(new Blob([bytes]), name);
  return name;
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ------------------------------------------------------------------ autosave in IndexedDB
const DB = 'revolte'; const STORE = 'session';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function autosaveWrite(obj) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(obj, 'last'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function autosaveRead() {
  try {
    const d = await db();
    return await new Promise((res) => { const tx = d.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get('last'); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
  } catch { return null; }
}

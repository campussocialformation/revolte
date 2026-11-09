// Revolte — entry of the native audio utility process (Electron utilityProcess)
import { createRequire } from 'node:module';
import os from 'node:os';
import { AudioHost } from './audio-host.mjs';

const require = createRequire(import.meta.url);
let RtAudio = null;
let loadError = null;
try { ({ RtAudio } = require('audify')); } catch (e) { loadError = e; }

// the audio thread should not be preempted by ordinary apps
try { os.setPriority(0, os.constants.priority.PRIORITY_HIGH); } catch { /* not allowed: keep normal priority */ }

let port = null;
const host = new AudioHost((msg) => { if (port) port.postMessage(msg); }, RtAudio);

process.parentPort.on('message', (e) => {
  const d = e.data;
  if (d && d.type === 'port') {
    port = e.ports[0];
    port.on('message', (ev) => {
      if (!RtAudio && ev.data && ev.data.type === '__audio') {
        port.postMessage({ type: '__audio', ev: 'error', id: ev.data.id, message: 'Module audio natif indisponible : ' + (loadError && loadError.message) });
        return;
      }
      host.handle(ev.data);
    });
    port.start();
    port.postMessage({ type: '__audio', ev: 'hello', native: !!RtAudio });
  }
});
process.on('uncaughtException', (err) => { if (port) port.postMessage({ type: 'error', message: 'audio host: ' + (err && err.stack || err) }); });

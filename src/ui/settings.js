// Revolte — MIDI & settings page
import { h, clear, button, selectField, setLearnHandler } from './widgets.js';
import { ROLES, PAD_MODES, MIDIMIX, LP_MODES } from '../midi/midi.js';
import { saveSettings } from './store.js';
import { NATIVE_AUDIO } from './bridge.js';

export class SettingsPage {
  constructor(store, midi) {
    this.store = store; this.midi = midi;
    this.el = h('div', { class: 'page settings' });
    midi.onChange(() => { if (this.el.isConnected) this.renderPorts(); });
    store.on('learnDone', () => { setLearnHandler(null); this.render(); });
    store.on('audio', () => { if (this.audio) this.renderAudio(); });
    this.render();
  }
  save() { saveSettings(this.store.settings); }
  render() {
    const s = this.store, st = s.settings;
    const el = clear(this.el);
    this.ports = h('div', { class: 'panel ports' });
    const chk = (key, label, after) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st[key], onchange: (e) => { st[key] = e.target.checked; this.save(); if (after) after(); } }), label);
    const prefs = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, 'ENREGISTREMENT & JEU'),
      chk('recQuantize', 'Quantiser l\'enregistrement live (sinon : FEEL, garde le micro-timing en nudge)', () => s.sendRecState()),
      chk('countIn', 'Décompte d\'une mesure avant l\'enregistrement', () => s.sendRecState()),
      chk('click', 'Métronome pendant l\'enregistrement', () => s.sendRecState()),
      chk('clickAlways', 'Métronome toujours (pendant la lecture)', () => s.sendRecState()),
      chk('armFollows', 'L\'armement suit la piste sélectionnée'),
      chk('stepPreview', 'Entendre les notes posées dans la grille'),
      chk('autosave', 'Sauvegarde automatique de la session (restaurée au démarrage)'),
    );
    this.audio = h('div', { class: 'panel audio-panel' });
    const learn = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, 'MIDI LEARN'),
      h('div', { class: 'hint' }, 'Cliquez « Apprendre », cliquez un potard/fader à l\'écran (n\'importe quelle page), puis tournez un contrôle MIDI. Les assignations apprises passent avant les mappings par défaut.'),
      h('div', { class: 'row' },
        button(document.body.classList.contains('learning') ? 'Annuler' : 'Apprendre', () => this.toggleLearn(), 'primary'),
        button('Tout effacer', () => { st.midiLearn = []; this.save(); this.render(); }, 'danger')),
      h('ul', { class: 'learn-list' }, ...st.midiLearn.map((m, i) => h('li', {}, `${m.port === '*' ? 'tout port' : m.port} · CC${m.num} ch${m.ch + 1} → ${m.target.scope}${m.target.t !== undefined ? ' T' + (m.target.t + 1) : ''} ${m.target.id}`,
        button('✕', () => { st.midiLearn.splice(i, 1); this.save(); this.render(); }, 'tiny')))));
    const lk = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, 'NOVATION LAUNCHKEY MINI'),
      chk('lkDawMode', 'Activer le mode DAW au branchement (pads de session + LEDs)', () => this.midi.lkDawMode(st.lkDawMode)),
      selectField('MODE DES PADS', PAD_MODES, st.lkPadMode, (v) => { st.lkPadMode = v; this.save(); this.midi.refreshLeds(true); }),
      h('table', { class: 'map' },
        row('Clavier 25 touches', 'joue la piste sélectionnée (accords, gamme, arpège, enregistrement)'),
        row('8 potards', 'les 8 paramètres « perf » de la piste sélectionnée (page LIVE)'),
        row('Play / Record', 'lecture-stop / enregistrement'),
        row('▶ (scene launch)', 'change le mode des pads : ' + PAD_MODES.join(' → ')),
        row('Stop/Solo/Mute', 'FILL tant que maintenu'),
        row('◀ ▶ (track)', 'piste précédente / suivante'),
        row('Shift + pad', 'MUTES : solo · SCENES : mémoriser · PATTERNS : lancement immédiat'),
        row('Pads MUTES', 'haut : mute pistes 1–8 · bas : sélection piste'),
        row('Pads SCENES', '16 scènes'), row('Pads PATTERNS', 'patterns A–P de la piste sélectionnée'),
        row('Pads FX', '14 effets de performance (maintenir), FILL, THROW DELAY'),
        row('Pads STEPS', 'séquenceur pas-à-pas : 16 pas de la page jouée (lane sélectionnée)'),
        row('Pads mode Drum (ch.10)', 'jouent les 8 lanes de la piste rythmique')));
    const lp = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, 'NOVATION LAUNCHPAD MINI (MK3, X, et Mini MK1/MK2)'),
      selectField('MODE', LP_MODES, this.midi.lp.mode, (v) => { this.midi.lp.mode = v; st.lpMode = v; this.save(); this.midi.refreshLeds(true); }),
      h('table', { class: 'map' },
        row('Boutons du haut 5 à 8', 'modes SESSION · STEPS · KEYS · MIXER (sur MK3 : Session, Drums, Keys, User)'),
        row('SESSION', 'colonnes = pistes 1–8, lignes = patterns A–H (▲▼ : I–P) ; clic = lancement quantisé. Colonne de droite = scènes 1–8 (▼ : 9–16)'),
        row('STEPS', 'séquenceur de la piste sélectionnée : batterie = 8 lanes × 8 pas, mélodique = 64 pas (note = dernière note jouée). ◀▶ = page, ▲▼ = piste'),
        row('KEYS', 'jouer la piste sélectionnée : grille dans la gamme du titre (une rangée = une quarte, ▲▼ = octave) ; batterie = 8 lanes en bas'),
        row('MIXER', 'rangée 1 : mute · 2 : solo · 3 : sélection · 4 : armement · 5 : throws CUTOFF/REVERB/DELAY/DIST, FILL, lecture · 7–8 : les 14 FX de performance (maintenus)'),
        row('Colonne de droite', 'hors SESSION : sélection de la piste 1–8')),
      h('div', { class: 'hint' }, 'Le Launchpad passe en mode « Programmer » au branchement et revient à la normale quand on quitte Revolte.'));
    const mm = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, 'AKAI MIDIMIX (preset usine)'),
      chk('pickup', 'Prise de valeur (soft takeover) : un potard n\'agit qu\'après avoir croisé la valeur actuelle'),
      h('table', { class: 'map' },
        row('Tranche 1 à 8', 'piste 1 à 8'),
        row('3 potards', 'potards de tranche de la page LIVE (clic droit pour réassigner) — défaut : CUTOFF, RESO, DELAY/ENV/REVERB'),
        row('Fader', 'volume de la piste · Master : volume général'),
        row('MUTE', 'mute (quantisé selon le réglage LIVE) · LED = piste coupée'),
        row('SOLO + MUTE', 'solo de la piste'),
        row('REC ARM', 'sélectionne la piste · 2ᵉ appui (ou SOLO + REC ARM) : arme l\'enregistrement'),
        row('BANK ◀ ▶', 'scène précédente / suivante · avec SOLO : titre précédent / suivant du set')),
      h('div', { class: 'hint' }, `CC potards : ${MIDIMIX.k1.join(',')} / ${MIDIMIX.k2.join(',')} / ${MIDIMIX.k3.join(',')} · faders ${MIDIMIX.fader.join(',')} · master ${MIDIMIX.master}`));
    const kb = h('div', { class: 'panel' },
      h('div', { class: 'panel-title' }, 'CLAVIER DE L\'ORDINATEUR'),
      h('table', { class: 'map' },
        row('Espace', 'lecture / stop'), row('Ctrl+R (ou *)', 'enregistrement'), row('F1…F5', 'pages STUDIO, LIVE, SET, MIX, MIDI'),
        row('1…8 (rangée du haut)', 'sélection de piste · Maj+1…8 : mute'),
        row('Q S D F G H J K (rangée du milieu) + Z E T Y U', 'piano (positions physiques ; AZERTY ou QWERTY) · W / X : octave − / +'),
        row('Ctrl+Z / Ctrl+Y', 'annuler / rétablir'), row('Ctrl+S / Ctrl+O / Ctrl+N', 'sauver / ouvrir / nouveau projet'),
        row('Ctrl+C / Ctrl+V / Suppr', 'copier / coller / supprimer les pas sélectionnés'), row('Ctrl+A', 'sélectionner tous les pas'), row('Tab (maintenu)', 'FILL'), row('← →', 'REC armé et à l\'arrêt : déplace le curseur pas-à-pas (silence)')));
    this.mon = h('pre', { class: 'monitor' });
    el.append(h('div', { class: 'settings-cols' }, h('div', { class: 'col' }, this.audio, this.ports, mm, lp, lk), h('div', { class: 'col' }, learn, prefs, kb, h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'MONITEUR MIDI'), this.mon))));
    this.renderPorts();
    this.renderAudio();
  }
  async renderAudio(refreshDevices = false) {
    const s = this.store, st = s.settings, b = s.bridge;
    const el = clear(this.audio);
    el.append(h('div', { class: 'panel-title' }, 'AUDIO · CARTE SON', h('span', { class: 'hint' }, b.info ? `${b.info.apiName}${b.info.device ? ' · ' + b.info.device : ''} · ${b.info.sr} Hz${b.info.frameSize ? ' · buffer ' + b.info.frameSize : ''} · latence ~${b.latencyMs} ms` : 'arrêté')));
    const backends = [['webaudio', 'Web Audio (Windows standard, ~20-40 ms)']];
    if (NATIVE_AUDIO) backends.push(['ASIO', 'ASIO (carte son pro, latence minimale)'], ['WASAPI', 'WASAPI (pilote Windows direct)'], ['DS', 'DirectSound']);
    el.append(selectField('PILOTE', backends, st.audioBackend, (v) => { st.audioBackend = v; st.audioDeviceId = null; st.audioDeviceName = null; this.save(); this.renderAudio(true); }));
    if (!NATIVE_AUDIO) el.append(h('div', { class: 'hint' }, 'ASIO / WASAPI direct : disponibles dans l\'application Windows (pas dans un navigateur).'));
    if (st.audioBackend === 'webaudio') {
      el.append(selectField('LATENCE', [['interactive', 'Faible (interactive)'], ['balanced', 'Équilibrée'], ['playback', 'Sûre (lecture)']], st.latency, (v) => { st.latency = v; this.save(); }));
    } else {
      const devBox = h('div', { class: 'col' }, h('div', { class: 'hint' }, 'Recherche des périphériques…'));
      el.append(devBox);
      const sel = (label, opts, val, key) => selectField(label, opts, val, (v) => { st[key] = isNaN(+v) ? v : +v; this.save(); });
      el.append(
        sel('FRÉQUENCE', [44100, 48000, 88200, 96000].map((x) => [x, x + ' Hz']), st.audioSampleRate, 'audioSampleRate'),
        sel('BUFFER', [32, 64, 96, 128, 192, 256, 512, 1024].map((x) => [x, `${x} échantillons (${(x / (st.audioSampleRate || 48000) * 1000).toFixed(1)} ms)`]), st.audioBufferSize, 'audioBufferSize'),
        sel('SÉCURITÉ', [[1, '1 buffer d\'avance (latence mini)'], [2, '2 buffers (recommandé)'], [3, '3 buffers'], [4, '4 buffers (machine chargée)']], st.audioQueue, 'audioQueue'),
        h('div', { class: 'hint' }, st.audioBackend === 'ASIO'
          ? 'En ASIO, la taille de buffer réelle est souvent imposée par le panneau de contrôle du pilote (Focusrite, RME, Steinberg, ASIO4ALL…). Si ça craque, montez le buffer ou la sécurité.'
          : 'Si le son craque, augmentez le buffer ou la sécurité.'));
      this.fillDevices(devBox, refreshDevices);
    }
    el.append(h('div', { class: 'row' }, button('Appliquer', async () => { await window.revolte.applyAudio(); this.renderAudio(); }, 'primary'),
      st.audioBackend !== 'webaudio' ? button('Rafraîchir la liste', () => this.renderAudio(true), 'small') : null));
  }
  async fillDevices(box, force) {
    const s = this.store, st = s.settings;
    try {
      if (force || !this._devs || this._devs.api !== st.audioBackend) this._devs = await s.bridge.nativeDevices(st.audioBackend);
      const devs = this._devs.devices;
      clear(box);
      if (!devs.length) { box.append(h('div', { class: 'hint' }, `Aucun périphérique ${st.audioBackend}. Pour l'ASIO, installez le pilote de votre carte son (ou ASIO4ALL).`)); return; }
      const cur = devs.find((d) => d.id === st.audioDeviceId) || devs.find((d) => d.name === st.audioDeviceName) || devs.find((d) => d.isDefault) || devs[0];
      st.audioDeviceId = cur.id; st.audioDeviceName = cur.name;
      box.append(selectField('PÉRIPHÉRIQUE', devs.map((d) => [d.id, `${d.name} (${d.outputChannels} sorties)`]), cur.id, (v) => {
        const d = devs.find((x) => x.id === +v); st.audioDeviceId = d.id; st.audioDeviceName = d.name; st.audioFirstChannel = 0; this.save(); this.renderAudio();
      }));
      const pairs = [];
      for (let c = 0; c + 1 < cur.outputChannels; c += 2) pairs.push([c, `Sorties ${c + 1}-${c + 2}`]);
      if (pairs.length > 1) box.append(selectField('SORTIE', pairs, st.audioFirstChannel || 0, (v) => { st.audioFirstChannel = +v; this.save(); }));
      if (cur.sampleRates && cur.sampleRates.length && !cur.sampleRates.includes(st.audioSampleRate)) box.append(h('div', { class: 'hint warn' }, `Fréquences acceptées : ${cur.sampleRates.join(', ')} Hz`));
      this.save();
    } catch (e) {
      clear(box).append(h('div', { class: 'hint warn' }, 'Liste indisponible : ' + e.message));
    }
  }
  renderPorts() {
    const m = this.midi, st = this.store.settings;
    const el = clear(this.ports);
    el.append(h('div', { class: 'panel-title' }, 'PORTS MIDI', h('span', { class: 'hint' }, m.status)));
    if (!m.inputs.length) el.append(h('div', { class: 'hint' }, 'Aucune entrée MIDI détectée. Branchez la MIDImix et le Launchkey : ils sont reconnus automatiquement.'));
    for (const { port, role } of [...m.inputs.map((x) => ({ ...x, dir: 'in' })), ...m.outputs.map((x) => ({ ...x, dir: 'out' }))]) {
      const err = (m.portErrors || {})[(port.type === 'input' ? 'IN ' : 'OUT ') + port.name];
      el.append(h('div', { class: 'port-row' }, h('span', { class: 'port-dir' }, port.type === 'input' ? 'IN' : 'OUT'), h('span', { class: 'port-name' }, port.name,
        h('span', { class: err ? 'port-state err' : 'port-state' }, err ? ' — ERREUR : ' + err : port.connection === 'open' ? ' — ouvert' : ' — ' + port.connection)),
        selectField('', Object.entries(ROLES), role, (v) => { st.portRoles[port.name] = v; this.save(); m.scan(); })));
    }
    el.append(h('div', { class: 'row' }, button('Rescanner', () => m.scan(), 'small'),
      button('Copier le diagnostic MIDI', async () => {
        const txt = m.diagnostic();
        try { await navigator.clipboard.writeText(txt); this.store.toast('Diagnostic copié : collez-le dans la conversation'); }
        catch { this.mon.textContent = txt; this.store.toast('Diagnostic affiché dans le moniteur MIDI (sélectionnez et copiez)'); }
      }, 'small primary')));
    if (this.mon) this.mon.textContent = m.monitor.join('\n');
  }
  toggleLearn() {
    if (document.body.classList.contains('learning')) { setLearnHandler(null); this.midi.learnTarget = null; this.render(); return; }
    setLearnHandler((target, def) => {
      this.midi.learnTarget = { ...target, label: def ? def.label : target.id };
      this.store.toast(`Tournez maintenant un contrôle MIDI pour « ${def ? def.label : target.id} »`);
    });
    this.store.toast('MIDI Learn : cliquez un potard ou un fader à l\'écran');
    this.render();
  }
}
const row = (a, b) => h('tr', {}, h('th', {}, a), h('td', {}, b));

// Revolte — MIDI & settings page
import { h, clear, button, selectField, setLearnHandler } from './widgets.js';
import { ROLES, PAD_MODES, MIDIMIX } from '../midi/midi.js';
import { saveSettings } from './store.js';

export class SettingsPage {
  constructor(store, midi) {
    this.store = store; this.midi = midi;
    this.el = h('div', { class: 'page settings' });
    midi.onChange(() => { if (this.el.isConnected) this.renderPorts(); });
    store.on('learnDone', () => { setLearnHandler(null); this.render(); });
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
      selectField('LATENCE AUDIO (redémarrage)', [['interactive', 'Faible (interactive)'], ['balanced', 'Équilibrée'], ['playback', 'Sûre (lecture)']], st.latency, (v) => { st.latency = v; this.save(); s.toast('Pris en compte au prochain démarrage'); }),
      h('div', { class: 'hint' }, `Latence de sortie actuelle : ~${s.bridge.latencyMs} ms · fréquence 48 kHz`));
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
    el.append(h('div', { class: 'settings-cols' }, h('div', { class: 'col' }, this.ports, mm, lk), h('div', { class: 'col' }, learn, prefs, kb, h('div', { class: 'panel' }, h('div', { class: 'panel-title' }, 'MONITEUR MIDI'), this.mon))));
    this.renderPorts();
  }
  renderPorts() {
    const m = this.midi, st = this.store.settings;
    const el = clear(this.ports);
    el.append(h('div', { class: 'panel-title' }, 'PORTS MIDI', h('span', { class: 'hint' }, m.status)));
    if (!m.inputs.length) el.append(h('div', { class: 'hint' }, 'Aucune entrée MIDI détectée. Branchez la MIDImix et le Launchkey : ils sont reconnus automatiquement.'));
    for (const { port, role } of [...m.inputs.map((x) => ({ ...x, dir: 'in' })), ...m.outputs.map((x) => ({ ...x, dir: 'out' }))]) {
      el.append(h('div', { class: 'port-row' }, h('span', { class: 'port-dir' }, port.type === 'input' ? 'IN' : 'OUT'), h('span', { class: 'port-name' }, port.name),
        selectField('', Object.entries(ROLES), role, (v) => { st.portRoles[port.name] = v; this.save(); m.scan(); })));
    }
    el.append(button('Rescanner', () => m.scan(), 'small'));
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

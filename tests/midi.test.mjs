// Port name detection (Windows / macOS names of the supported controllers)
import assert from 'node:assert/strict';
import { guessRole } from '../src/midi/midi.js';
const cases = {
  'MIDI Mix': 'midimix', 'MIDIMIX': 'midimix', 'Akai MIDImix': 'midimix',
  'LPMiniMK3 MIDI': 'launchpad', 'MIDIIN2 (LPMiniMK3 MIDI)': 'launchpad', 'MIDIOUT2 (LPMiniMK3 MIDI)': 'launchpad',
  'Launchpad Mini MK3 LPMiniMK3 MIDI Out': 'launchpad', 'Launchpad Mini': 'launchpad', 'LPX MIDI': 'launchpad',
  'Launchkey Mini MK3 MIDI': 'lk-keys', 'MIDIIN2 (Launchkey Mini MK3 MIDI)': 'lk-daw', 'LKMK3 MIDI': 'lk-keys', 'MIDIIN2 (LKMK3 MIDI)': 'lk-daw',
  'Launchkey Mini MK3 DAW Port': 'lk-daw', 'Arturia KeyStep 37': 'keys',
};
for (const [name, role] of Object.entries(cases)) assert.equal(guessRole(name), role, name);
console.log('all midi tests passed');

# REVOLTE — groovebox 8 pistes pour Windows

Revolte est une groovebox logicielle autonome pour Windows, pensée comme une machine et pas comme un DAW.
Elle compte **8 pistes : 2 synthés, 2 basses, 3 rythmes et 1 sampler**. Le séquenceur s'inspire du firmware
[Skiff](https://github.com/illuminus5/skiff) (M-VAVE FM-1) : probabilités, conditions de déclenchement, ratchets,
p-locks, listes de patterns, scènes, couche de performance… Tout se pilote depuis une **Akai MIDImix** et un
**Novation Launchkey Mini**.

> Revolte reprend les *fonctionnalités* de Skiff mais pas son code : tout est écrit de zéro (moteur audio en
> JavaScript dans un AudioWorklet, interface Electron).

---

## Installer

**Télécharger** : l'onglet *Actions* du dépôt (workflow *Build Windows*) produit à chaque push :

- `Revolte-Setup-x.y.z.exe` : un installeur classique (choix du dossier, raccourcis) ;
- `Revolte-Portable-x.y.z.exe` : un exécutable portable, sans installation.

Un tag `v1.0.0` publie aussi ces fichiers dans une *Release*. L'exécutable n'est pas signé : à la première ouverture,
Windows SmartScreen demande « Informations complémentaires → Exécuter quand même ».

**Depuis les sources** (Node.js 20+ requis) :

```bat
npm install
npm start            :: lance l'application
npm test             :: tests du moteur audio et du modèle
npm run dist         :: construit l'installeur et le portable dans dist\
```

Branchez la MIDImix et le Launchkey **avant ou après** le lancement : ils sont reconnus automatiquement.

---

## Les 8 pistes

| # | Piste | Type | Son par défaut |
|---|-------|------|----------------|
| 1 | SYNTH 1 | polyphonique (8 voix) | Stab Chord |
| 2 | SYNTH 2 | polyphonique | Pluck KS |
| 3 | BASSE 1 | mono, slide/accent | Acid 303 |
| 4 | BASSE 2 | mono/legato | Sub Bass |
| 5 | RYTHME 1 | kit de 8 lanes | 909 Techno |
| 6 | RYTHME 2 | kit de 8 lanes | 808 Classic |
| 7 | RYTHME 3 | kit de 8 lanes | Perc Tribal |
| 8 | SAMPLE | sampler (one-shot, gate, loop, slices) | Sampler |

**Moteurs mélodiques** (utilisables sur toutes les pistes mélodiques) :
- **ANALOG** : 2 oscillateurs (SAW, SQR à PW, TRI, SINE, SUPERSAW 7 voix), sub, bruit ;
- **FM** : 4 opérateurs, 8 algorithmes, feedback, enveloppe par opérateur ;
- **PLUCK** : cordes pincées Karplus-Strong ;
- **SAMPLE** : WAV, MP3, OGG, FLAC ou AIFF, joué en hauteur ou découpé en 2 à 32 slices, reverse.

Tous partagent la même structure de voix :
- filtre LP, BP, HP 12 dB ou **LP4** (ladder 24 dB non linéaire, idéal pour l'acid) avec drive ;
- enveloppe AMP et **ENV 2** (vers pitch, cutoff et shape) ;
- **LFO** à 6 formes, libre ou **synchronisé au tempo** (4 mesures à 1/32, ternaires), redéclenché ou non ;
- **matrice de modulation** à 4 slots. Sources : LFO, ENV2, VEL, KEY, RAND, MODW, S&H, SLEW. Destinations : pitch,
  cutoff, réso, shape, amp, pan, vitesse/profondeur du LFO, drive, attack, decay ;
- modes de voix **POLY / MONO / LEGATO / UNISON**, glide, detune, spread stéréo, octave.

**Kits de batterie** : 8 lanes par piste. Chaque lane a son modèle synthétisé (KICK, KICK 909, SNARE, SNARE 909,
CLAP, HAT C, HAT O, TOM, RIM, COWBELL, CLAVE, CYMBAL, SHAKER, ZAP) ou un **SAMPLE**. Chaque lane règle aussi son
tune, decay, tone, snap, niveau, pan et groupe de **choke** (le charley ouvert est coupé par le fermé). Le kit entier
a un decay, un tune, un filtre passe-bas/passe-haut et un drive. Six kits d'usine sont fournis.

**Sons d'usine** : 25 sons classés par type (BASS, LEAD, PAD, KEYS, PLUCK, FX), avec un filtre par type, des
favoris (★) et des sons utilisateur enregistrés dans le projet.

---

## Les pages

### STUDIO (F1) : composer
- **Liste des pistes** à gauche : nom (double-clic pour renommer), son, mute, solo, armement, VU-mètre, pattern en cours.
- **Patterns A à P** : 16 par piste. Clic : jouer/éditer. Clic droit : copier, coller, dupliquer, effacer.
- **Réglages du pattern** :
  - **PAS** de 1 à **128** (8 mesures en 1/16) ; on peut aussi tirer la barre de fin dans la grille ;
  - **RES** : 1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4T, 1/4, 1/2, 1/1, 2 mesures ;
  - **SWING** : 50 à 75 % ;
  - **DIR** : FWD, RVRS, PING, RAND ;
  - **GATE** : 5 à 200 %.
- **Piano roll** (pistes mélodiques) :
  - clic pour poser une note, glisser pour régler sa longueur (de 0,05 à 128 pas, au-delà du pas suivant, les notes
    se chevauchent) ;
  - glisser une note pour la déplacer, clic droit ou double-clic pour la supprimer ;
  - jusqu'à 4 notes par pas (accords), chacune avec sa longueur et sa vélocité ;
  - Maj+glisser pour sélectionner, Ctrl+molette pour zoomer ;
  - les notes de la gamme du titre sont surlignées.
- **Grille rythmique** (pistes de batterie) : clic gauche pour poser ou retirer des coups (glisser peint), clic droit
  pour sélectionner. Sur le nom d'une lane : clic pour l'écouter et la sélectionner, clic droit pour la **muter**.
- **Lane d'édition** sous la grille. Elle se peint à la souris et s'applique à toute la sélection : vélocité,
  **probabilité**, **condition**, **ratchet/flam**, **nudge**, accent, slide, longueur, et n'importe quel **p-lock**.
- **Inspecteur de pas** (à droite) : notes de l'accord, vélocité, PROBA %, CONDITION, RATCHET ×1–×4 ou FLAM,
  NUDGE (−32 à +31 64ᵉ de pas), ACCENT, SLIDE, liste des verrous. Toute la sélection est éditée d'un coup.
- **P-LOCK** : activez le bouton, sélectionnez des pas et tournez n'importe quel potard du son. La valeur est verrouillée
  sur ces pas (Elektron/Skiff). Pendant l'enregistrement, tourner un potard enregistre aussi le mouvement en p-locks.
- **Outils** : effacer, décaler ◀ ▶, inverser, ×2, ½, **euclidien**, **aléatoire** (dans la gamme), humaniser,
  transposer, **TAKE** (garde la dernière boucle jouée au clavier, même sans avoir enregistré).
- **Onglets du bas** :
  - **SON** : tous les paramètres du moteur visibles, groupés, sans menu ;
  - **ARP · ACCORDS · GAMME** : arpégiateur 14 modes (UP, DOWN, UPDN, DNUP, RAND, ORDER, CHORD, CONV, DIV, PINKY,
    THUMB, UP+OCT, RANDWALK) avec vitesse, octaves, gate, chance et hold ; accords au clavier (9 accords, dont SCALE
    en diatonique), 5 voicings, **strum** ; quantisation sur la gamme ; transposition ;
  - **MIX PISTE**.

### LIVE (F2) : jouer, sans plonger dans les menus
- **8 tranches**, une par piste :
  - 16 pads de patterns, lancés sur la quantisation choisie (Maj+clic : immédiat) ;
  - **3 potards** (ceux de la MIDImix ; clic droit pour réassigner) ;
  - fader de volume avec VU-mètre ;
  - gros **MUTE** (Alt maintenu : coupure momentanée), SOLO, SEL, armement.
- **16 scènes** : pattern et mute de chaque piste. Maj+clic pour mémoriser, clic droit pour renommer.
- **Quantisation de lancement** (LOOP, BAR, BEAT, NOW) et **quantisation des mutes** (mutes « mis en scène »).
- **8 grands potards de la piste sélectionnée** (= les 8 potards du Launchkey), plus ses envois delay/reverb, sa
  distorsion, son pan, l'arpège et la transposition.
- **MASTER** : filtre DJ (gauche passe-bas, droite passe-haut), réso, crush, saturation, THROW, profondeur des FX,
  feedback du delay, taille de la reverb, volume.
- **14 FX de performance** sur le master. On les maintient pour les entendre, Maj+clic les verrouille :
  REPEAT 1/8, 1/16 et 1/32, REVERSE, LPF SWEEP, HPF SWEEP, TAPE STOP, FREEZE, OCT UP, OCT DOWN, GATE, DUB, FLANGE,
  VINYL.
- **Throws** CUTOFF, REVERB, DELAY et DIST : ils reviennent en douceur sur une mesure au relâchement.
- **FILL** (maintenu) : active les pas conditionnés FILL / !FILL.

### SET · SONG (F3) : morceaux et set
- **Setlist** : tous les titres du projet. Ajouter, dupliquer, renommer, réordonner, supprimer. Chaque titre a ses
  sons, patterns, scènes, mix, effets, tempo et gamme.
- **Enchaînement de set** : cliquer un titre pendant la lecture le lance **à la mesure suivante**. Sur la MIDImix :
  SOLO + BANK.
- **Mode SONG** (comme Skiff) : chaque piste descend sa **liste de 16 entrées** (pattern ou silence × répétitions).
  Trois modes : **OFF** (boucle), **ON** (enchaîne en boucle) et **UNE FOIS** (s'arrête à la fin). « Jouer d'ici »
  démarre depuis une colonne. Un assistant construit les listes à partir d'une suite de scènes.
- **Éditeur de scènes** : clic pour changer le pattern, clic droit pour le mute ; « = » garde le pattern courant.

### MIX · FX (F4)
- Par piste :
  - volume, pan ;
  - envois **chorus**, **delay** et **reverb** ;
  - **distorsion insert** SOFT, HARD, FOLD, CRUSH ou FUZZ, avec quantité et tonalité ;
  - **DUCK** (sidechain déclenché par une autre piste ; pour une piste rythmique, par sa lane 1, le kick).
- **Bus** :
  - chorus en mode CHORUS, FLANGER ou PHASER ;
  - delay MONO, STEREO ou PING-PONG, synchronisé (1/32 à 1/1, pointés, ternaires), avec feedback, couleur et
    largeur ;
  - reverb ROOM, HALL ou PLATE, avec taille, amorti, pré-delay et retour.
- **Chaîne master** : filtre DJ, crush, saturation, **EQ 3 bandes**, **compresseur** (seuil, ratio, attaque, relâche,
  mix parallèle), largeur stéréo, volume, **limiteur**. VU-mètres et réduction de gain.

### Audio : ASIO, WASAPI, DirectSound
Dans **MIDI · RÉGLAGES → AUDIO · CARTE SON** :

| Pilote | Latence typique | Usage |
|---|---|---|
| **ASIO** | 3 à 10 ms | cartes son pro (Focusrite, RME, Steinberg, MOTU, Behringer…), ou ASIO4ALL. **Recommandé pour le live.** |
| WASAPI | 10 à 20 ms | carte son intégrée sans pilote ASIO |
| DirectSound | 30 ms et plus | dépannage |
| Web Audio | 20 à 40 ms | mode par défaut, fonctionne partout |

Choisissez le pilote, le périphérique, la paire de sorties (1-2, 3-4…), la fréquence, la taille de buffer et la
« sécurité » (nombre de buffers d'avance), puis cliquez **Appliquer**. Le réglage est mémorisé.

En ASIO, le moteur tourne dans un processus audio dédié, à priorité haute, qui écrit directement dans le pilote
de la carte. Sa latence se calcule ainsi : (sécurité + 1) × buffer. Avec 64 échantillons à 48 kHz et une sécurité
de 2, on obtient environ 4 ms. Le panneau de contrôle du pilote ASIO peut imposer sa propre taille de buffer.

Si le son craque, augmentez le buffer ou la sécurité. Si le pilote ne s'ouvre pas, Revolte repasse
automatiquement sur Web Audio et l'indique.

### MIDI · RÉGLAGES (F5)
- Ports MIDI détectés et leur rôle (modifiable si la détection automatique se trompe).
- **MIDI Learn** : cliquez « Apprendre », puis un potard ou un fader à l'écran, puis tournez un contrôle MIDI. Ça
  marche avec n'importe quel contrôleur.
- Réglages d'enregistrement : quantisation ou FEEL, décompte, métronome, armement qui suit la sélection.
- Latence audio, sauvegarde automatique.
- Moniteur MIDI et aide-mémoire de tous les mappings.

---

## Séquenceur : récapitulatif

| Fonction | Revolte |
|---|---|
| Longueur | 1 à **128 pas** par pattern (8 mesures en 1/16), longueur propre à chaque piste (polyrythmies) |
| Résolution | 1/32 à 2 mesures par pas, ternaires |
| Notes | accords de 4 notes, longueur de chaque note de 0,05 à 128 pas, chevauchements |
| Par pas | vélocité, accent, slide, **probabilité 0–100 %**, **ratchet ×1–4**, **FLAM**, **nudge** ±32/64 |
| Conditions | TOUJOURS, FILL, !FILL, 1ER, !1ER, PRE, !PRE, 1:2, 2:2, 1:3…3:3, 1:4…4:4, 1:8, 8:8 |
| Global pattern | swing 50–75 %, gate, direction FWD, RVRS, PING ou RAND |
| P-locks | n'importe quel paramètre du son, par pas (et par lane de batterie) |
| Enregistrement | live avec overdub, quantisé ou **FEEL** (garde le micro-timing), **décompte**, **métronome**, **pas-à-pas** (à l'arrêt : les touches enfoncées ensemble forment un accord, ← → déplacent le curseur), **TAKE** a posteriori, mouvements de potards enregistrés en p-locks |
| Patterns | 16 par piste (A–P), copier/coller/dupliquer |
| Lancement | LOOP, BAR, BEAT ou NOW ; mutes mis en scène sur les mêmes points |
| Song | listes de 16 entrées par piste, répétitions, silences, OFF/ON/UNE FOIS, démarrage depuis une entrée |
| Scènes | 16 par titre (pattern + mute de chaque piste) |
| Outils | effacer, décaler, inverser, doubler, moitié, euclidien, aléatoire en gamme, humaniser, transposer, copier/coller de pas |
| Annuler | 60 niveaux (Ctrl+Z / Ctrl+Y) |

---

## Contrôleurs

### Akai MIDImix (preset d'usine, aucune configuration)

| Contrôle | Action |
|---|---|
| Tranches 1 à 8 | pistes 1 à 8 |
| 3 potards | potards de tranche de la page LIVE. Par défaut : CUTOFF, RESO, et DELAY (synthés), ENV>CUT (basses) ou DECAY KIT et REVERB (rythmes). Réassignables (clic droit sur le potard en LIVE) |
| Faders | volume de chaque piste ; **Master** : volume général |
| MUTE | mute de la piste (LED allumée = coupée), quantisé selon le réglage LIVE |
| SOLO + MUTE | solo de la piste |
| REC ARM | sélectionne la piste ; 2ᵉ appui (ou SOLO + REC ARM) : arme l'enregistrement |
| BANK ◀ ▶ | scène précédente / suivante ; **SOLO + BANK** : titre précédent / suivant du set |

Option « prise de valeur » (soft takeover) dans MIDI · RÉGLAGES, pour éviter les sauts de valeur en changeant de
titre.

### Novation Launchkey Mini (MK3, et MK4 compatible)

Revolte active le **mode DAW** du Launchkey (pads de session et LEDs couleur). Le port « DAW » (`MIDIIN2 (…)` sous
Windows) est reconnu automatiquement.

| Contrôle | Action |
|---|---|
| Clavier 25 touches | joue la piste sélectionnée (accords, gamme, arpège, enregistrement live ou pas-à-pas) ; sur une piste rythmique, C3 à G3 jouent les lanes 1 à 8 |
| 8 potards | les 8 paramètres de performance de la piste sélectionnée (CUTOFF, RESO, ENV, DECAY…) |
| Play / Record | lecture-stop / enregistrement |
| Bouton ▶ (scene launch) | change le **mode des pads** : MUTES → SCENES → PATTERNS → FX → STEPS (Shift : sens inverse) |
| Stop/Solo/Mute | FILL tant qu'il est maintenu |
| ◀ ▶ (track) | piste précédente / suivante |
| Molette de modulation | source MODW de la matrice (piste sélectionnée) |

| Mode des pads | Rangée du haut | Rangée du bas |
|---|---|---|
| **MUTES** | mute pistes 1–8 (Shift : solo) | sélection piste 1–8 |
| **SCENES** | scènes 1–8 (Shift : mémoriser) | scènes 9–16 |
| **PATTERNS** | patterns A–H de la piste sélectionnée | patterns I–P (Shift : lancement immédiat) |
| **FX** | 8 premiers FX de performance (maintenus) | 6 FX suivants, FILL, THROW DELAY |
| **STEPS** | pas 1–8 de la page jouée | pas 9–16 (piste sélectionnée, lane sélectionnée pour la batterie) |

En mode Drum du Launchkey (canal 10), les pads jouent les 8 lanes de la piste rythmique sélectionnée.

### Clavier de l'ordinateur
- **Espace** : lecture/stop. **Ctrl+R** : enregistrement. **Tab** maintenu : FILL. **F1 à F5** : pages.
- **1 à 8** : sélection de piste ; **Maj+1 à 8** : mute.
- Piano sur les positions physiques (AZERTY ou QWERTY) : **Q S D F G H J K L M** pour les blanches,
  **Z E T Y U O P** pour les noires. **W / X** : octave − / +.
- **Ctrl+Z/Y** : annuler/rétablir. **Ctrl+S/O/N** : sauver/ouvrir/nouveau. **Ctrl+C/V**, **Suppr**, **Ctrl+A** :
  édition des pas.
- **F11** : plein écran.

---

## Projets et sets

- Un **projet** (`.rvlt`) contient un **set complet** : plusieurs titres, chacun avec ses 8 pistes, patterns, scènes,
  listes, mix et effets. Il contient aussi les **samples** (intégrés au fichier, le projet reste transportable), les
  sons utilisateur et les favoris.
- **Sauver** (Ctrl+S) ou **Sauver sous**. Par défaut dans `Documents\Revolte`. Une copie `.bak` de la version
  précédente est gardée.
- **Sauvegarde automatique** de la session toutes les 20 s. Elle est restaurée au démarrage, même après un plantage.
- Double-cliquer un `.rvlt` dans l'Explorateur l'ouvre dans Revolte. Glisser un `.rvlt` sur la fenêtre aussi.
- Glisser un **fichier audio** sur la fenêtre le charge sur la piste sélectionnée : sampler, ou lane sélectionnée
  d'un kit.
- **⏺ WAV** : enregistre la sortie master en temps réel dans un fichier WAV.

---

## Architecture

```
electron/main.cjs      fenêtre, dialogues natifs, permissions WebMIDI, association .rvlt
electron/preload.cjs   pont sécurisé UI <-> système de fichiers
electron/audio-host*.mjs  processus audio natif : même moteur, sortie ASIO/WASAPI/DirectSound (RtAudio via audify)
src/engine/            moteur audio temps réel (AudioWorklet, JS pur, testable sous Node)
  core.js              séquenceur (timing à l'échantillon), mixage, sends, enregistrement, arpégiateur
  synth.js             voix ANALOG / FM / PLUCK / SAMPLE, filtres SVF + ladder, matrice de mod
  drums.js             kits de 8 lanes, 15 modèles synthétisés + samples, choke
  fx.js                chorus/flanger/phaser, delay, reverb, FX de performance, chaîne master
src/shared/            paramètres, presets, modèle de projet (partagés UI + moteur)
src/ui/                pages STUDIO, LIVE, SET, MIX, MIDI ; grille canvas ; état et annulation
src/midi/midi.js       MIDImix, Launchkey (mode DAW, LEDs), clavier générique, MIDI Learn
tests/                 tests du moteur (rendu hors ligne, conditions, ratchets, song mode, rec…) et du modèle
```

Le séquenceur tourne **dans le thread audio**, donc le timing ne dépend pas de l'interface : les évènements sont
calés sur des blocs de 16 échantillons (0,33 ms à 48 kHz). Le rendu complet du projet de démo consomme environ 7 %
d'un cœur.

## Différences avec Skiff

Revolte reprend l'essentiel du séquenceur et de la performance de Skiff, avec **8 pistes au lieu de 6** et
**128 pas au lieu de 64**. Ces fonctions de Skiff ne sont pas reprises :
- FREE TAKE (détection de tempo d'un jeu libre) ;
- chaînes de patterns (remplacées par les patterns de 128 pas) ;
- son propre à une entrée de liste ;
- chord follow ;
- MIDI clock et notes en sortie ;
- certains moteurs propres au FM-1 (GRAIN, PHYS, VOICE, WHEEL…).

// weapons.js — weapon definitions plus the recoil/spread model.
// One table drives the buy menu, the HUD, the player and the bots, so the
// screenshots and the code can never disagree about a gun.
export const WEAPONS = {
  nova: {
    id: 'nova', name: 'NOVA-9', cls: 'ASSAULT RIFLE', price: 2700, icon: '▸',
    flavour: 'Starfall armoury standard. Steady hands, clean lines.',
    dmg: 27, headMult: 3.2, rpm: 600, mag: 30, reserve: 90, auto: true,
    spread: 0.0075, moveSpread: 0.028, bloomPerShot: 0.0042, bloomMax: 0.05,
    recoil: 0.0105, recoilX: 0.003, reload: 2.2, range: 60, falloff: 0.55,
    sound: 'nova', tracer: 0xffc46a,
  },
  zenith: {
    id: 'zenith', name: 'ZENITH DMR', cls: 'SNIPER · DMR', price: 4750, icon: '◎',
    flavour: 'One round, one star. Scope in and the mountain holds still.',
    dmg: 88, headMult: 4.0, rpm: 48, mag: 5, reserve: 15, auto: false,
    spread: 0.0006, moveSpread: 0.06, bloomPerShot: 0.03, bloomMax: 0.06,
    recoil: 0.038, recoilX: 0.006, reload: 3.4, range: 90, falloff: 0.85,
    sound: 'zenith', tracer: 0x9fd0ff, scoped: true,
  },
  comet: {
    id: 'comet', name: 'COMET SMG', cls: 'SMG', price: 1500, icon: '✦',
    flavour: 'Close corners, fast hands. Burns bright, burns through mags.',
    dmg: 22, headMult: 3.0, rpm: 800, mag: 32, reserve: 96, auto: true,
    spread: 0.013, moveSpread: 0.02, bloomPerShot: 0.0038, bloomMax: 0.055,
    recoil: 0.0075, recoilX: 0.004, reload: 1.9, range: 38, falloff: 0.4,
    sound: 'comet', tracer: 0xffe9a8,
  },
  eclipse: {
    id: 'eclipse', name: 'ECLIPSE', cls: 'SIDEARM', price: 500, icon: '◐',
    flavour: 'The sidearm every observer carries. Dark, sure, always there.',
    dmg: 30, headMult: 3.5, rpm: 350, mag: 12, reserve: 48, auto: false,
    spread: 0.006, moveSpread: 0.024, bloomPerShot: 0.006, bloomMax: 0.045,
    recoil: 0.013, recoilX: 0.004, reload: 1.6, range: 45, falloff: 0.5,
    sound: 'eclipse', tracer: 0xffd76a,
  },
  ridge: {
    id: 'ridge', name: 'RIDGE BLADE', cls: 'BLADE', price: 0, icon: '🗡',
    flavour: 'A surveyor\'s blade, kept sharp for quiet work.',
    dmg: 45, headMult: 1.0, rpm: 90, mag: Infinity, reserve: Infinity, auto: false,
    spread: 0, moveSpread: 0, bloomPerShot: 0, bloomMax: 0,
    recoil: 0, recoilX: 0, reload: 0, range: 1.7, falloff: 1,
    sound: 'melee', tracer: 0xffffff, melee: true,
  },
};

export const NADES = {
  frag: { id: 'frag', name: 'FRAG CHARGE', price: 300, icon: '✸', flavour: 'Shrapnel bloom. Clears a held corner.', fuse: 1.6, radius: 8, dmg: 110 },
  flash: { id: 'flash', name: 'SUNBURST', price: 200, icon: '☀', flavour: 'A white noon in a tin shell. Look away.', fuse: 1.4, radius: 22 },
  smoke: { id: 'smoke', name: 'SMOKE VEIL', price: 300, icon: '☁', flavour: 'Cold fog that eats sightlines — and bot eyes.', fuse: 1.2, radius: 4.5, life: 15 },
  flare: { id: 'flare', name: 'SIGNAL FLARE', price: 150, icon: '🔥', flavour: 'Amber fire that hangs in the twilight.', fuse: 0.9, radius: 3, life: 14 },
};

export const ARMOUR_PRICE = 650;
export const KIT_PRICE = 400;

// Recoil/spread: firing while moving is punished twice — spread grows with
// speed, and bloom stacks per shot and only decays while the trigger rests.
// Crouching and standing still are the accurate stances.
export function currentSpread(w, speed, crouch, scoped, bloom) {
  let s = w.spread + bloom;
  if (scoped && w.scoped) s *= 0.35;
  s += w.moveSpread * Math.min(1, speed / 5.2);
  if (crouch) s *= 0.62;
  return s;
}

export function damageAtRange(w, dist, head) {
  const f = dist <= 12 ? 1 : 1 - (1 - w.falloff) * Math.min(1, (dist - 12) / (w.range - 12));
  let d = w.dmg * Math.max(w.falloff, f);
  if (head) d *= w.headMult;
  return d;
}

// Armour absorbs 50% of damage, losing armour points at half the absorbed rate.
export function applyArmour(hp, armour, dmg) {
  if (armour <= 0) return [hp - dmg, 0];
  const absorbed = Math.min(armour, dmg * 0.5);
  return [hp - (dmg - absorbed), armour - absorbed * 0.5];
}

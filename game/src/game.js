// game.js — the simulation and the rendering, kept apart. step() advances
// the store at a fixed 60 Hz; render() draws the current state. Hot loops
// reuse pooled tracers, particles and scratch vectors — nothing is
// allocated per frame. Systems: rounds, economy, bots, grenades, hitboxes,
// recoil/spread and HUD all meet here through one store (S).
import * as THREE from 'three';
import { S, TEAM_A, TEAM_B, PLANT_TIME, DEFUSE_TIME,
  attackers, defenders, aliveCount, playerAttacks } from './store.js';
import { buildMap, collideCircle, groundHeightAt, SITES, ROUTES } from './map.js';
import { WEAPONS, NADES, ARMOUR_PRICE, KIT_PRICE, currentSpread, damageAtRange, applyArmour } from './weapons.js';
import { traceShot } from './hitboxes.js';
import { updateGrenades, throwGrenade, canSee } from './grenades.js';
import { updateBots, assignRoutes, botShoot, hearNoise } from './bots.js';
import { startRound, openLive, updateRounds, endRound, plantCharge, defuseCharge,
  dropCharge, pickupCharge, awardKill, siteAt, ECON } from './rounds.js';
import { hudInit, updateHud, setBuyOpen, hudBuyOpen, renderScoreboard, showBanner,
  showToast, showHitmarker, spawnDmgNum, addKillfeed, renderRadio } from './hud.js';
import * as snd from './audio.js';

const STEP = 1 / 60;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const UP_Y = new THREE.Vector3(0, 1, 0);
// Shared particle colours: no colour objects are allocated on hits.
const COL_SPARK = new THREE.Color(0xffc46a);
const COL_GOLD = new THREE.Color(0xffd76a);
const COL_DEBRIS = new THREE.Color(0x8a93b8);
const COL_FIRE = new THREE.Color(0xff9a2e);
const COL_FLASH = new THREE.Color(0xffffff);
const COL_SMOKE = new THREE.Color(0xb8bfd4);
const COL_FLARE = new THREE.Color(0xff7a2e);

export const input = {
  fwd: false, back: false, left: false, right: false, jump: false,
  crouch: false, walk: false, fire: false, fireEdge: false, aim: false,
  use: false, lookDX: 0, lookDY: 0, locked: false,
};

let renderer, scene, camera, mapRefs, colliders;
let viewmodel, muzzleFlash, muzzleLight;
let tracerPool = [], particleSys, smokeMeshes = [], flareLights = [], flareMeshes = [];
let chargeMesh, chargeLight;
let botFlash = new Map();
let walkCycle = 0, bobY = 0, recoilKick = 0, stepT = 0;
let acc = 0, lastT = 0, running = false, frameNo = 0;
let deathCamY = 0;
let plantedBeepT = 0;

const PARTICLE_MAX = 420;
let pGeo, pPos, pVel, pLife, pCol, pMat;

function makeBotMesh(team) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: team === TEAM_A ? 0x3d4a6e : 0x4a3a52, roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: team === TEAM_A ? 0xffb454 : 0x6ec3ff, emissive: team === TEAM_A ? 0xff8f2e : 0x2a7fd8, emissiveIntensity: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 4, 10), suit);
  body.position.y = 1.05; g.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.5, 0.36), trim);
  vest.position.y = 1.18; g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), skin);
  head.position.y = 1.72; g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.06), trim);
  visor.position.set(0, 1.74, 0.21); g.add(visor);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), suit);
  helm.position.y = 1.74; g.add(helm);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), new THREE.MeshStandardMaterial({ color: 0x1c2236, roughness: 0.5, metalness: 0.6 }));
  gun.position.set(0.26, 1.32, 0.34); g.add(gun);
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 3, 8), suit);
  legL.position.set(-0.14, 0.42, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  g.userData = { body, head, gun, legL, legR };
  return g;
}

function buildViewmodel() {
  viewmodel = new THREE.Group();
  camera.add(viewmodel);
  viewmodel.position.set(0.32, -0.3, -0.62);
  rebuildViewmodel();
}

function rebuildViewmodel() {
  while (viewmodel.children.length) viewmodel.remove(viewmodel.children[0]);
  const dark = new THREE.MeshStandardMaterial({ color: 0x232a44, roughness: 0.45, metalness: 0.65 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.85 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xffb454, emissive: 0xff8f2e, emissiveIntensity: 0.5 });
  const p = S.player;
  const add = (geo, mat, x, y, z, rx) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (rx) m.rotation.x = rx; viewmodel.add(m); return m;
  };
  if (p.heldNade) {
    add(new THREE.SphereGeometry(0.075, 12, 10), dark, 0, 0, -0.1);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 8), accent, 0, 0.08, -0.1);
  } else if (p.slot === 'ridge') {
    add(new THREE.BoxGeometry(0.03, 0.02, 0.5), new THREE.MeshStandardMaterial({ color: 0xd8dce8, metalness: 0.9, roughness: 0.25 }), 0, 0.02, -0.3);
    add(new THREE.BoxGeometry(0.05, 0.07, 0.12), grip, 0, 0, 0.02);
  } else if (p.slot === 'zenith') {
    add(new THREE.BoxGeometry(0.09, 0.11, 0.62), dark, 0, 0, -0.18);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 10), dark, 0, 0.02, -0.6, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10), dark, 0, 0.09, -0.2, Math.PI / 2);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.08), grip, 0, -0.1, 0.05);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.1), accent, 0, 0.06, -0.42);
  } else if (p.slot === 'eclipse') {
    add(new THREE.BoxGeometry(0.08, 0.1, 0.3), dark, 0, 0, -0.12);
    add(new THREE.BoxGeometry(0.07, 0.16, 0.09), grip, 0, -0.11, 0.02);
    add(new THREE.BoxGeometry(0.02, 0.02, 0.06), accent, 0, 0.06, -0.24);
  } else {
    add(new THREE.BoxGeometry(0.1, 0.12, 0.55), dark, 0, 0, -0.15);
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 10), dark, 0, 0.02, -0.55, Math.PI / 2);
    add(new THREE.BoxGeometry(0.07, 0.16, 0.1), grip, 0, -0.12, -0.05);
    add(new THREE.BoxGeometry(0.07, 0.14, 0.09), dark, 0, -0.11, -0.28);
    add(new THREE.BoxGeometry(0.02, 0.03, 0.12), accent, 0, 0.075, -0.3);
  }
  muzzleFlash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  muzzleFlash.position.set(0, 0.02, p.slot === 'zenith' ? -0.88 : -0.72);
  viewmodel.add(muzzleFlash);
}

function initParticles() {
  pGeo = new THREE.BufferGeometry();
  pPos = new Float32Array(PARTICLE_MAX * 3);
  pCol = new Float32Array(PARTICLE_MAX * 3);
  pVel = new Float32Array(PARTICLE_MAX * 3);
  pLife = new Float32Array(PARTICLE_MAX);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  particleSys = new THREE.Points(pGeo, pMat);
  particleSys.frustumCulled = false;
  scene.add(particleSys);
  for (let i = 0; i < PARTICLE_MAX; i++) { pPos[i * 3 + 1] = -50; }
}

let pNext = 0;
function spawnParticles(x, y, z, n, color, speed, life, up) {
  _v1.set(color.r, color.g, color.b);
  for (let k = 0; k < n; k++) {
    const i = pNext; pNext = (pNext + 1) % PARTICLE_MAX;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = (S.rng() - 0.5) * speed;
    pVel[i * 3 + 1] = S.rng() * speed * (up || 0.6);
    pVel[i * 3 + 2] = (S.rng() - 0.5) * speed;
    pCol[i * 3] = _v1.x; pCol[i * 3 + 1] = _v1.y; pCol[i * 3 + 2] = _v1.z;
    pLife[i] = life * (0.6 + S.rng() * 0.7);
  }
}

function updateParticles(dt) {
  for (let i = 0; i < PARTICLE_MAX; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -50; continue; }
    pVel[i * 3 + 1] -= 5 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.05) pPos[i * 3 + 1] = 0.05;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

function initTracers() {
  for (let i = 0; i < 26; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false; line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
}
let tracerNext = 0;
function spawnTracer(ax, ay, az, bx, by, bz, color) {
  const t = tracerPool[tracerNext]; tracerNext = (tracerNext + 1) % tracerPool.length;
  const pos = t.line.geometry.attributes.position.array;
  pos[0] = ax; pos[1] = ay; pos[2] = az; pos[3] = bx; pos[4] = by; pos[5] = bz;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.9;
  t.line.visible = true; t.life = 0.07;
}
function updateTracers(dt) {
  for (const t of tracerPool) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
    if (t.life <= 0) t.line.visible = false;
  }
}

function initSmokeAndFlares() {
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa3c0, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), smokeMat.clone());
    m.visible = false; scene.add(m); smokeMeshes.push(m);
  }
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xff7a2e, 0, 16, 1.6);
    scene.add(l); flareLights.push(l);
    // the flame itself: a bright core cone inside a soft additive halo,
    // flickering with the light so a burning flare reads at a glance
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    core.position.y = 0.4; g.add(core);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff7a2e, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = 0.45; g.add(halo);
    g.visible = false; scene.add(g); flareMeshes.push(g);
  }
}

function syncSmokeFlares() {
  let mi = 0;
  for (const sm of S.smokes) {
    for (let k = 0; k < 5 && mi < smokeMeshes.length; k++, mi++) {
      const m = smokeMeshes[mi];
      const a = sm.seed + k * 1.7 + S.time * 0.12;
      m.position.set(sm.x + Math.cos(a) * 1.6, sm.y + Math.sin(a * 1.3) * 0.7, sm.z + Math.sin(a) * 1.6);
      const sc = 1.05 + 0.4 * Math.sin(a * 2.1);
      m.scale.set(sc, sc * 0.85, sc);
      m.material.opacity = Math.min(0.5, sm.life * 0.1 + 0.2);
      m.visible = true;
    }
  }
  for (; mi < smokeMeshes.length; mi++) smokeMeshes[mi].visible = false;
  for (let i = 0; i < flareLights.length; i++) {
    const f = S.flares[i];
    flareLights[i].intensity = f ? 80 + Math.sin(S.time * 21 + f.seed) * 18 : 0;
    const fm = flareMeshes[i];
    fm.visible = !!f;
    if (f) {
      flareLights[i].position.set(f.x, f.y + 0.6, f.z);
      fm.position.set(f.x, f.y, f.z);
      const fl = 1 + Math.sin(S.time * 21 + f.seed) * 0.18;
      fm.scale.set(fl, 1 + Math.sin(S.time * 27 + f.seed) * 0.25, fl);
    }
  }
}

function syncChargeMesh() {
  const c = S.charge;
  if (c.state === 'carried') {
    if (c.carrier === 0) {
      chargeMesh.visible = false;
    } else {
      const b = S.bots.find((x) => x.id === c.carrier);
      if (b && b.alive) {
        chargeMesh.visible = true;
        chargeMesh.position.set(b.x, (b.feetY || 0) + 1.15, b.z - 0.3);
      } else chargeMesh.visible = false;
    }
  } else if (c.state === 'dropped' || c.state === 'planted') {
    chargeMesh.visible = true;
    chargeMesh.position.set(c.x, groundHeightAt(c.x, c.z) + 0.25, c.z);
    chargeMesh.rotation.y += 0.02;
  } else chargeMesh.visible = false;
  const blink = c.state === 'planted' ? (Math.sin(S.time * (6 + (35 - c.explodeT) * 0.3)) > 0 ? 3 : 0.2) : 1.2;
  chargeLight.intensity = chargeMesh.visible ? blink * 8 : 0;
  if (chargeMesh.visible) chargeLight.position.copy(chargeMesh.position);
}

// ---------- damage & death ----------
function killerName(id) {
  if (id === 0) return 'YOU';
  const b = S.bots.find((x) => x.id === id);
  return b ? b.name : '???';
}

function damageTarget(victim, dmg, head, attackerId, weaponId) {
  if (!victim.alive || S.phase === 'ended') return;
  const res = applyArmour(victim.hp, victim.armour, dmg);
  victim.hp = res[0]; victim.armour = res[1];
  const isPlayer = victim === S.player;
  if (isPlayer) {
    S.player.lastDmgT = S.time;
    snd.sndHurt();
    if (victim.hp <= 0) killTarget(victim, attackerId, weaponId, head);
    return;
  }
  if (attackerId === 0) {
    showHitmarker(head);
    snd.sndHit(head);
    const pt = project(victim.x, (victim.feetY || 0) + 1.5, victim.z);
    if (pt) spawnDmgNum(pt.x, pt.y, head ? 'HEADSHOT ' + Math.round(dmg) : String(Math.round(dmg)), head);
    S.stats.hits++;
    if (head) S.stats.headshots++;
  }
  if (victim.hp <= 0) killTarget(victim, attackerId, weaponId, head);
  else {
    // being shot makes a bot snap toward the shooter
    victim.hasLast = true;
    const sh = attackerId === 0 ? S.player : S.bots.find((x) => x.id === attackerId);
    if (sh) { victim.lastX = sh.x; victim.lastZ = sh.z; victim.investigate = 2; }
  }
}

function killTarget(victim, attackerId, weaponId, head) {
  victim.alive = false; victim.deaths++; victim.hp = 0;
  const wname = weaponId === 'frag' ? 'FRAG CHARGE' : (WEAPONS[weaponId] ? WEAPONS[weaponId].name : weaponId);
  const vname = victim === S.player ? 'YOU' : victim.name;
  addKillfeed(S, killerName(attackerId), vname, wname, head);
  awardKill(S, attackerId);
  if (attackerId === 0) snd.sndKill();
  if (victim !== S.player) {
    if (S.charge.state === 'carried' && S.charge.carrier === victim.id) dropCharge(S, victim.x, victim.z);
    spawnParticles(victim.x, (victim.feetY || 0) + 1.2, victim.z, 10, COL_DEBRIS, 3, 0.6);
    if (victim.mesh) { victim.mesh.rotation.x = -Math.PI / 2 * 0.9; victim.mesh.position.y = (victim.feetY || 0) + 0.25; }
  } else {
    deathCamY = S.player.y;
    showToast('YOU ARE DOWN — YOUR CREW FIGHTS ON');
  }
  if (attackerId === 0 || victim === S.player) renderRadio(S);
}

// ---------- player firing ----------
function eyePos(out) {
  const p = S.player;
  out.set(p.x, p.y + (p.crouch ? 1.15 : 1.62) + bobY, p.z);
  return out;
}

function firePlayer() {
  const p = S.player;
  if (!p.alive || S.phase === 'ended' || S.matchOver) return;
  if (p.reloading > 0 || p.fireCd > 0) return;
  if (p.heldNade) {
    const kind = p.nadeSel;
    if ((p.nades[kind] || 0) <= 0) { snd.sndDry(); p.fireCd = 0.3; return; }
    p.nades[kind]--;
    const dir = _v1.set(Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch));
    const eye = eyePos(_v2);
    throwGrenade(S, kind, eye.x, eye.y - 0.15, eye.z, dir.x, dir.y, dir.z, p.team, 0);
    hearNoise(S, p.x, p.z, 18);
    p.fireCd = 0.55;
    return;
  }
  const w = WEAPONS[p.slot];
  if (w.melee) {
    p.fireCd = 60 / w.rpm; p.meleeCd = 0.25;
    snd.sndMelee();
    const dir = _v1.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    for (const b of S.bots) {
      if (!b.alive || b.team === p.team) continue;
      const dx = b.x - p.x, dz = b.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < w.range + 0.4 && (dx * dir.x + dz * dir.z) / Math.max(0.01, d) > 0.6) {
        damageTarget(b, w.dmg, false, 0, 'ridge');
        spawnParticles(b.x, (b.feetY || 0) + 1.1, b.z, 6, COL_GOLD, 2.5, 0.4);
      }
    }
    return;
  }
  if ((p.mags[p.slot] || 0) <= 0) { snd.sndDry(); p.fireCd = 0.25; return; }
  p.mags[p.slot]--;
  p.fireCd = 60 / w.rpm;
  S.stats.shots++;
  const speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  const spread = currentSpread(w, speed, p.crouch, p.scoped, p.bloom);
  p.bloom = Math.min(w.bloomMax, p.bloom + w.bloomPerShot);
  p.recoil += w.recoil; p.recoilX += (S.rng() - 0.5) * w.recoilX * 2;
  recoilKick = Math.min(0.09, recoilKick + 0.028);
  const eye = eyePos(_v2);
  const dir = _v3.set(
    Math.sin(p.yaw + p.recoilX) * Math.cos(p.pitch + p.recoil),
    Math.sin(p.pitch + p.recoil),
    Math.cos(p.yaw + p.recoilX) * Math.cos(p.pitch + p.recoil)).normalize();
  dir.x += (S.rng() - 0.5) * 2 * spread;
  dir.y += (S.rng() - 0.5) * 2 * spread;
  dir.z += (S.rng() - 0.5) * 2 * spread;
  dir.normalize();
  const hit = traceShot(colliders, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, w.range + 12, S.bots, p.team, false);
  const mz = _v1.set(eye.x + dir.x * 0.7, eye.y - 0.12, eye.z + dir.z * 0.7);
  spawnTracer(mz.x, mz.y, mz.z, hit.x, hit.y, hit.z, w.tracer);
  muzzleFlash.material.opacity = 1;
  muzzleFlash.rotation.z = S.rng() * Math.PI;
  muzzleLight.intensity = 14;
  snd.sndShot(w.sound, 0);
  hearNoise(S, p.x, p.z, 30);
  if (hit.kind === 'body' && hit.bot) {
    const head = hit.part === 'head';
    damageTarget(hit.bot, damageAtRange(w, hit.dist, head), head, 0, w.id);
  } else if (hit.kind === 'wall' || hit.kind === 'ground') {
    spawnParticles(hit.x, hit.y, hit.z, 5, COL_SPARK, 2.2, 0.35);
  }
}

function reloadPlayer() {
  const p = S.player;
  const w = WEAPONS[p.slot];
  if (w.melee || p.reloading > 0) return;
  if ((p.mags[p.slot] || 0) >= w.mag || (p.reserves[p.slot] || 0) <= 0) return;
  p.reloading = w.reload; p.reloadTotal = w.reload;
  snd.sndReload();
}

function switchWeapon(slot) {
  const p = S.player;
  if (slot === 'nade') return;
  if (!p.weapons.includes(slot)) return;
  p.slot = slot; p.heldNade = false; p.reloading = 0; p.scoped = false;
  rebuildViewmodel();
}

function selectNade(kind) {
  const p = S.player;
  p.nadeSel = kind; p.heldNade = true; p.scoped = false;
  rebuildViewmodel();
}

// ---------- buy ----------
export function buyItem(key) {
  const p = S.player;
  if (S.phase !== 'buy' && S.stage !== 'buy') { showToast('THE BUY PHASE HAS ENDED'); return; }
  const [kind, id] = key.split(':');
  if (kind === 'w') {
    const w = WEAPONS[id];
    if (p.weapons.includes(id)) { switchWeapon(id); return; }
    if (p.money < w.price) { showToast('NOT ENOUGH FUNDS'); return; }
    p.money -= w.price;
    p.weapons.push(id);
    p.mags[id] = w.mag; p.reserves[id] = w.reserve;
    switchWeapon(id);
    snd.sndBuy();
  } else if (kind === 'n') {
    const n = NADES[id];
    if ((p.nades[id] || 0) >= 3) { showToast('CARRYING MAXIMUM'); return; }
    if (p.money < n.price) { showToast('NOT ENOUGH FUNDS'); return; }
    p.money -= n.price; p.nades[id] = (p.nades[id] || 0) + 1;
    snd.sndBuy();
  } else if (key === 'armour') {
    if (p.armour >= 100 || p.money < ARMOUR_PRICE) { showToast(p.armour >= 100 ? 'ARMOUR FULL' : 'NOT ENOUGH FUNDS'); return; }
    p.money -= ARMOUR_PRICE; p.armour = 100; snd.sndBuy();
  } else if (key === 'ammo') {
    if (p.money < 200) { showToast('NOT ENOUGH FUNDS'); return; }
    p.money -= 200;
    for (const wid of p.weapons) { const w = WEAPONS[wid]; if (!w.melee) p.reserves[wid] = w.reserve; }
    snd.sndBuy();
  } else if (key === 'kit') {
    if (p.hasKit || p.money < KIT_PRICE) { showToast(p.hasKit ? 'KIT ALREADY CARRIED' : 'NOT ENOUGH FUNDS'); return; }
    p.money -= KIT_PRICE; p.hasKit = true; snd.sndBuy();
    showToast('DEFUSE KIT — DEFUSES TAKE HALF THE TIME');
  }
}

// ---------- round api wired into rounds.js ----------
const roundApi = {
  equipBot(b) {
    b.weapon = b.role === 'SNIPER' ? 'zenith' : b.role === 'LURKER' ? 'comet' : 'nova';
    const w = WEAPONS[b.weapon];
    b.mag = w.mag; b.reserve = w.reserve; b.armour = 50;
    if (b.mesh) { b.mesh.rotation.x = 0; b.mesh.visible = true; }
  },
  onRoundStart(round, plan) {
    assignRoutes(S);
    setBuyOpen(true, S);
    showToast('ROUND ' + round + ' — ' + plan);
    S.radio.push({ name: 'VEGA', role: 'SNIPER', text: 'Eyes on mid. Call the cross.', t: S.time });
    S.radio.push({ name: 'LYRA', role: 'SUPPORT', text: 'Charge is mine. Entry goes first.', t: S.time });
    if (S.radio.length > 5) S.radio.splice(0, S.radio.length - 5);
    renderRadio(S);
    for (const b of S.bots) if (b.mesh) b.mesh.visible = true;
  },
  onLive() {
    setBuyOpen(false, S);
    showToast('ROUND LIVE — ' + S.plan);
    snd.sndRadio();
  },
  onSwap() { showToast('SIDES SWAP — YOU NOW DEFEND THE OBSERVATORY'); },
  onRoundEnd(winner, reason, matchPoint) {
    const won = winner === S.playerTeam;
    showBanner(won ? 'ROUND WON' : 'ROUND LOST', reason + '  ·  ' + S.scores[TEAM_A] + ' — ' + S.scores[TEAM_B], won);
    snd.sndRound(won);
    setBuyOpen(false, S);
  },
  onMatchEnd(winner) {
    const won = winner === S.playerTeam;
    showBanner(won ? 'MATCH WON' : 'MATCH LOST', 'FINAL ' + S.scores[TEAM_A] + ' — ' + S.scores[TEAM_B] + ' · PRESS R TO PLAY AGAIN', won);
  },
  onPlanted(site) {
    showToast('CHARGE ARMED AT ' + site.name + ' — 35 SECONDS');
    snd.sndPlantBeep();
    S.radio.push({ name: 'LYRA', role: 'SUPPORT', text: 'Charge down at ' + site.id + '! Hold the site!', t: S.time });
    renderRadio(S);
  },
};

const botApi = {
  fireBot(b, tgt, dist, dt) { botShoot(S, colliders, b, tgt, dist, dt, shotApi); },
  startPlant(b, site) { plantCharge(S, site, b.id, roundApi); },
  startDefuse(b) { defuseCharge(S, b.id, roundApi); },
};

const shotApi = {
  tracer(ax, ay, az, bx, by, bz, color, bot) {
    spawnTracer(ax, ay, az, bx, by, bz, color);
    if (bot && bot.mesh) {
      let f = botFlash.get(bot.id);
      if (!f) {
        f = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3),
          new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
        f.position.set(0.26, 1.32, 0.75); bot.mesh.add(f); botFlash.set(bot.id, f);
      }
      f.material.opacity = 1; f.rotation.z = S.rng() * Math.PI;
    }
  },
  noiseAt(x, z, r, kind) { hearNoise(S, x, z, r); },
  shotSound(bot, dist) {
    const dx = bot.x - S.player.x, dz = bot.z - S.player.z;
    snd.sndShot(WEAPONS[bot.weapon].sound, Math.sqrt(dx * dx + dz * dz));
  },
  damage(victim, dmg, head, attackerId, weaponId) { damageTarget(victim, dmg, head, attackerId, weaponId); },
  impact(x, y, z) { spawnParticles(x, y, z, 4, COL_SPARK, 2, 0.3); },
};

function onGrenadeDamage(victim, dmg, head, ownerId, weaponId) { damageTarget(victim, dmg, head, ownerId, weaponId); }
function onGrenadeBlind(victim, seconds) {
  victim.blind = Math.max(victim.blind || 0, seconds);
  if (victim === S.player) snd.sndFlash();
}
function onDetonate(kind, x, y, z) {
  if (kind === 'frag') {
    snd.sndExplosion();
    spawnParticles(x, y, z, 60, COL_FIRE, 9, 0.9, 1);
    spawnParticles(x, y, z, 30, COL_GOLD, 6, 0.5, 1);
    muzzleLight.intensity = 30; muzzleLight.position.set(x, y + 1, z);
  } else if (kind === 'flash') { snd.sndFlash(); spawnParticles(x, y, z, 20, COL_FLASH, 4, 0.3); }
  else if (kind === 'smoke') { snd.sndSmoke(); spawnParticles(x, y, z, 24, COL_SMOKE, 2.5, 1.4, 0.8); }
  else if (kind === 'flare') { snd.sndFlare(); spawnParticles(x, y, z, 16, COL_FLARE, 3, 0.8, 1); }
}

// ---------- fixed-step simulation ----------
function stepSim(dt) {
  const p = S.player;
  S.time += dt; S.tick++;
  p.team = S.playerTeam;
  p.feetY = p.y;
  if (p.blind > 0) p.blind -= dt;
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.meleeCd > 0) p.meleeCd -= dt;
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      const w = WEAPONS[p.slot];
      const need = w.mag - (p.mags[p.slot] || 0);
      const take = Math.min(need, p.reserves[p.slot] || 0);
      p.mags[p.slot] = (p.mags[p.slot] || 0) + take;
      p.reserves[p.slot] -= take;
    }
  }
  p.bloom = Math.max(0, p.bloom - dt * 0.045);
  p.recoil = Math.max(0, p.recoil - dt * 0.055);
  p.recoilX *= Math.max(0, 1 - dt * 6);

  // look
  if (input.locked || S.stage) {
    p.yaw -= input.lookDX * (p.scoped ? 0.0009 : 0.0021);
    p.pitch -= input.lookDY * (p.scoped ? 0.0009 : 0.0021);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  }
  input.lookDX = 0; input.lookDY = 0;

  // movement with acceleration, crouch, walk and collision
  if (p.alive && S.phase !== 'ended' && !hudBuyOpen()) {
    const sp = p.crouch ? 2.6 : p.scoped ? 2.9 : input.walk ? 2.7 : 5.2;
    let ix = 0, iz = 0;
    if (input.fwd) iz -= 1; if (input.back) iz += 1;
    if (input.left) ix -= 1; if (input.right) ix += 1;
    const il = Math.sqrt(ix * ix + iz * iz) || 1;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    // forward is (sin yaw, cos yaw); right is (-cos yaw, sin yaw)
    const tx = (-ix * cy - iz * sy) / il * sp * (ix || iz ? 1 : 0);
    const tz = (ix * sy - iz * cy) / il * sp * (ix || iz ? 1 : 0);
    const accel = p.onGround ? 34 : 8;
    p.vx += (tx - p.vx) * Math.min(1, accel * dt);
    p.vz += (tz - p.vz) * Math.min(1, accel * dt);
    if (input.jump && p.onGround) { p.vy = 5.4; p.onGround = false; }
    const res = collideCircle(colliders, p.x + p.vx * dt, p.z + p.vz * dt, 0.42, p.y, 1.7);
    p.x = res[0]; p.z = res[1];
    const gh = groundHeightAt(p.x, p.z);
    if (p.y > gh + 0.02 || !p.onGround) {
      p.vy -= 17 * dt; p.y += p.vy * dt;
      if (p.y <= gh) { p.y = gh; p.vy = 0; p.onGround = true; }
    } else { p.y = gh; p.onGround = true; }
    const spd = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
    if (spd > 0.5 && p.onGround) {
      walkCycle += spd * dt * 1.6;
      bobY = Math.sin(walkCycle * 2) * 0.018 * Math.min(1, spd / 5);
      stepT -= dt;
      if (stepT <= 0) { stepT = 2.4 / spd; if (spd > 3.4) { snd.sndStep(); hearNoise(S, p.x, p.z, 8); } }
    } else bobY *= 0.9;
    // charge pickup
    if (S.charge.state === 'dropped' && playerAttacks(S)) {
      const dx = p.x - S.charge.x, dz = p.z - S.charge.z;
      if (dx * dx + dz * dz < 1.4) { pickupCharge(S, 0); p.carrying = true; showToast('YOU HAVE THE SIGNAL CHARGE'); snd.sndPickup(); }
    }
    // plant / defuse channels on E
    const site = siteAt(S, p.x, p.z);
    if (input.use) {
      if (playerAttacks(S) && p.carrying && site && S.phase === 'live') {
        if (p.channelKind !== 'plant') { p.channel = 0; p.channelKind = 'plant'; }
        p.channel += dt;
        if (Math.floor(p.channel * 2) !== Math.floor((p.channel - dt) * 2)) snd.sndPlantBeep();
        if (p.channel >= PLANT_TIME) { p.channel = 0; p.channelKind = ''; p.carrying = false; plantCharge(S, site, 0, roundApi); }
      } else if (!playerAttacks(S) && S.phase === 'planted') {
        const dx = p.x - S.charge.x, dz = p.z - S.charge.z;
        if (dx * dx + dz * dz < 2.6) {
          if (p.channelKind !== 'defuse') { p.channel = 0; p.channelKind = 'defuse'; }
          p.channel += dt;
          if (Math.floor(p.channel * 2) !== Math.floor((p.channel - dt) * 2)) snd.sndDefuse();
          if (p.channel >= (p.hasKit ? DEFUSE_TIME / 2 : DEFUSE_TIME)) { p.channel = 0; p.channelKind = ''; defuseCharge(S, 0, roundApi); }
        } else { p.channel = 0; p.channelKind = ''; }
      } else { p.channel = 0; p.channelKind = ''; }
    } else { p.channel = 0; p.channelKind = ''; }
    // firing
    const w = WEAPONS[p.slot];
    if (input.fire && (w.auto || input.fireEdge)) firePlayer();
  }
  input.fireEdge = false;

  // bots pick up a dropped charge
  if (S.charge.state === 'dropped') {
    for (const b of S.bots) {
      if (!b.alive || b.team !== attackers(S)) continue;
      const dx = b.x - S.charge.x, dz = b.z - S.charge.z;
      if (dx * dx + dz * dz < 1.4) {
        pickupCharge(S, b.id);
        b.route = (s_planSite() === 'A' ? ROUTES.A : ROUTES.B).slice(); b.wp = 0; b.state = 'route';
        S.radio.push({ name: b.name, role: b.role, text: 'Charge recovered — moving to the site.', t: S.time });
        renderRadio(S);
        break;
      }
    }
  }
  if (S.phase !== 'buy') {
    updateBots(S, colliders, dt, botApi);
    updateGrenades(S, colliders, dt, onGrenadeDamage, onGrenadeBlind, onDetonate);
  }
  updateRounds(S, dt, roundApi);
  // planted beeps accelerate toward detonation
  if (S.phase === 'planted') {
    plantedBeepT -= dt;
    if (plantedBeepT <= 0) { snd.sndPlantBeep(); plantedBeepT = Math.max(0.18, S.charge.explodeT * 0.03); }
  }
  // drain one-frame events
  for (const ev of S.events) if (ev.type === 'radio') snd.sndRadio();
  S.events.length = 0;
  // bot mesh sync + walk swing (render-adjacent but state-driven)
  for (const b of S.bots) {
    if (!b.mesh) continue;
    b.mesh.position.set(b.x, b.feetY || 0, b.z);
    if (b.alive) {
      b.mesh.rotation.y = b.yaw;
      const swing = Math.sin(S.time * 7 + b.seedOff * 20) * 0.35;
      b.mesh.userData.legL.rotation.x = swing;
      b.mesh.userData.legR.rotation.x = -swing;
    }
  }
  for (const f of botFlash.values()) f.material.opacity *= 0.6;
}

function s_planSite() { return S.planIdx === 1 ? 'A' : 'B'; }

// ---------- rendering ----------
function renderFrame() {
  const p = S.player;
  if (p.alive) {
    camera.position.set(p.x, p.y + (p.crouch ? 1.15 : 1.62) + bobY, p.z);
  } else {
    camera.position.set(p.x, Math.max(0.4, deathCamY + 0.5), p.z);
  }
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw + Math.PI;
  camera.rotation.x = p.pitch + p.recoil;
  camera.rotation.z = 0;
  const targetFov = p.scoped && WEAPONS[p.slot].scoped ? 32 : 74;
  camera.fov += (targetFov - camera.fov) * 0.25;
  camera.updateProjectionMatrix();
  // viewmodel sway + recoil kick
  recoilKick *= 0.86;
  viewmodel.position.z = -0.62 + recoilKick;
  viewmodel.rotation.x = recoilKick * 1.6 + (p.meleeCd > 0 ? -0.7 * (p.meleeCd / 0.25) : 0);
  viewmodel.position.y = -0.3 + bobY * 0.6;
  muzzleFlash.material.opacity *= 0.55;
  if (muzzleLight.intensity > 0.5 && muzzleLight.position.distanceToSquared(camera.position) > 4) {
    muzzleLight.intensity *= 0.7;
  } else {
    muzzleLight.position.copy(camera.position);
    muzzleLight.intensity *= 0.6;
  }
  // searchlight sweep across DISH B
  const sw = S.time * 0.22;
  const tx = SITES.B.x + Math.cos(sw) * 9;
  const tz = SITES.B.z + Math.sin(sw) * 7;
  mapRefs.spot.target.position.set(tx, 0, tz);
  mapRefs.spot.target.updateMatrixWorld();
  const head = _v1.set(31.5, 7.9, -24);
  const tgt = _v2.set(tx, 0, tz);
  const dir = _v3.subVectors(tgt, head);
  const len = dir.length();
  mapRefs.beam.position.copy(head).addScaledVector(dir, 0.5);
  mapRefs.beam.scale.set(1, len / 26, 1);
  mapRefs.beam.quaternion.setFromUnitVectors(UP_Y, dir.normalize().negate());
  mapRefs.beam.material.opacity = 0.2 + Math.sin(S.time * 0.7) * 0.04;
  mapRefs.beamCore.position.copy(mapRefs.beam.position);
  mapRefs.beamCore.scale.copy(mapRefs.beam.scale);
  mapRefs.beamCore.quaternion.copy(mapRefs.beam.quaternion);
  // dish slow track
  mapRefs.dish.rotation.z = Math.sin(S.time * 0.05) * 0.06;
  updateParticles(STEP);
  updateTracers(STEP);
  syncSmokeFlares();
  syncChargeMesh();
  frameNo++;
  updateHud(S, STEP, camera, colliders, project, frameNo % 6 === 0);
  renderer.render(scene, camera);
}

export function project(x, y, z) {
  _v1.set(x, y, z).project(camera);
  if (_v1.z > 1) return null;
  return { x: (_v1.x * 0.5 + 0.5) * window.innerWidth, y: (-_v1.y * 0.5 + 0.5) * window.innerHeight, z: _v1.z };
}

function loop(t) {
  if (!running) return;
  requestAnimationFrame(loop);
  const now = t / 1000;
  let dt = Math.min(0.1, now - (lastT || now));
  lastT = now;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { stepSim(STEP); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  renderFrame();
}

export function initGame(container) {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x141c38, 0.0105);
  camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 400);
  scene.add(camera);
  // twilight light rig: cold hemisphere, low amber sun, dish searchlight
  scene.add(new THREE.HemisphereLight(0x4a5a9e, 0x1a1428, 1.0));
  const sun = new THREE.DirectionalLight(0xff9a4d, 1.5);
  sun.position.set(-60, 14, 30); scene.add(sun);
  const moonFill = new THREE.DirectionalLight(0x7a8fd8, 0.35);
  moonFill.position.set(40, 50, -40); scene.add(moonFill);
  muzzleLight = new THREE.PointLight(0xffc46a, 0, 9, 2);
  scene.add(muzzleLight);
  mapRefs = buildMap(scene);
  colliders = mapRefs.colliders;
  // bot meshes
  for (const b of S.bots) {
    b.mesh = makeBotMesh(b.team);
    b.mesh.visible = false;
    scene.add(b.mesh);
  }
  // charge mesh
  chargeMesh = new THREE.Group();
  const cBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2a3355, roughness: 0.5, metalness: 0.5 }));
  chargeMesh.add(cBody);
  const cLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff6a5e, emissive: 0xff2a1e, emissiveIntensity: 3 }));
  cLamp.position.set(0, 0.2, 0); chargeMesh.add(cLamp);
  chargeLight = new THREE.PointLight(0xff6a5e, 0, 7, 2);
  scene.add(chargeLight);
  scene.add(chargeMesh);
  buildViewmodel();
  initParticles();
  initTracers();
  initSmokeAndFlares();
  hudInit(buyItem);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  S.started = true;
  startRound(S, roundApi);
  // startRound opens the buy menu; it stays open behind the deploy overlay
  // so the player's first sight of the round is the supply crate.
  lastT = 0; acc = 0; running = true;
  requestAnimationFrame(loop);
}

export function rebuildBotMeshes() {
  for (const b of S.bots) {
    if (b.mesh) scene.remove(b.mesh);
    b.mesh = makeBotMesh(b.team);
    b.mesh.visible = b.alive;
    scene.add(b.mesh);
  }
}

export function restartMatch() {
  S.scores[TEAM_A] = 0; S.scores[TEAM_B] = 0;
  S.lossStreak[TEAM_A] = 0; S.lossStreak[TEAM_B] = 0;
  S.round = 1; S.matchOver = false; S.matchWinner = '';
  S.playerTeam = TEAM_A;
  for (const b of S.bots) {
    b.team = b.id <= 4 ? TEAM_A : TEAM_B;
    b.kills = 0; b.deaths = 0; b.money = ECON.start;
    if (b.mesh) { scene.remove(b.mesh); b.mesh = makeBotMesh(b.team); scene.add(b.mesh); }
  }
  S.player.money = ECON.start; S.player.kills = 0; S.player.deaths = 0;
  S.player.weapons = ['eclipse', 'ridge'];
  S.player.mags = { eclipse: 12 }; S.player.reserves = { eclipse: 48 };
  S.player.nades = { frag: 1, flash: 1, smoke: 1, flare: 0 };
  S.player.slot = 'eclipse'; S.player.heldNade = false; S.player.hasKit = false;
  rebuildViewmodel();
  startRound(S, roundApi);
}

export function gameApi() {
  return {
    S, input, colliders: () => colliders, camera: () => camera, scene: () => scene,
    firePlayer, reloadPlayer, switchWeapon, selectNade, buyItem, restartMatch,
    project, rebuildViewmodel, startRound: () => startRound(S, roundApi),
    rebuildBotMeshes,
    openLive: () => openLive(S, roundApi),
    spawnTracer, spawnParticles, damageTarget, endRound: (w, r) => endRound(S, w, r, roundApi),
  };
}

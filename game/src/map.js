// map.js — Starfall Observatory: one original map, built from procedural
// three.js geometry. Three lanes (A / MID catwalk / B), two sites, colliders,
// waypoints, spawns and the great radio dish with its searchlight.
// Palette: deep indigo twilight against warm tungsten amber.
import * as THREE from 'three';

export const SITES = {
  A: { id: 'A', name: 'DOME A — REFLECTOR', x: -25, z: -18, r: 6 },
  B: { id: 'B', name: 'DISH B — UPLINK', x: 25, z: -15, r: 6 },
};
export const ATTACK_SPAWN = [[-4, 38], [-1, 39], [2, 38], [5, 40], [-6, 40]];
export const DEFEND_SPAWN = [[-4, -28], [-1, -29], [3, -28], [6, -27], [-7, -27]];

export const ROUTES = {
  A: [[0, 36], [-10, 30], [-22, 26], [-28, 18], [-28, 8], [-26, -4], [-27, -13], [-25, -18]],
  B: [[0, 36], [10, 30], [22, 26], [28, 18], [28, 8], [26, -4], [27, -11], [25, -15]],
  MID: [[0, 36], [0, 26], [0, 16], [0, 6], [0, -4], [0, -12], [0, -20], [0, -27]],
  MIDLOW: [[0, 36], [4, 26], [5, 16], [5, 6], [4, -4], [4, -12], [3, -20], [0, -27]],
  NORTH: [[0, -27], [-14, -26], [-24, -24], [-27, -18]],
  NORTHE: [[0, -27], [14, -26], [24, -24], [27, -16]],
};
export const HOLDS = {
  A1: { x: -21, z: -13, yaw: 2.6 }, A2: { x: -31, z: -24, yaw: -1.2 },
  B1: { x: 21, z: -12, yaw: -2.6 }, B2: { x: 31, z: -22, yaw: 1.2 },
  M1: { x: 6, z: -24, yaw: 3.1 }, M2: { x: -6, z: -24, yaw: 3.1 },
  MID: { x: 0, z: -6, yaw: 0 },
};

// Raised catwalk deck: x in [-2,2], z in [-8,10], height 1.4, with ramps.
export function groundHeightAt(x, z) {
  if (x < -2.2 || x > 2.2) return 0;
  if (z >= -8 && z <= 10) return 1.4;
  if (z > 10 && z < 13.5) return 1.4 * (13.5 - z) / 3.5;
  if (z < -8 && z > -11.5) return 1.4 * (z + 11.5) / 3.5;
  return 0;
}

function canvasTex(size, draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
  return t;
}

function skyTexture() {
  return canvasTex(1024, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#04060f'); grad.addColorStop(0.42, '#101a3d');
    grad.addColorStop(0.62, '#2a3566'); grad.addColorStop(0.74, '#6a4a6e');
    grad.addColorStop(0.8, '#c97e4a'); grad.addColorStop(0.86, '#1a2347');
    grad.addColorStop(1, '#0a0e1e');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900; i++) {
      const x = rnd() * s, y = rnd() * s * 0.58, r = rnd() * 1.4 + 0.3;
      g.fillStyle = rnd() > 0.85 ? '#ffe9c4' : '#dfe8ff';
      g.globalAlpha = 0.35 + rnd() * 0.65;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // low sun glow on the western horizon
    const glow = g.createRadialGradient(s * 0.22, s * 0.78, 4, s * 0.22, s * 0.78, 190);
    glow.addColorStop(0, 'rgba(255,190,110,0.9)'); glow.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = glow; g.fillRect(0, 0, s, s);
  });
}

function rockTexture() {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#2b3350'; g.fillRect(0, 0, s, s);
    let seed = 31;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 5200; i++) {
      const v = 30 + rnd() * 40;
      g.fillStyle = `rgb(${v},${v + 6},${v + 22})`;
      g.fillRect(rnd() * s, rnd() * s, 2 + rnd() * 4, 2 + rnd() * 3);
    }
    g.strokeStyle = 'rgba(12,16,32,0.5)'; g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      g.beginPath(); const x = rnd() * s, y = rnd() * s;
      g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 120); g.stroke();
    }
  }, 9);
}

function concreteTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#4a5170'; g.fillRect(0, 0, s, s);
    let seed = 97;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 1600; i++) {
      const v = 60 + rnd() * 30;
      g.fillStyle = `rgb(${v},${v + 3},${v + 14})`;
      g.fillRect(rnd() * s, rnd() * s, 3, 3);
    }
    g.strokeStyle = 'rgba(20,24,44,0.7)'; g.lineWidth = 3;
    g.strokeRect(2, 2, s - 4, s - 4);
  }, 1);
}

function crateTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#5d4a2e'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#6b5636'; g.fillRect(14, 14, s - 28, s - 28);
    g.strokeStyle = '#3a2d1a'; g.lineWidth = 8; g.strokeRect(8, 8, s - 16, s - 16);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s);
    g.lineWidth = 5; g.stroke();
    g.fillStyle = '#e8dcbf'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
    g.fillText('STARFALL', s / 2, s / 2 - 6); g.fillText('SUPPLY', s / 2, s / 2 + 24);
  });
}

export function buildMap(scene) {
  const colliders = [];
  const group = new THREE.Group(); scene.add(group);

  const rockTex = rockTexture(), concTex = concreteTexture(), crateTex = crateTexture();
  const matRock = new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.95 });
  const matConc = new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.85 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6, metalness: 0.08 });
  const matWhite2 = new THREE.MeshStandardMaterial({ color: 0xc9c4d8, roughness: 0.7 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x232a44, roughness: 0.8, metalness: 0.3 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0x5a6484, roughness: 0.45, metalness: 0.7 });
  const matCrate = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 });
  const matAmber = new THREE.MeshStandardMaterial({ color: 0xffc46a, emissive: 0xff9a2e, emissiveIntensity: 2.2 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x2a3a66, emissive: 0xffb454, emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.4 });
  const matDish = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide });
  const matDeck = new THREE.MeshStandardMaterial({ color: 0x3a4260, roughness: 0.7, metalness: 0.4 });

  function box(x, z, w, d, h, mat, y0, collide) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, (y0 || 0) + h / 2, z); group.add(m);
    if (collide !== false) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y0 || 0, y1: (y0 || 0) + h });
    return m;
  }
  function cyl(x, z, r, h, mat, y0, seg, collide) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, h, seg || 14), mat);
    m.position.set(x, (y0 || 0) + h / 2, z); group.add(m);
    if (collide !== false) colliders.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y0 || 0, y1: (y0 || 0) + h });
    return m;
  }

  // --- sky dome + stars ---
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 20),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  scene.add(sky);
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(700 * 3);
  let sd = 13; const srnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < 700; i++) {
    const th = srnd() * Math.PI * 2, ph = srnd() * 0.9 + 0.12;
    starPos[i * 3] = Math.cos(th) * Math.cos(ph) * 300;
    starPos[i * 3 + 1] = Math.sin(ph) * 300;
    starPos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 300;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, fog: false })));

  // --- ground: mountaintop slab + cliff ring ---
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 88), matRock);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 5); group.add(ground);
  const cliffMat = new THREE.MeshStandardMaterial({ color: 0x1c2338, roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const rock = new THREE.Mesh(new THREE.ConeGeometry(9 + (i % 5) * 2.2, 16 + (i % 4) * 6, 5), cliffMat);
    rock.position.set(Math.cos(a) * 58, -4, 5 + Math.sin(a) * 52);
    rock.rotation.y = a; group.add(rock);
  }
  // concrete pads at sites and spawns
  for (const [px, pz, pw, pd] of [[-25, -18, 17, 15], [25, -15, 18, 16], [0, 38, 20, 10], [0, -28, 18, 8], [0, 0, 14, 30]]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), matConc);
    pad.rotation.x = -Math.PI / 2; pad.position.set(px, 0.03, pz); group.add(pad);
  }

  // --- perimeter walls (low observatory parapet) ---
  box(0, -33, 86, 2, 2.6, matConc, 0); box(0, 45, 86, 2, 2.6, matConc, 0);
  box(-43, 6, 2, 80, 2.6, matConc, 0); box(43, 6, 2, 80, 2.6, matConc, 0);

  // --- lane divider walls with corner gaps (Dust-style flow) ---
  box(-16, 22, 1.6, 14, 3.4, matWhite2); box(-16, 4, 1.6, 12, 3.4, matWhite2); box(-16, -6, 1.6, 5, 3.4, matWhite2);
  box(16, 22, 1.6, 14, 3.4, matWhite2); box(16, 4, 1.6, 12, 3.4, matWhite2); box(16, -6, 1.6, 5, 3.4, matWhite2);
  box(-16, 30, 1.6, 6, 3.4, matWhite2); box(16, 30, 1.6, 6, 3.4, matWhite2);
  // north cross walls leave doorways into both sites and the mid connectors
  box(-19, -9, 7, 1.6, 3.4, matWhite2); box(19, -9, 7, 1.6, 3.4, matWhite2);

  // --- main hall with mid archway (two blocks + roof) ---
  box(-7.5, -15, 9, 10, 8, matWhite); box(7.5, -15, 9, 10, 8, matWhite);
  box(0, -15, 7.5, 10, 1.2, matWhite2, 6.5, false);
  box(-7.5, -15, 9.6, 10.6, 0.5, matDark, 8, false); box(7.5, -15, 9.6, 10.6, 0.5, matDark, 8, false);
  // amber windows on the hall faces
  for (const wx of [-10, -5, 5, 10]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), matGlass);
    win.position.set(wx, 4.4, -9.9); group.add(win);
  }
  // small dome on the hall roof
  const hallDome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), matWhite);
  hallDome.position.set(-7.5, 8.4, -15); group.add(hallDome);

  // --- DOME A: reflector dome with slit ---
  cyl(-27, -21, 5.5, 3.2, matWhite);
  const domeA = new THREE.Mesh(new THREE.SphereGeometry(5.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), matWhite);
  domeA.position.set(-27, 3.2, -21); group.add(domeA);
  box(-27, -21, 1.8, 0.6, 6.5, matDark, 2.4, false).position.set(-27, 4.6, -15.9);
  const telA = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 4.4, 10), matSteel);
  telA.position.set(-27, 5.4, -18.4); telA.rotation.x = 0.6; group.add(telA);
  // site marker ring + letter board
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.09, 8, 40), matAmber);
  ringA.rotation.x = Math.PI / 2; ringA.position.set(-25, 0.12, -18); group.add(ringA);

  // --- DISH B: the great radio dish (landmark). Built as a group: the
  // lathe bowl opens along local +Y, the rim ring sits at the mouth, the
  // feed arm rises to the receiver — then the group tips the whole face
  // south-up toward the attackers climbing the B lane.
  const pedestal = cyl(28, -19, 2.2, 5.5, matDark);
  pedestal.position.y = 2.75;
  const dishGroup = new THREE.Group();
  dishGroup.position.set(28, 5.2, -19);
  dishGroup.rotation.x = 0.62;
  group.add(dishGroup);
  const dishPts = [];
  for (let i = 0; i <= 14; i++) { const r = (i / 14) * 8.2; dishPts.push(new THREE.Vector2(r, r * r * 0.055)); }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(dishPts, 30), matDish);
  dishGroup.add(dish);
  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.22, 8, 40), matSteel);
  dishRim.rotation.x = Math.PI / 2; dishRim.position.y = 3.7; dishGroup.add(dishRim);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.4, 8), matSteel);
  arm.position.set(0, 4.6, 0); dishGroup.add(arm);
  const feed = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), matDark);
  feed.position.set(0, 7.2, 0); dishGroup.add(feed);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xff5a4e, emissive: 0xff2a1e, emissiveIntensity: 2.5 }));
  beacon.position.set(0, 7.85, 0); dishGroup.add(beacon);
  // support struts
  for (const [sx, sz] of [[24.5, -21.5], [31.5, -21.5], [28, -15.5]]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.5, 8), matSteel);
    strut.position.set(sx, 3.2, sz); strut.rotation.z = (sx - 28) * 0.06; group.add(strut);
  }
  colliders.push({ x0: 25.5, x1: 30.5, z0: -21.5, z1: -16.5, y0: 0, y1: 5.5 });
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.09, 8, 40), matAmber);
  ringB.rotation.x = Math.PI / 2; ringB.position.set(25, 0.12, -15); group.add(ringB);
  // dish control hut
  box(33, -12, 4, 3.4, 2.8, matWhite2);
  const hutWin = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), matGlass);
  hutWin.position.set(33, 1.7, -13.75); hutWin.rotation.y = Math.PI; group.add(hutWin);

  // --- telescope piers scattered as cover ---
  for (const [px, pz] of [[-10, 14], [10, 14], [-22, 2], [22, 2], [-8, -2], [8, -2], [-32, -10], [33, -26]]) {
    cyl(px, pz, 0.8, 2.6, matConc);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.2, 10), matWhite2);
    scope.position.set(px, 3.4, pz); scope.rotation.z = 0.5; group.add(scope);
  }

  // --- crates / barrels: lane cover with corners ---
  const crateSpots = [
    [-24, 24, 1.5], [-30, 12, 1.5], [-24, -2, 1.5], [-20, -16, 1.4], [-30, -20, 1.4],
    [24, 24, 1.5], [30, 12, 1.5], [26, 1, 1.5], [20, -15, 1.4], [30, -9, 1.4],
    [-6, 22, 1.4], [6, 22, 1.4], [-5, -24, 1.4], [5, -24, 1.4], [-13, -14, 1.3], [13, -14, 1.3],
  ];
  for (const [cx, cz, cs] of crateSpots) {
    const m = box(cx, cz, cs, cs, cs, matCrate);
    m.rotation.y = ((cx * 7 + cz * 3) % 4) * 0.12;
  }
  box(-28, 6, 1.5, 1.5, 3.0, matCrate); box(28, 6, 1.5, 1.5, 3.0, matCrate);
  for (const [bx, bz] of [[-18, 10], [18, 10], [-26, -26], [26, -26], [-2, 30], [2, -4]]) {
    cyl(bx, bz, 0.62, 1.5, matDark);
  }

  // --- MID catwalk: raised deck on posts, railings, ramps ---
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 18.4), matDeck);
  deck.position.set(0, 1.25, 1); group.add(deck);
  for (const pz of [-7, -2, 3, 8]) {
    box(-2.05, pz, 0.24, 0.24, 1.4, matSteel, 0, false);
    box(2.05, pz, 0.24, 0.24, 1.4, matSteel, 0, false);
  }
  for (const rx of [-2.1, 2.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 18.4), matSteel);
    rail.position.set(rx, 2.35, 1); group.add(rail);
  }
  // ramps (visual wedges; groundHeightAt handles the walk)
  for (const [rz, flip] of [[11.8, 1], [-9.8, -1]]) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.25, 3.9), matDeck);
    ramp.position.set(0, 0.7, rz); ramp.rotation.x = flip * 0.36; group.add(ramp);
  }
  // catwalk lamp strip
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 17), matAmber);
  strip.position.set(-1.9, 1.44, 1); group.add(strip);

  // --- lamp posts: tungsten cones against the cold blue ---
  const lampLights = [];
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const lampSpots = [[-25, -14], [25, -11], [0, 20], [-28, 20], [28, 20], [0, -24], [-14, -22], [14, -22]];
  lampSpots.forEach(([lx, lz], i) => {
    cyl(lx, lz, 0.12, 4.6, matDark, 0, 8, false);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), matAmber);
    head.position.set(lx, 4.7, lz); group.add(head);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.4, 4.6, 18, 1, true), coneMat);
    cone.position.set(lx, 2.35, lz); group.add(cone);
    if (i < 5) {
      const pl = new THREE.PointLight(0xffa64d, 26, 15, 1.8);
      pl.position.set(lx, 4.4, lz); scene.add(pl); lampLights.push(pl);
    }
  });

  // --- searchlight rig on the dish tower ---
  const tower = cyl(31.5, -24, 0.5, 7.5, matSteel, 0, 10);
  tower.position.y = 3.75;
  const lampHead = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.1, 12), matDark);
  lampHead.position.set(31.5, 7.9, -24); lampHead.rotation.x = Math.PI / 2 - 0.5; group.add(lampHead);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4.0, 26, 16, 1, true), beamMat);
  beam.position.set(31.5, 7.9, -24); group.add(beam);
  // hot core: a narrower, brighter shaft inside the beam so the searchlight
  // reads against the bright dish and sky
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const beamCore = new THREE.Mesh(new THREE.ConeGeometry(1.4, 26, 12, 1, true), coreMat);
  beamCore.position.copy(beam.position); group.add(beamCore);
  const spot = new THREE.SpotLight(0xffe2b0, 900, 60, 0.24, 0.45, 1.6);
  spot.position.set(31.5, 7.9, -24); scene.add(spot); scene.add(spot.target);

  // --- scattered detail: antenna masts, cable drums, star charts ---
  for (const [ax, az, ah] of [[-36, -28, 9], [36, 30, 8], [-36, 34, 7]]) {
    cyl(ax, az, 0.1, ah, matSteel, 0, 6, false);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff5a4e, emissive: 0xff2a1e, emissiveIntensity: 2 }));
    tip.position.set(ax, ah + 0.2, az); group.add(tip);
  }
  // glowing site letters on posts
  function letterBoard(x, z, letter) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0e1e'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#ffb454'; g.lineWidth = 6; g.strokeRect(6, 6, 116, 116);
    g.fillStyle = '#ffb454'; g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(x, 3.4, z); group.add(board);
    cyl(x, z, 0.09, 2.4, matDark, 0, 6, false);
    return board;
  }
  letterBoard(-21, -21, 'A').rotation.y = 0.7;
  letterBoard(21, -18, 'B').rotation.y = -0.7;

  // glowing guide strips sunk into the lane floors
  for (const [sx, sz, horiz] of [[-28, 20, false], [-28, 0, false], [28, 20, false], [28, 0, false], [0, 26, true], [0, -26, true]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 5 : 0.3, 0.06, horiz ? 0.3 : 5), matAmber);
    strip.position.set(sx, 0.06, sz); group.add(strip);
  }

  return { colliders, dish: dishGroup, beam, beamCore, spot, lampLights, group };
}

// Circle-vs-AABB collision resolve. Reuses no allocations; mutates pos.
export function collideCircle(colliders, px, pz, radius, feetY, height) {
  let x = px, z = pz;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (feetY + height < c.y0 + 0.05 || feetY > c.y1 - 0.05) continue;
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    let dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-8) {
      // centre inside box: push out along the smallest penetration axis
      const pl = x - c.x0, pr = c.x1 - x, pn = z - c.z0, pf = c.z1 - z;
      const m = Math.min(pl, pr, pn, pf);
      if (m === pl) x = c.x0 - radius; else if (m === pr) x = c.x1 + radius;
      else if (m === pn) z = c.z0 - radius; else z = c.z1 + radius;
      continue;
    }
    const d = Math.sqrt(d2), push = (radius - d) / d;
    x += dx * push; z += dz * push;
  }
  // map bounds
  x = Math.max(-41.5, Math.min(41.5, x));
  z = Math.max(-31.5, Math.min(43.5, z));
  return [x, z];
}

// Segment-vs-colliders: does any solid block the line? Used for sight and shots.
export function segmentBlocked(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let t0 = 0, t1 = 1, ok = true;
    const mins = [c.x0 - ax, c.y0 - ay, c.z0 - az];
    const maxs = [c.x1 - ax, c.y1 - ay, c.z1 - az];
    const ds = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(ds[k]) < 1e-9) { if (mins[k] > 0 || maxs[k] < 0) { ok = false; break; } }
      else {
        let ta = mins[k] / ds[k], tb = maxs[k] / ds[k];
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 < 1 && t1 > 0) return true;
  }
  return false;
}

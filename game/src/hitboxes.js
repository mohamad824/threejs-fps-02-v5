// hitboxes.js — analytic ray tests against bodies and walls. No raycaster,
// no allocations in the hot path: scratch values live in module scope and
// the result object is reused by the caller.
// A bot is three spheres: head (r 0.24), chest (r 0.36), pelvis (r 0.32).
// Walls are the map colliders, tested with the slab method.
const _hit = { kind: 'none', bot: null, part: '', dist: 0, x: 0, y: 0, z: 0 };

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxD) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  return t >= 0 && t <= maxD ? t : -1;
}

function rayBox(ox, oy, oz, dx, dy, dz, c, maxD) {
  let t0 = 0, t1 = maxD;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [c.x0, c.y0, c.z0], mx = [c.x1, c.y1, c.z1];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < mn[k] || o[k] > mx[k]) return -1; }
    else {
      let ta = (mn[k] - o[k]) / d[k], tb = (mx[k] - o[k]) / d[k];
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

function rayGround(ox, oy, oz, dx, dy, dz, maxD) {
  if (dy >= -1e-9) return -1;
  const t = -oy / dy;
  return t >= 0 && t <= maxD ? t : -1;
}

// Trace one shot. `targets` are bots (or the player record when bots shoot).
// Returns the reused _hit object. `shooterTeam` skips friendlies.
export function traceShot(colliders, ox, oy, oz, dx, dy, dz, maxD, targets, shooterTeam, isPlayerTarget) {
  let best = maxD, bestKind = 'none', bestBot = null, bestPart = '';
  // walls first: the nearest wall caps the shot
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i], best);
    if (t >= 0 && t < best) { best = t; bestKind = 'wall'; bestBot = null; }
  }
  const tg = rayGround(ox, oy, oz, dx, dy, dz, best);
  if (tg >= 0 && tg < best) { best = tg; bestKind = 'ground'; bestBot = null; }
  // bodies
  for (let i = 0; i < targets.length; i++) {
    const b = targets[i];
    if (!b.alive || b.team === shooterTeam) continue;
    const feet = b.feetY !== undefined ? b.feetY : 0;
    const crouch = b.crouch ? 0.45 : 0;
    const hx = b.x, hy = feet + 1.52 - crouch, hz = b.z;
    let t = raySphere(ox, oy, oz, dx, dy, dz, hx, hy, hz, 0.24, best);
    if (t >= 0) { best = t; bestKind = 'body'; bestBot = b; bestPart = 'head'; continue; }
    t = raySphere(ox, oy, oz, dx, dy, dz, b.x, feet + 1.12 - crouch * 0.7, b.z, 0.36, best);
    if (t >= 0) { best = t; bestKind = 'body'; bestBot = b; bestPart = 'chest'; continue; }
    t = raySphere(ox, oy, oz, dx, dy, dz, b.x, feet + 0.62 - crouch * 0.4, b.z, 0.32, best);
    if (t >= 0) { best = t; bestKind = 'body'; bestBot = b; bestPart = 'pelvis'; }
  }
  _hit.kind = bestKind; _hit.bot = bestBot; _hit.part = bestPart; _hit.dist = best;
  _hit.x = ox + dx * best; _hit.y = oy + dy * best; _hit.z = oz + dz * best;
  return _hit;
}

// Segment vs smoke spheres: smoke blocks bot sight and (softly) shots.
export function segmentInSmoke(smokes, ax, ay, az, bx, by, bz) {
  for (let i = 0; i < smokes.length; i++) {
    const s = smokes[i];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 > 0 ? ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - s.x, py = ay + dy * t - s.y, pz = az + dz * t - s.z;
    if (px * px + py * py + pz * pz < s.r * s.r) return true;
  }
  return false;
}

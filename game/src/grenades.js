// grenades.js — frag, flash, smoke and flare. One projectile sim with
// bounces; four distinct detonation effects. Smoke spheres block bot sight
// (see hitboxes.segmentInSmoke); flares carry a pooled light.
import { NADES } from './weapons.js';
import { segmentBlocked, groundHeightAt } from './map.js';
import { segmentInSmoke } from './hitboxes.js';

export function throwGrenade(s, kind, ox, oy, oz, dx, dy, dz, team, ownerId) {
  const def = NADES[kind];
  const speed = kind === 'flare' ? 13 : 15;
  s.grenades.push({
    kind, team, ownerId, x: ox, y: oy, z: oz,
    vx: dx * speed, vy: dy * speed + 2.2, vz: dz * speed,
    fuse: def.fuse, bounced: 0, dead: false,
  });
  s.events.push({ type: 'throw', kind });
}

function bounceOffWalls(colliders, g, dt) {
  // cheap point-vs-AABB bounce: if the new point is inside a box, step back
  // and reflect the dominant velocity axis.
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (g.x > c.x0 && g.x < c.x1 && g.z > c.z0 && g.z < c.z1 && g.y > c.y0 && g.y < c.y1) {
      const dxl = Math.min(g.x - c.x0, c.x1 - g.x);
      const dzl = Math.min(g.z - c.z0, c.z1 - g.z);
      const dyl = Math.min(g.y - c.y0, c.y1 - g.y);
      if (dxl <= dzl && dxl <= dyl) { g.vx *= -0.45; g.x += g.vx * dt * 2; }
      else if (dzl <= dyl) { g.vz *= -0.45; g.z += g.vz * dt * 2; }
      else { g.vy *= -0.45; g.y += g.vy * dt * 2; }
      g.bounced++;
      return;
    }
  }
}

export function updateGrenades(s, colliders, dt, onDamage, onBlind, onDetonate) {
  for (let i = s.grenades.length - 1; i >= 0; i--) {
    const g = s.grenades[i];
    g.vy -= 18 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const gh = groundHeightAt(g.x, g.z);
    if (g.y < gh + 0.12) {
      g.y = gh + 0.12;
      if (Math.abs(g.vy) > 2) { g.vy *= -0.42; g.vx *= 0.7; g.vz *= 0.7; g.bounced++; }
      else { g.vy = 0; g.vx *= 0.86; g.vz *= 0.86; }
    }
    bounceOffWalls(colliders, g, dt);
    g.fuse -= dt;
    if (g.fuse <= 0) { detonate(s, colliders, g, onDamage, onBlind, onDetonate); s.grenades.splice(i, 1); }
  }
  for (let i = s.smokes.length - 1; i >= 0; i--) {
    s.smokes[i].life -= dt;
    if (s.smokes[i].life <= 0) s.smokes.splice(i, 1);
  }
  for (let i = s.flares.length - 1; i >= 0; i--) {
    s.flares[i].life -= dt;
    if (s.flares[i].life <= 0) s.flares.splice(i, 1);
  }
}

function detonate(s, colliders, g, onDamage, onBlind, onDetonate) {
  const def = NADES[g.kind];
  if (g.kind === 'frag') {
    onDetonate('frag', g.x, g.y, g.z);
    const victims = [s.player, ...s.bots];
    for (const v of victims) {
      if (!v.alive || v.team === g.team) continue; // no friendly fire from frags
      const feet = v.feetY !== undefined ? v.feetY : groundHeightAt(v.x, v.z);
      const dx = v.x - g.x, dy = (feet + 1.0) - g.y, dz = v.z - g.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > def.radius) continue;
      if (segmentBlocked(colliders, g.x, g.y, g.z, v.x, feet + 1.0, v.z)) continue;
      const dmg = def.dmg * (1 - (d / def.radius) * 0.75);
      onDamage(v, dmg, false, g.ownerId, 'frag');
    }
  } else if (g.kind === 'flash') {
    onDetonate('flash', g.x, g.y, g.z);
    const victims = [s.player, ...s.bots];
    for (const v of victims) {
      if (!v.alive) continue;
      const feet = v.feetY !== undefined ? v.feetY : groundHeightAt(v.x, v.z);
      const dx = v.x - g.x, dy = (feet + 1.5) - g.y, dz = v.z - g.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > def.radius) continue;
      if (segmentBlocked(colliders, g.x, g.y, g.z, v.x, feet + 1.5, v.z)) continue;
      // facing the flash blinds harder; looking away still stings up close
      const fx = Math.sin(v.yaw || 0), fz = Math.cos(v.yaw || 0);
      const facing = (dx * fx + dz * fz) / Math.max(0.001, d);
      let blind = (1 - d / def.radius) * (facing > 0.2 ? 2.6 : 1.1);
      if (v === s.player) blind *= 1.1;
      if (blind > 0.25) onBlind(v, blind);
    }
  } else if (g.kind === 'smoke') {
    const gh = groundHeightAt(g.x, g.z);
    s.smokes.push({ x: g.x, y: gh + 1.4, z: g.z, r: def.radius, life: def.life, seed: s.rng() * 10 });
    onDetonate('smoke', g.x, gh + 1.2, g.z);
  } else if (g.kind === 'flare') {
    const gh = groundHeightAt(g.x, g.z);
    s.flares.push({ x: g.x, y: gh + 0.35, z: g.z, life: def.life, seed: s.rng() * 10 });
    onDetonate('flare', g.x, gh + 0.4, g.z);
  }
}

// Can `seer` see `tgt`? Walls and smoke both block; blindness blocks all.
export function canSee(colliders, smokes, seer, tx, ty, tz, maxDist) {
  if (seer.blind > 0) return false;
  const feet = seer.feetY !== undefined ? seer.feetY : groundHeightAt(seer.x, seer.z);
  const ey = feet + 1.5;
  const dx = tx - seer.x, dy = ty - ey, dz = tz - seer.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > maxDist * maxDist) return false;
  if (segmentBlocked(colliders, seer.x, ey, seer.z, tx, ty, tz)) return false;
  if (segmentInSmoke(smokes, seer.x, ey, seer.z, tx, ty, tz)) return false;
  return true;
}

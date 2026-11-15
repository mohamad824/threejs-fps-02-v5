// bots.js — bot brains: waypoint routes through the three lanes, hold
// positions, sight/hearing reactions, smoke-aware vision, planting and
// defusing. Bots never see through walls or smoke; they react to noise
// events and to the charge state, and they call the round on the radio.
import { ROUTES, HOLDS, SITES, collideCircle, groundHeightAt } from './map.js';
import { WEAPONS, currentSpread, damageAtRange } from './weapons.js';
import { traceShot } from './hitboxes.js';
import { canSee } from './grenades.js';
import { attackers, defenders } from './store.js';

const BOT_SPEED = 4.3;

export function assignRoutes(s) {
  const atk = attackers(s);
  const plan = s.planIdx;
  let defIdx = 0;
  const holds = [HOLDS.A1, HOLDS.B1, HOLDS.M1, HOLDS.A2, HOLDS.B2];
  for (const b of s.bots) {
    b.route = []; b.wp = 0; b.state = 'route'; b.target = -1; b.react = 0;
    b.channel = 0; b.channelKind = ''; b.hasLast = false; b.investigate = 0;
    b.hearT = 0; b.blind = 0; b.burst = 0; b.strafeT = 0;
    if (b.team === atk) {
      if (b.id === s.charge.carrier) {
        b.route = plan === 1 ? ROUTES.A.slice() : ROUTES.B.slice();
        b.state = 'route';
      } else if (b.role === 'SNIPER') { b.route = ROUTES.MIDLOW.slice(); }
      else if (b.role === 'LURKER') { b.route = plan === 1 ? ROUTES.B.slice() : ROUTES.A.slice(); }
      else if (b.role === 'FLEX') { b.route = ROUTES.MID.slice(); }
      else { b.route = plan === 1 ? ROUTES.A.slice() : ROUTES.B.slice(); }
      // escorts stay near the carrier's lane
      if (b.name === 'ALTAIR') b.route = ROUTES.MID.slice();
    } else {
      const h = holds[defIdx % holds.length]; defIdx++;
      b.holdX = h.x; b.holdZ = h.z; b.holdYaw = h.yaw;
      b.route = [[b.x, b.z], [h.x, h.z]];
      b.state = 'route';
    }
  }
}

function nearestEnemy(s, b, colliders) {
  // returns {target, dist} where target is 'player' or a bot, or null
  let best = null, bestD = 1e9;
  const foes = [];
  if (s.playerTeam !== b.team && s.player.alive) foes.push(s.player);
  for (const o of s.bots) if (o.team !== b.team && o.alive) foes.push(o);
  for (const f of foes) {
    const feet = f.feetY !== undefined ? f.feetY : groundHeightAt(f.x, f.z);
    const dx = f.x - b.x, dz = f.z - b.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 46) continue;
    if (!canSee(colliders, s.smokes, b, f.x, feet + 1.2, f.z, 46)) continue;
    // peripheral vision: far targets must be roughly ahead
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const facing = (dx * fx + dz * fz) / Math.max(0.001, d);
    if (d > 14 && facing < -0.1) continue;
    if (d < bestD) { bestD = d; best = f; }
  }
  return best ? { target: best, dist: bestD } : null;
}

function moveToward(s, b, tx, tz, dt, colliders, speedMul) {
  const dx = tx - b.x, dz = tz - b.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.35) return true;
  const sp = BOT_SPEED * (speedMul || 1) * b.speedMul;
  const step = Math.min(d, sp * dt);
  const nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
  const res = collideCircle(colliders, nx, nz, 0.42, groundHeightAt(nx, nz), 1.7);
  const moved = Math.sqrt((res[0] - b.x) * (res[0] - b.x) + (res[1] - b.z) * (res[1] - b.z));
  if (moved < step * 0.3) {
    // Jammed against a wall: slide along one axis instead of pushing into it.
    const rx = collideCircle(colliders, nx, b.z, 0.42, groundHeightAt(nx, b.z), 1.7);
    const rz = collideCircle(colliders, b.x, nz, 0.42, groundHeightAt(b.x, nz), 1.7);
    const mx = Math.abs(rx[0] - b.x), mz = Math.abs(rz[1] - b.z);
    if (mx >= mz && mx > 0.001) b.x = rx[0];
    else if (mz > 0.001) b.z = rz[1];
    else { b.x = res[0]; b.z = res[1]; }
  } else {
    b.x = res[0]; b.z = res[1];
  }
  b.feetY = groundHeightAt(b.x, b.z);
  b.yaw = Math.atan2(dx, dz);
  const rx2 = tx - b.x, rz2 = tz - b.z;
  return Math.sqrt(rx2 * rx2 + rz2 * rz2) < 0.35;
}

function radio(s, bot, text) {
  s.radio.push({ name: bot.name, role: bot.role, text, t: s.time });
  if (s.radio.length > 5) s.radio.shift();
  s.events.push({ type: 'radio' });
}

export function updateBots(s, colliders, dt, api) {
  // api: { fireBot(bot, target), damagePlayer(dmg, head, attacker),
  //        damageBot(bot, dmg, head, attackerId, weapon), startPlant(bot, site),
  //        startDefuse(bot), noiseAt(x, z, radius, kind) }
  const atk = attackers(s);
  for (const b of s.bots) {
    if (!b.alive) continue;
    if (b.feetY === undefined) b.feetY = groundHeightAt(b.x, b.z);
    if (b.blind > 0) b.blind -= dt;
    if (b.reloading > 0) { b.reloading -= dt; if (b.reloading <= 0) { const w = WEAPONS[b.weapon]; const take = Math.min(w.mag, b.reserve); b.mag = take; b.reserve -= take; } }
    b.strafeT -= dt;

    // hearing: recent noises pull bots toward the sound
    if (b.hearT > 0) {
      b.hearT -= dt;
      if (b.state !== 'engage' && b.state !== 'plant' && b.state !== 'defuse') {
        b.state = 'investigate';
        b.lastX = b.hearX; b.lastZ = b.hearZ; b.hasLast = true; b.investigate = 3;
      }
    }

    // perception
    const seen = nearestEnemy(s, b, colliders);
    if (seen) {
      if (b.target === -1) { b.react = 0.32 + s.rng() * 0.38; b.target = seen.target === s.player ? 0 : seen.target.id; }
      b.lastX = seen.target.x; b.lastZ = seen.target.z; b.hasLast = true;
      b.react -= dt;
      if (b.react <= 0 && b.state !== 'plant' && b.state !== 'defuse') b.state = 'engage';
    } else if (b.state === 'engage') {
      b.target = -1;
      b.state = b.hasLast && b.investigate > 0 ? 'investigate' : (b.route.length ? 'route' : 'hold');
    }

    // objective behaviour overrides movement, never aim
    const isCarrier = s.charge.state === 'carried' && s.charge.carrier === b.id;
    if (b.team === atk && isCarrier && b.state !== 'engage') {
      const site = s.planIdx === 1 ? SITES.A : SITES.B;
      const dx = site.x - b.x, dz = site.z - b.z;
      if (Math.sqrt(dx * dx + dz * dz) < site.r && s.charge.state === 'carried' && s.phase === 'live') {
        b.state = 'plant';
        if (b.channelKind !== 'plant') { b.channel = 0; b.channelKind = 'plant'; radio(s, b, 'Planting the charge — cover me!'); }
      }
    }
    if (b.team === defenders(s) && s.charge.state === 'planted' && b.state !== 'engage') {
      const dx = s.charge.x - b.x, dz = s.charge.z - b.z;
      if (Math.sqrt(dx * dx + dz * dz) < 1.6 && s.phase === 'planted') {
        b.state = 'defuse';
        if (b.channelKind !== 'defuse') { b.channel = 0; b.channelKind = 'defuse'; radio(s, b, 'On the charge — defusing!'); }
      } else if (b.state !== 'rotate') {
        b.state = 'rotate';
        b.route = [[b.x, b.z], [s.charge.x, s.charge.z]];
        b.wp = 1;
        if (s.rng() < 0.3) radio(s, b, 'Rotating to the charge!');
      }
    }

    switch (b.state) {
      case 'route': case 'rotate': {
        if (b.wp < b.route.length) {
          const wp = b.route[b.wp];
          if (moveToward(s, b, wp[0], wp[1], dt, colliders, 1)) b.wp++;
        } else {
          b.state = b.team === atk ? 'hold' : 'hold';
          if (b.team !== atk) { b.yaw = b.holdYaw; }
        }
        break;
      }
      case 'investigate': {
        b.investigate -= dt;
        if (moveToward(s, b, b.lastX, b.lastZ, dt, colliders, 0.85) || b.investigate <= 0) {
          b.state = b.team === atk ? 'hold' : 'hold';
          b.hasLast = false;
        }
        break;
      }
      case 'hold': {
        // defenders hold their angle; attackers who finished a route peek
        if (b.team !== atk) {
          b.yaw += Math.sin(s.time * 0.4 + b.seedOff * 9) * 0.12 * dt;
        } else if (b.hasLast) {
          b.yaw = Math.atan2(b.lastX - b.x, b.lastZ - b.z);
        }
        break;
      }
      case 'engage': {
        const tgt = seen ? seen.target : null;
        if (tgt) {
          b.yaw = Math.atan2(tgt.x - b.x, tgt.z - b.z);
          // strafe perpendicular in short bursts; stop to shoot accurately
          if (b.strafeT <= 0) { b.strafe = s.rng() < 0.5 ? -1 : 1; b.strafeT = 0.5 + s.rng() * 0.7; }
          const px = Math.cos(b.yaw) * b.strafe, pz = -Math.sin(b.yaw) * b.strafe;
          if (seen.dist > 6) {
            const res = collideCircle(colliders, b.x + px * 2.1 * dt, b.z + pz * 2.1 * dt, 0.42, b.feetY, 1.7);
            b.x = res[0]; b.z = res[1]; b.feetY = groundHeightAt(b.x, b.z);
          }
          api.fireBot(b, tgt, seen.dist, dt);
        }
        break;
      }
      case 'plant': {
        b.channel += dt;
        if (b.channel >= 4) { api.startPlant(b, s.planIdx === 1 ? SITES.A : SITES.B); b.state = 'hold'; b.channel = 0; b.channelKind = ''; }
        break;
      }
      case 'defuse': {
        b.channel += dt;
        if (b.channel >= 5) { api.startDefuse(b); b.state = 'hold'; b.channel = 0; b.channelKind = ''; }
        break;
      }
    }
  }
}

// Bot shooting: burst fire with spread that grows while the bot strafes,
// damage through the same hitbox code as the player.
export function botShoot(s, colliders, b, tgt, dist, dt, api) {
  if (b.reloading > 0) return;
  const w = WEAPONS[b.weapon];
  if (b.mag <= 0) {
    if (b.reserve > 0) { b.reloading = w.reload; }
    else { b.weapon = 'eclipse'; b.mag = 12; b.reserve = 48; }
    return;
  }
  b.burstGap -= dt;
  if (b.burstGap > 0) return;
  if (b.burst <= 0) { b.burst = w.id === 'zenith' ? 1 : 3 + Math.floor(s.rng() * 3); b.burstGap = 0.45 + s.rng() * 0.4; }
  b.burstGap = 60 / w.rpm;
  b.burst--;
  b.mag--;
  const feet = b.feetY;
  const ox = b.x, oy = feet + 1.5, oz = b.z;
  const tFeet = tgt.feetY !== undefined ? tgt.feetY : groundHeightAt(tgt.x, tgt.z);
  const aimY = tFeet + 1.25;
  let dx = tgt.x - ox, dy = aimY - oy, dz = tgt.z - oz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= len; dy /= len; dz /= len;
  // spread: bots are steadier when still, worse at range and while blind
  const spread = currentSpread(w, 1.6, false, false, 0.004) * (1 + dist * 0.012) * (b.blind > 0 ? 3 : 1);
  dx += (s.rng() - 0.5) * 2 * spread; dy += (s.rng() - 0.5) * 2 * spread; dz += (s.rng() - 0.5) * 2 * spread;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= dl; dy /= dl; dz /= dl;
  const targets = tgt === s.player ? [s.player] : s.bots;
  const hit = traceShot(colliders, ox, oy, oz, dx, dy, dz, w.range + 10, targets, b.team, true);
  api.tracer(ox, oy, oz, hit.x, hit.y, hit.z, w.tracer, b);
  api.noiseAt(b.x, b.z, 30, 'shot');
  api.shotSound(b, dist);
  if (hit.kind === 'body' && hit.bot) {
    const head = hit.part === 'head';
    const dmg = damageAtRange(w, hit.dist, head) * (0.85 + s.rng() * 0.3);
    api.damage(hit.bot, dmg, head, b.id, w.id);
  } else if (hit.kind === 'wall' || hit.kind === 'ground') {
    api.impact(hit.x, hit.y, hit.z);
  }
}

export function hearNoise(s, x, z, radius) {
  for (const b of s.bots) {
    if (!b.alive) continue;
    const dx = b.x - x, dz = b.z - z;
    if (dx * dx + dz * dz < radius * radius) {
      b.hearX = x; b.hearZ = z; b.hearT = 2.5;
    }
  }
}

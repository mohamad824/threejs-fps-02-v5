// rounds.js — the round state machine and the economy. Phases: buy -> live
// -> planted -> ended -> buy. Wins by elimination, detonation, defuse or
// timeout; first to 7, sides swap after round 6.
import { BUY_TIME, ROUND_TIME, BOMB_TIME, WIN_SCORE, TEAM_A, TEAM_B,
  attackers, defenders, aliveCount, playerAttacks, resetForRound, PLANS } from './store.js';
import { SITES, ATTACK_SPAWN, DEFEND_SPAWN } from './map.js';

export const ECON = { win: 3250, loss: 1900, lossBonus: 500, lossMax: 3400, kill: 300, plant: 300, defuse: 300, start: 800 };

export function startRound(s, api) {
  s.phase = 'buy'; s.phaseT = BUY_TIME;
  s.planIdx = (s.round - 1) % PLANS.length;
  s.plan = PLANS[s.planIdx];
  resetForRound(s);
  const atk = attackers(s);
  // charge carrier: the attacking side's support — LYRA for APOGEE in the
  // first half, KITE for PERIGEE in the second.
  s.charge.carrier = atk === TEAM_A ? 2 : 5;
  // Spawn geography never changes: attackers climb from the south gate,
  // defenders hold the north sites — whichever team plays which side.
  placeSide(s, atk, ATTACK_SPAWN, api);
  placeSide(s, defenders(s), DEFEND_SPAWN, api);
  s.player.hp = 100; s.player.alive = true; s.player.blind = 0;
  s.player.channel = 0; s.player.channelKind = '';
  s.player.carrying = false;
  if (s.playerTeam === atk) { s.player.x = ATTACK_SPAWN[0][0]; s.player.z = ATTACK_SPAWN[0][1]; }
  else { s.player.x = DEFEND_SPAWN[0][0]; s.player.z = DEFEND_SPAWN[0][1]; }
  s.player.yaw = s.playerTeam === atk ? Math.PI : 0;
  s.player.pitch = 0;
  api.onRoundStart(s.round, s.plan);
}

function placeSide(s, team, spawns, api) {
  let i = 0;
  for (const b of s.bots) {
    if (b.team !== team) continue;
    const sp = spawns[(i + 1) % spawns.length]; i++;
    b.x = sp[0]; b.z = sp[1]; b.yaw = team === attackers(s) ? Math.PI : 0;
    b.hp = 100; b.alive = true;
    b.feetY = 0;
    api.equipBot(b);
  }
}

export function openLive(s, api) {
  s.phase = 'live'; s.phaseT = ROUND_TIME;
  api.onLive();
}

export function updateRounds(s, dt, api) {
  if (s.matchOver) return;
  if (s.phase === 'buy') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) openLive(s, api);
    return;
  }
  if (s.phase === 'ended') {
    s.phaseT -= dt;
    if (s.phaseT <= 0) {
      s.round++;
      if (s.round === 7) {
        // Halves swap sides: teams stay fixed, but APOGEE now defends and
        // PERIGEE attacks — the player defends the observatory.
        api.onSwap();
      }
      startRound(s, api);
    }
    return;
  }
  // live / planted
  s.phaseT -= dt;
  if (s.phase === 'planted') {
    s.charge.explodeT -= dt;
    if (s.charge.explodeT <= 0) { endRound(s, attackers(s), 'The charge detonated.', api); return; }
  } else if (s.phaseT <= 0) {
    endRound(s, defenders(s), 'Time expired — the defence holds.', api); return;
  }
  const aAlive = aliveCount(s, TEAM_A), bAlive = aliveCount(s, TEAM_B);
  if (s.phase === 'planted') {
    // Once armed, elimination never ends the round: only the detonation
    // timer or a defuse decides it.
    return;
  }
  if (aAlive === 0 || bAlive === 0) {
    const winner = aAlive > 0 ? TEAM_A : TEAM_B;
    endRound(s, winner, 'Elimination.', api);
  }
}

export function endRound(s, winner, reason, api) {
  if (s.phase === 'ended' || s.matchOver) return;
  s.phase = 'ended'; s.phaseT = 4.2;
  s.scores[winner]++;
  const loser = winner === TEAM_A ? TEAM_B : TEAM_A;
  s.lossStreak[winner] = 0;
  s.lossStreak[loser]++;
  // economy
  const winPay = ECON.win, lossPay = Math.min(ECON.lossMax, ECON.loss + ECON.lossBonus * (s.lossStreak[loser] - 1));
  paySide(s, winner, winPay);
  paySide(s, loser, lossPay);
  s.events.push({ type: 'roundEnd', winner, reason });
  api.onRoundEnd(winner, reason, s.scores[winner] >= WIN_SCORE);
  if (s.scores[winner] >= WIN_SCORE) {
    s.matchOver = true; s.matchWinner = winner;
    s.phaseT = 8;
    api.onMatchEnd(winner);
  }
}

function paySide(s, team, amount) {
  if (s.playerTeam === team) s.player.money = Math.min(16000, s.player.money + amount);
  for (const b of s.bots) if (b.team === team) b.money = Math.min(16000, b.money + amount);
}

export function awardKill(s, killerId) {
  if (killerId === 0) s.player.money = Math.min(16000, s.player.money + ECON.kill);
  else { const b = s.bots.find((x) => x.id === killerId); if (b) b.money = Math.min(16000, b.money + ECON.kill); }
}

export function plantCharge(s, site, planterId, api) {
  s.charge.state = 'planted';
  s.charge.site = site.id;
  s.charge.x = site.x; s.charge.z = site.z;
  s.charge.explodeT = BOMB_TIME; s.charge.planter = planterId;
  s.phase = 'planted'; s.phaseT = BOMB_TIME;
  if (planterId === 0) s.player.money += ECON.plant;
  s.events.push({ type: 'planted', site: site.id });
  api.onPlanted(site);
}

export function defuseCharge(s, defuserId, api) {
  s.charge.state = 'defused';
  if (defuserId === 0) s.player.money += ECON.defuse;
  s.events.push({ type: 'defused' });
  endRound(s, defenders(s), 'The charge was defused.', api);
}

export function dropCharge(s, x, z) {
  if (s.charge.state !== 'carried') return;
  s.charge.state = 'dropped'; s.charge.x = x; s.charge.z = z; s.charge.carrier = -1;
  s.events.push({ type: 'chargeDropped' });
}

export function pickupCharge(s, pickerId) {
  if (s.charge.state !== 'dropped') return false;
  s.charge.state = 'carried'; s.charge.carrier = pickerId;
  s.events.push({ type: 'chargePickup', picker: pickerId });
  return true;
}

export function siteAt(s, x, z) {
  for (const k of ['A', 'B']) {
    const site = SITES[k];
    const dx = x - site.x, dz = z - site.z;
    if (dx * dx + dz * dz < site.r * site.r) return site;
  }
  return null;
}

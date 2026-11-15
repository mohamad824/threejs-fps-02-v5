// hud.js — every DOM overlay: radar, vitals, ammo, killfeed, radio,
// teammate list, name tags, damage numbers, plant ring, buy menu,
// scoreboard and banners. HUD reads the store; it never owns game state.
import { WEAPONS, NADES, ARMOUR_PRICE } from './weapons.js';
import { TEAM_A, TEAM_B, aliveCount, attackers } from './store.js';
import { SITES } from './map.js';

const $ = (id) => document.getElementById(id);
const els = {};
let radarCtx = null;
let tagPool = [];
let dmgPool = [];
let buyOpen = false;
let bannerT = 0;
let toastT = 0;
let hitT = 0;

export function hudInit(onBuy) {
  for (const id of ['scoreA', 'scoreB', 'roundTimer', 'roundLabel', 'aliveRow', 'killfeed', 'radio',
    'mateList', 'hpVal', 'hpBar', 'armourVal', 'ammoMag', 'ammoRes', 'wpnName', 'fireMode',
    'moneyVal', 'nadeBox', 'planLine', 'objBox', 'objLabel', 'ringFg', 'chargeChip', 'chargeWho',
    'plantedBar', 'plantFill', 'plantSite', 'hint', 'banner', 'bannerTitle', 'bannerSub',
    'buyMenu', 'buyGrid', 'buyMoney', 'buyTeam', 'buySub', 'scoreboard', 'sbBody', 'sbTitle',
    'tagLayer', 'dmgLayer', 'hitmark', 'toast', 'vig', 'flashOv', 'scopeOv',
    'chL', 'chR', 'chT', 'chB']) els[id] = $(id);
  radarCtx = $('radar').getContext('2d');
  for (let i = 0; i < 12; i++) {
    const t = document.createElement('div'); t.className = 'tag'; t.style.display = 'none';
    t.innerHTML = '<span class="tn"></span><div class="tbar"><i></i></div>';
    els.tagLayer.appendChild(t); tagPool.push(t);
  }
  for (let i = 0; i < 16; i++) {
    const d = document.createElement('div'); d.className = 'dmg'; d.style.display = 'none';
    els.dmgLayer.appendChild(d); dmgPool.push({ el: d, t: 0, x: 0, y: 0 });
  }
  els.buyGrid.addEventListener('click', (e) => {
    const item = e.target.closest('[data-buy]');
    if (item) onBuy(item.dataset.buy);
  });
}

export function hudBuyOpen() { return buyOpen; }
export function setBuyOpen(open, s) {
  buyOpen = open;
  els.buyMenu.style.display = open ? 'flex' : 'none';
  if (open) renderBuy(s);
}

function fmtTime(t) {
  const v = Math.max(0, Math.ceil(t));
  return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
}

function renderBuy(s) {
  const p = s.player;
  const items = [];
  for (const k of ['nova', 'zenith', 'comet', 'eclipse', 'ridge']) {
    const w = WEAPONS[k];
    items.push({ key: 'w:' + k, icon: w.icon, nm: w.name, cls: w.cls, fl: w.flavour, pr: w.price, owned: p.weapons.includes(k) });
  }
  for (const k of ['frag', 'flash', 'smoke', 'flare']) {
    const n = NADES[k];
    items.push({ key: 'n:' + k, icon: n.icon, nm: n.name, cls: 'GRENADE · OWNED ' + (p.nades[k] || 0), fl: n.flavour, pr: n.price, owned: false });
  }
  items.push({ key: 'armour', icon: '⛨', nm: 'PLATING', cls: 'ARMOUR · 100', fl: 'Ceramic plates. Half the hurt, twice the nerve.', pr: ARMOUR_PRICE, owned: p.armour >= 100 });
  items.push({ key: 'ammo', icon: '▤', nm: 'RESERVE AMMO', cls: 'REFILL ALL MAGAZINES', fl: 'Top up every reserve to full.', pr: 200, owned: false });
  items.push({ key: 'kit', icon: '✚', nm: 'DEFUSE KIT', cls: 'TOOLS · HALVES DEFUSE TIME', fl: 'Cutters and calm hands. Five seconds becomes two and a half.', pr: 400, owned: !!p.hasKit });
  els.buyGrid.innerHTML = items.map((it) =>
    `<div class="buyItem ${it.owned ? 'owned' : ''} ${p.money < it.pr ? 'cant' : ''}" data-buy="${it.key}">
      <div class="ic">${it.icon}</div><div class="tx"><div class="nm">${it.nm}</div>
      <div class="cls">${it.cls}</div><div class="fl">${it.fl}</div></div>
      <div class="pr">${it.owned ? 'OWNED' : '$' + it.pr}</div></div>`).join('');
  els.buyMoney.textContent = '$' + p.money;
  const mates = s.bots.filter((b) => b.team === s.playerTeam);
  els.buyTeam.innerHTML = mates.map((b) =>
    `${b.name} <span style="color:#7ee2a0">▮</span> ${b.hp}HP${s.charge.carrier === b.id ? ' ◈CHARGE' : ''}`).join(' &nbsp;·&nbsp; ');
  els.buySub.textContent = 'ROUND ' + s.round + ' · ' + s.plan + ' · PRESS B TO CLOSE — THE ROUND OPENS WHEN THE TIMER ENDS';
}

export function renderScoreboard(s, show) {
  els.scoreboard.style.display = show ? 'flex' : 'none';
  if (!show) return;
  const rows = [];
  const all = [{ name: 'YOU', role: 'ENTRY', team: s.playerTeam, kills: s.player.kills, deaths: s.player.deaths, money: s.player.money, alive: s.player.alive, me: true },
    ...s.bots.map((b) => ({ name: b.name, role: b.role, team: b.team, kills: b.kills, deaths: b.deaths, money: b.money, alive: b.alive }))];
  for (const team of [TEAM_A, TEAM_B]) {
    rows.push(`<div class="sbRow head"><span class="a">${team} — ${s.scores[team]} ROUNDS ${team === attackers(s) ? '· ATTACK' : '· DEFENCE'}</span><span class="b">K</span><span class="b">D</span><span class="c">FUNDS</span></div>`);
    for (const r of all.filter((x) => x.team === team)) {
      rows.push(`<div class="sbRow ${r.me ? 'me' : ''}"${r.alive ? '' : ' style="opacity:.45"'}><span class="a">${r.name} <small style="color:#9fb4d8">${r.role}</small></span><span class="b">${r.kills}</span><span class="b">${r.deaths}</span><span class="c">$${r.money}</span></div>`);
    }
  }
  els.sbBody.innerHTML = rows.join('');
  els.sbTitle.textContent = 'STARFALL OBSERVATORY — ROUND ' + s.round + ' · FIRST TO 7';
}

export function showBanner(title, sub, win) {
  els.bannerTitle.textContent = title;
  els.bannerSub.textContent = sub;
  els.banner.className = win ? 'win' : 'lose';
  els.banner.style.display = 'block';
  bannerT = 3.6;
}
export function hideBanner() { els.banner.style.display = 'none'; bannerT = 0; }
export function showToast(text) { els.toast.textContent = text; els.toast.style.display = 'block'; toastT = 2.6; }
export function showHitmarker(head) {
  els.hitmark.className = head ? 'hs' : '';
  els.hitmark.style.opacity = '1'; hitT = 0.12;
}
export function spawnDmgNum(x, y, text, head) {
  for (const d of dmgPool) {
    if (d.t <= 0) {
      d.t = 0.9; d.x = x; d.y = y;
      d.el.textContent = text; d.el.className = head ? 'dmg hs' : 'dmg';
      d.el.style.display = 'block'; return;
    }
  }
}
export function addKillfeed(s, killer, victim, weapon, head) {
  const div = document.createElement('div');
  div.className = 'kf';
  div.innerHTML = `<b>${killer}</b> <span class="wpn">${weapon}${head ? ' <span class="hs">HEADSHOT</span>' : ''}</span> <b>${victim}</b>`;
  els.killfeed.prepend(div);
  while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
  setTimeout(() => div.remove(), 6000);
}
export function renderRadio(s) {
  els.radio.innerHTML = s.radio.slice(-4).map((r) =>
    `<div class="radioLine"><b>${r.name}</b> <span class="role">${r.role}</span> — ${r.text}</div>`).join('');
}

function drawRadar(s, colliders) {
  const g = radarCtx, W = 336;
  g.clearRect(0, 0, W, W);
  g.fillStyle = 'rgba(10,16,36,0.85)'; g.fillRect(0, 0, W, W);
  const mx = (x) => ((x + 44) / 88) * W, mz = (z) => ((z + 34) / 80) * W;
  g.strokeStyle = 'rgba(120,140,190,0.35)'; g.lineWidth = 1;
  g.strokeRect(mx(-42), mz(-32), mx(42) - mx(-42), mz(44) - mz(-32));
  // site zones
  for (const k of ['A', 'B']) {
    const site = SITES[k];
    g.fillStyle = 'rgba(255,180,84,0.14)';
    g.beginPath(); g.arc(mx(site.x), mz(site.z), (site.r / 88) * W, 0, 7); g.fill();
    g.fillStyle = '#ffb454'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
    g.fillText(k, mx(site.x), mz(site.z) - 16);
  }
  // walls (top-down footprints)
  g.fillStyle = 'rgba(150,165,210,0.5)';
  for (const c of colliders) {
    if (c.y1 < 2) continue;
    g.fillRect(mx(c.x0), mz(c.z0), Math.max(2, mx(c.x1) - mx(c.x0)), Math.max(2, mz(c.z1) - mz(c.z0)));
  }
  // charge
  if (s.charge.state === 'dropped' || s.charge.state === 'planted') {
    g.fillStyle = s.charge.state === 'planted' ? '#ff6a5e' : '#ffd76a';
    g.beginPath(); g.arc(mx(s.charge.x), mz(s.charge.z), 6, 0, 7); g.fill();
  }
  // smokes
  g.fillStyle = 'rgba(200,205,220,0.4)';
  for (const sm of s.smokes) { g.beginPath(); g.arc(mx(sm.x), mz(sm.z), 9, 0, 7); g.fill(); }
  // dots: player + bots
  const dot = (x, z, col, yaw, you) => {
    g.fillStyle = col;
    g.beginPath(); g.arc(mx(x), mz(z), you ? 6 : 4.5, 0, 7); g.fill();
    g.strokeStyle = '#0a0e1e'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(mx(x), mz(z));
    g.lineTo(mx(x) + Math.sin(yaw) * 9, mz(z) + Math.cos(yaw) * 9); g.stroke();
  };
  for (const b of s.bots) {
    if (!b.alive) continue;
    dot(b.x, b.z, b.team === s.playerTeam ? '#6ec3ff' : '#ff8a7a', b.yaw, false);
  }
  dot(s.player.x, s.player.z, '#ffd76a', s.player.yaw, true);
}

export function updateHud(s, dt, camera, colliders, project, slow) {
  // `slow` gates the innerHTML rebuilds and the radar redraw to every 6th
  // frame; tags, damage numbers and the plant ring update every frame.
  els.scoreA.textContent = s.scores[TEAM_A];
  els.scoreB.textContent = s.scores[TEAM_B];
  els.roundTimer.textContent = s.phase === 'buy' ? 'BUY ' + fmtTime(s.phaseT) : fmtTime(s.phaseT);
  if (slow) {
    els.roundLabel.textContent = 'ROUND ' + s.round + ' · FIRST TO 7 · ' + (s.playerTeam === attackers(s) ? 'YOU ATTACK' : 'YOU DEFEND') + (s.phase === 'planted' ? ' · CHARGE ARMED' : '');
    const pips = [];
    for (let i = 0; i < 5; i++) pips.push(`<span class="pip a ${i < aliveCount(s, TEAM_A) ? '' : 'dead'}"></span>`);
    for (let i = 0; i < 5; i++) pips.push(`<span class="pip b ${i < aliveCount(s, TEAM_B) ? '' : 'dead'}"></span>`);
    els.aliveRow.innerHTML = pips.join('');
    els.planLine.innerHTML = 'PLAN: <em>' + s.plan + '</em> · ' + (s.playerTeam === attackers(s) ? 'CARRIER: ' + (s.charge.carrier === 0 ? 'YOU' : (s.bots.find((b) => b.id === s.charge.carrier) || {}).name || '—') : 'HOLD THE SITES');
  }
  // vitals
  const p = s.player;
  els.hpVal.textContent = Math.max(0, Math.ceil(p.hp));
  els.hpBar.firstElementChild.style.width = Math.max(0, p.hp) + '%';
  els.armourVal.textContent = Math.ceil(p.armour);
  els.vig.style.opacity = p.hp < 35 && p.alive ? String(0.4 + (35 - p.hp) * 0.015) : '0';
  els.flashOv.style.opacity = p.blind > 0 ? String(Math.min(1, p.blind)) : '0';
  els.scopeOv.style.display = p.scoped ? 'block' : 'none';
  // ammo
  const w = WEAPONS[p.slot];
  if (w.melee) { els.ammoMag.textContent = '—'; els.ammoRes.textContent = ''; }
  else { els.ammoMag.textContent = p.mags[p.slot] ?? 0; els.ammoRes.textContent = '/ ' + (p.reserves[p.slot] ?? 0); }
  els.wpnName.textContent = w.name + (p.reloading > 0 ? ' · RELOADING…' : '');
  els.fireMode.textContent = (w.auto ? 'AUTO' : 'SEMI') + ' · ' + w.cls;
  els.moneyVal.textContent = p.money;
  // grenades + teammate list rebuild on the slow tick only
  if (slow) {
    els.nadeBox.innerHTML = ['frag', 'flash', 'smoke', 'flare'].map((k) =>
      `<span class="nd ${p.nadeSel === k ? 'sel' : ''}">${NADES[k].icon} ${NADES[k].name.split(' ')[0]} ×${p.nades[k] || 0}</span>`).join('');
    els.mateList.innerHTML = s.bots.filter((b) => b.team === s.playerTeam).map((b) =>
      `<div class="mate ${b.alive ? '' : 'dead'}"><span class="nm">${b.name} <small style="color:#9fb4d8">${b.role}</small></span>
       ${s.charge.carrier === b.id && s.charge.state === 'carried' ? '<span class="chip">◈ CHARGE</span>' : ''}
       <span class="bar"><i style="width:${Math.max(0, b.hp)}%;background:${b.hp > 40 ? '#7ee2a0' : '#ff6a5e'}"></i></span>
       <span class="hp">${Math.max(0, Math.ceil(b.hp))}</span></div>`).join('');
  }
  // objective ring: the player's own channel, or a teammate's plant/defuse
  // in progress — the crew's plant stays legible while the player fights.
  let ringTotal = 0, ringProg = 0, ringText = '';
  if (p.channel > 0 && p.channelKind) {
    ringTotal = p.channelKind === 'plant' ? 4 : (p.hasKit ? 2.5 : 5);
    ringProg = p.channel; ringText = (p.channelKind === 'plant' ? 'PLANTING THE CHARGE…' : 'DEFUSING…');
  } else {
    const chan = s.bots.find((b) => b.alive && b.channel > 0 && (b.channelKind === 'plant' || b.channelKind === 'defuse'));
    if (chan) {
      ringTotal = chan.channelKind === 'plant' ? 4 : 5;
      ringProg = chan.channel;
      ringText = chan.name + (chan.channelKind === 'plant' ? ' PLANTING…' : ' DEFUSING…');
    }
  }
  els.objBox.style.display = ringTotal > 0 ? 'block' : 'none';
  if (ringTotal > 0) {
    els.ringFg.style.strokeDashoffset = String(213.6 * (1 - ringProg / ringTotal));
    els.objLabel.textContent = ringText + ' ' + Math.max(0, ringTotal - ringProg).toFixed(1) + 's';
  }
  const showChip = s.charge.state === 'carried' && s.playerTeam === attackers(s);
  els.chargeChip.style.display = showChip ? 'block' : 'none';
  if (showChip) els.chargeWho.textContent = s.charge.carrier === 0 ? 'YOU' : (s.bots.find((b) => b.id === s.charge.carrier) || {}).name || '—';
  els.plantedBar.style.display = s.phase === 'planted' ? 'block' : 'none';
  if (s.phase === 'planted') {
    els.plantSite.textContent = 'SITE ' + s.charge.site;
    els.plantFill.style.width = (s.charge.explodeT / 35 * 100) + '%';
  }
  // crosshair spread
  const gap = 6 + (p.bloom * 220) + (p.scoped ? -3 : 0);
  els.chL.style.left = (-gap - 8) + 'px'; els.chR.style.left = gap + 'px';
  els.chT.style.top = (-gap - 8) + 'px'; els.chB.style.top = gap + 'px';
  els.chL.style.display = els.chR.style.display = els.chT.style.display = els.chB.style.display = p.scoped ? 'none' : 'block';
  // banner / toast / hitmarker timers
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) els.banner.style.display = 'none'; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) els.toast.style.display = 'none'; }
  if (hitT > 0) { hitT -= dt; if (hitT <= 0) els.hitmark.style.opacity = '0'; }
  // damage numbers drift upward
  for (const d of dmgPool) {
    if (d.t <= 0) continue;
    d.t -= dt; d.y -= 34 * dt;
    if (d.t <= 0) { d.el.style.display = 'none'; continue; }
    d.el.style.left = d.x + 'px'; d.el.style.top = d.y + 'px';
    d.el.style.opacity = String(Math.min(1, d.t * 2));
  }
  // name tags: project bot heads, hide behind walls via distance only
  let ti = 0;
  for (const b of s.bots) {
    if (!b.alive || ti >= tagPool.length) continue;
    const pt = project(b.x, (b.feetY || 0) + 2.05, b.z);
    const tag = tagPool[ti++];
    if (!pt || pt.z > 1 || pt.x < -40 || pt.x > window.innerWidth + 40) { tag.style.display = 'none'; continue; }
    const foe = b.team !== s.playerTeam;
    tag.style.display = 'block';
    tag.className = 'tag ' + (foe ? 'foe' : 'friend');
    tag.style.left = pt.x + 'px'; tag.style.top = pt.y + 'px';
    tag.firstElementChild.textContent = b.name + (foe ? '' : ' · ' + b.role);
    const bar = tag.querySelector('.tbar i');
    bar.style.width = Math.max(0, b.hp) + '%';
    bar.style.background = foe ? '#ff8a7a' : '#6ec3ff';
  }
  for (; ti < tagPool.length; ti++) tagPool[ti].style.display = 'none';
  if (slow) drawRadar(s, colliders);
  if (buyOpen && slow) renderBuy(s);
}

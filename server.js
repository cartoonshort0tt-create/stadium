'use strict';

// Messi vs Ronaldo (full-screen stadium) — local network game server.
// No dependencies: run with `node server.js`.
//   Game screen (PC / TikTok Live Studio):  http://localhost:3000
//   Phone control panel (same Wi-Fi):        http://<pc-ip>:3000/control

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'scores.json');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.env.PORT) || config.port || 3000;

const TEAMS = ['messi', 'ronaldo'];
const MAX_COINS = 1000000;
const GOALS_PER_COIN = Math.max(1, Math.floor(Number(config.goalsPerCoin) || 1));
const HISTORY_LIMIT = 200;
const RECENT = 8;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- State (persisted so a restart keeps the score) ----------

const state = { scores: { messi: 0, ronaldo: 0 }, history: [], nextId: 1 };

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

const ROUND_MS = clampNum(config.roundSeconds, 10, 3600, 180) * 1000;
const INTERMISSION_MS = clampNum(config.intermissionSeconds, 3, 120, 12) * 1000;
const AUTO_NEXT_ROUND = config.autoStartNextRound !== false;

// Match clock. phase: ready -> running <-> paused -> intermission -> (next round)
const match = {
  phase: 'ready',
  duration: ROUND_MS,
  remaining: ROUND_MS, // ms left, used while not running
  endsAt: 0, // epoch ms, used while running / in intermission
  round: 1,
  wins: { messi: 0, ronaldo: 0 },
  streak: { team: null, count: 0 },
  lastResult: null,
};

function load() {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  } catch {
    return; // first run
  }
  for (const t of TEAMS) state.scores[t] = Number(saved.scores && saved.scores[t]) || 0;
  if (Array.isArray(saved.history)) state.history = saved.history.slice(-HISTORY_LIMIT);
  const maxId = state.history.reduce((m, e) => Math.max(m, e.id || 0), 0);
  state.nextId = Math.max(Number(saved.nextId) || 1, maxId + 1);

  const m = saved.match;
  if (!m) return;
  match.duration = clampNum(m.duration, 10000, 3600000, ROUND_MS);
  match.round = Number(m.round) || 1;
  for (const t of TEAMS) match.wins[t] = Number(m.wins && m.wins[t]) || 0;
  if (m.streak && TEAMS.includes(m.streak.team)) match.streak = { team: m.streak.team, count: Number(m.streak.count) || 0 };
  match.lastResult = m.lastResult || null;
  // A round that was in progress when the server stopped resumes paused.
  const left = m.phase === 'running' ? m.endsAt - Date.now() : Number(m.remaining);
  if ((m.phase === 'running' || m.phase === 'paused') && left > 0) {
    match.phase = 'paused';
    match.remaining = left;
  } else {
    match.phase = 'ready';
    match.remaining = match.duration;
  }
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify({ ...state, match }));
  } catch (err) {
    console.error('Could not save scores:', err.message);
  }
}

function matchView() {
  const live = match.phase === 'running' || match.phase === 'intermission';
  return {
    phase: match.phase,
    duration: match.duration,
    remaining: live ? Math.max(0, match.endsAt - Date.now()) : match.remaining,
    round: match.round,
    wins: { ...match.wins },
    streak: { ...match.streak },
    lastResult: match.lastResult,
    autoNextRound: AUTO_NEXT_ROUND,
  };
}

function snapshot() {
  return { scores: { ...state.scores }, recent: state.history.slice(-RECENT).reverse(), match: matchView() };
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}

// ---------- Live updates (Server-Sent Events) ----------

const clients = new Set();

function broadcast(msg) {
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000);

function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'state', ...snapshot() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------- Actions ----------

function spawn(body) {
  const team = body.team;
  if (!TEAMS.includes(team)) throw new HttpError(400, 'team must be "messi" or "ronaldo"');
  const coins = Math.floor(Number(body.coins));
  if (!Number.isFinite(coins) || coins < 1 || coins > MAX_COINS) {
    throw new HttpError(400, `coins must be between 1 and ${MAX_COINS}`);
  }
  const count = coins * GOALS_PER_COIN; // goals
  const entry = {
    id: state.nextId++,
    team,
    count,
    coins,
    gift: clean(body.gift, 40),
    sender: clean(body.sender, 30),
    time: Date.now(),
  };
  state.scores[team] += count;
  state.history.push(entry);
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  save();
  broadcast({ type: 'spawn', ...entry, ...snapshot() });
  return { ok: true, entry, ...snapshot() };
}

function undo() {
  const entry = state.history.pop();
  if (!entry) throw new HttpError(409, 'Nothing to undo');
  state.scores[entry.team] = Math.max(0, state.scores[entry.team] - entry.count);
  save();
  broadcast({ type: 'undo', id: entry.id, team: entry.team, count: entry.count, ...snapshot() });
  return { ok: true, undone: entry, ...snapshot() };
}

function reset() {
  state.scores = { messi: 0, ronaldo: 0 };
  state.history = [];
  save();
  broadcast({ type: 'reset', ...snapshot() });
  return { ok: true, ...snapshot() };
}

// ---------- Match clock ----------

function announce(event, extra) {
  save();
  broadcast({ type: 'match', event, ...extra, ...snapshot() });
}

function startClock() {
  if (match.phase === 'running') return;
  if (match.phase === 'intermission') return newRound(true);
  const fresh = match.phase === 'ready';
  match.phase = 'running';
  match.endsAt = Date.now() + match.remaining;
  announce(fresh ? 'start' : 'resume');
}

function pauseClock() {
  if (match.phase !== 'running') return;
  match.remaining = Math.max(0, match.endsAt - Date.now());
  match.phase = 'paused';
  announce('pause');
}

function addTime(seconds) {
  if (!Number.isFinite(seconds) || !seconds) throw new HttpError(400, 'seconds must be a number');
  if (match.phase === 'intermission') throw new HttpError(409, 'The round is over');
  const ms = seconds * 1000;
  if (match.phase === 'running') match.endsAt = Math.max(Date.now() + 1000, match.endsAt + ms);
  else match.remaining = Math.min(3600000, Math.max(1000, match.remaining + ms));
  announce('time');
}

function setDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 10 || seconds > 3600) {
    throw new HttpError(400, 'Round length must be 10-3600 seconds');
  }
  match.duration = Math.round(seconds) * 1000;
  if (match.phase === 'ready') match.remaining = match.duration;
  announce('time');
}

function endRound() {
  const s = state.scores;
  const winner = s.messi > s.ronaldo ? 'messi' : s.ronaldo > s.messi ? 'ronaldo' : 'draw';
  if (winner === 'draw') {
    match.streak = { team: null, count: 0 };
  } else {
    match.wins[winner]++;
    match.streak = match.streak.team === winner
      ? { team: winner, count: match.streak.count + 1 }
      : { team: winner, count: 1 };
  }
  match.lastResult = { round: match.round, winner, scores: { ...s } };
  match.round++;
  match.phase = 'intermission';
  match.endsAt = Date.now() + INTERMISSION_MS;
  // Gifts from now on count towards the next round.
  state.scores = { messi: 0, ronaldo: 0 };
  state.history = [];
  console.log(`Round ${match.lastResult.round}: ${s.messi}-${s.ronaldo} (${winner === 'draw' ? 'draw' : winner + ' wins'})`);
  announce('end');
}

function newRound(run) {
  match.phase = run ? 'running' : 'ready';
  match.remaining = match.duration;
  match.endsAt = run ? Date.now() + match.duration : 0;
  announce(run ? 'start' : 'ready');
}

setInterval(() => {
  const t = Date.now();
  if (match.phase === 'running' && t >= match.endsAt) endRound();
  else if (match.phase === 'intermission' && t >= match.endsAt) newRound(AUTO_NEXT_ROUND);
}, 200);

function timerAction(body) {
  switch (body.action) {
    case 'start':
      startClock();
      break;
    case 'pause':
      pauseClock();
      break;
    case 'toggle':
      if (match.phase === 'running') pauseClock();
      else startClock();
      break;
    case 'reset':
      if (match.phase === 'intermission') {
        newRound(false);
      } else {
        match.phase = 'ready';
        match.remaining = match.duration;
        announce('ready');
      }
      break;
    case 'add':
      addTime(Number(body.seconds));
      break;
    case 'duration':
      setDuration(Number(body.seconds));
      break;
    case 'end':
      if (match.phase !== 'intermission') endRound();
      break;
    case 'resetWins':
      match.wins = { messi: 0, ronaldo: 0 };
      match.streak = { team: null, count: 0 };
      match.lastResult = null;
      announce('wins');
      break;
    default:
      throw new HttpError(400, 'Unknown timer action');
  }
  return { ok: true, ...snapshot() };
}

// Celebration sound requested from the controller; played by the game screen.
const SOUNDS = ['messi', 'ronaldo', 'goal', 'senor', 'stop'];

function playSound(body) {
  const team = body.team;
  if (!SOUNDS.includes(team)) throw new HttpError(400, `sound must be one of: ${SOUNDS.join(', ')}`);
  broadcast({ type: 'sound', team });
  return { ok: true };
}

function publicConfig() {
  return {
    teams: config.teams,
    gifts: config.gifts,
    goalsPerCoin: GOALS_PER_COIN,
    tip: config.tip,
    boardText: config.boardText,
  };
}

// ---------- HTTP ----------

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10000) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(pathname, res) {
  const alias = { '/': '/index.html', '/control': '/control.html' };
  let rel;
  try {
    rel = decodeURIComponent(alias[pathname] || pathname);
  } catch {
    throw new HttpError(400, 'Bad path');
  }
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${pathname}`;
    if (route === 'GET /events') return openStream(req, res);
    if (route === 'GET /api/config') return json(res, 200, publicConfig());
    if (route === 'GET /api/state') return json(res, 200, snapshot());
    if (route === 'GET /api/info') {
      return json(res, 200, { controlUrls: lanAddresses().map((a) => `http://${a.address}:${PORT}/control`) });
    }
    if (route === 'POST /api/spawn') return json(res, 200, spawn(await readJson(req)));
    if (route === 'POST /api/undo') return json(res, 200, undo());
    if (route === 'POST /api/reset') return json(res, 200, reset());
    if (route === 'POST /api/sound') return json(res, 200, playSound(await readJson(req)));
    if (route === 'POST /api/timer') return json(res, 200, timerAction(await readJson(req)));
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(pathname, res);
    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    json(res, status, { error: err.message });
  }
});

// LAN addresses, best guess first: real Wi-Fi/Ethernet adapters with home-network
// addresses (192.168.x.x etc.) before VPN / VirtualBox / WSL / Hyper-V adapters.
const VIRTUAL_ADAPTER = /virtual|vbox|vmware|vethernet|wsl|hyper-v|docker|loopback|tailscale|zerotier|hamachi|vpn|tap|tun|bluetooth/i;

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const virtual = VIRTUAL_ADAPTER.test(name);
      const home = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const wifi = /wi-?fi|wlan|wireless/i.test(name);
      out.push({ name, address: a.address, virtual, score: (virtual ? 0 : 4) + (home ? 2 : 0) + (wifi ? 1 : 0) });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the other copy or change "port" in config.json.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

load();
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ⚽  Messi vs Ronaldo — STADIUM is running!');
  console.log('');
  console.log(`  Game screen (open on this PC):  http://localhost:${PORT}`);
  const ips = lanAddresses();
  if (ips.length) {
    console.log('');
    console.log('  Phone control (phone on the SAME Wi-Fi, type it exactly, with http://):');
    console.log(`      >>>  http://${ips[0].address}:${PORT}/control   (${ips[0].name})`);
    const others = ips.slice(1);
    if (others.length) {
      console.log('  If that one does not open, try:');
      for (const ip of others) {
        console.log(`           http://${ip.address}:${PORT}/control   (${ip.name}${ip.virtual ? ', probably virtual' : ''})`);
      }
    }
  } else {
    console.log('  No network found - is this PC connected to Wi-Fi or a cable?');
  }
  console.log('');
  console.log('  Phone cannot connect? Double-click allow-phone.bat (fixes Windows Firewall).');
  console.log('');
  console.log(`  Current score: ${config.teams.messi.name} ${state.scores.messi} - ${state.scores.ronaldo} ${config.teams.ronaldo.name}`);
  console.log(`  Wins: ${config.teams.messi.name} ${match.wins.messi} - ${match.wins.ronaldo} ${config.teams.ronaldo.name}   (round ${match.round}, ${Math.round(match.duration / 1000)}s)`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

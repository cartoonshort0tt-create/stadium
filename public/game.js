(() => {
  'use strict';

  // ---------- Layout: logical 1920x1080 landscape (full-screen PC), scaled to fit ----------
  const W = 1920;
  const H = 1080;
  const HW = 1080; // the scoreboard is laid out on a 1080-wide strip, centred at the top
  const PITCH = { x: 170, y: 250, w: 1580, h: 760 };
  const RUNOFF = { x: PITCH.x - 80, y: PITCH.y - 24, w: PITCH.w + 160, h: PITCH.h + 48 };
  const CX = PITCH.x + PITCH.w / 2;
  const CY = PITCH.y + PITCH.h / 2;
  const MID_Y = CY; // centre line used by the shared drawing code
  const GOAL_HALF = 115; // half width of the goal mouth
  const NET_DEPTH = 60;
  const GOAL_HEIGHT = 80; // crossbar height (pseudo-3D)
  const BALL_R = 18;
  const GRAVITY = 2600;
  const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';
  const OUTLINE = '#15161c';

  const KITS = {
    messi: {
      stripes: ['#A50044', '#004D98'], sleeve: '#004D98', shorts: '#004D98', socks: '#A50044',
      number: '#EDBB00', trim: '#EDBB00', skin: '#F1C29B', hair: '#5B3A21',
      confetti: ['#A50044', '#004D98', '#EDBB00'],
    },
    ronaldo: {
      stripes: ['#FFFFFF'], sleeve: '#FFFFFF', shorts: '#FFFFFF', socks: '#FFFFFF',
      number: '#1B2A6B', trim: '#D4AF37', skin: '#D9A27A', hair: '#1A1411',
      confetti: ['#FFFFFF', '#D4AF37', '#1B2A6B'],
    },
  };

  // Messi attacks the right goal, Ronaldo the left one.
  const GOALS = {
    left: { x: PITCH.x, dir: -1, shake: 0 },
    right: { x: PITCH.x + PITCH.w, dir: 1, shake: 0 },
  };
  const ATTACK = { messi: 'right', ronaldo: 'left' };
  const DIR = { messi: 1, ronaldo: -1 };
  const OPP = { messi: 'ronaldo', ronaldo: 'messi' };
  const HOME = { messi: { x: CX - 330, y: CY + 10 }, ronaldo: { x: CX + 330, y: CY + 10 } };
  const SKILLS = ['NUTMEG!', 'RAINBOW FLICK!', 'ELASTICO!', 'ROULETTE!', 'STEP OVER!'];

  let CONFIG = {
    teams: {
      messi: { name: 'MESSI', number: '10', celebrate: '¡VAMOS!' },
      ronaldo: { name: 'RONALDO', number: '7', celebrate: 'SIUUU!' },
    },
    tip: '',
    boardText: 'SEND A GIFT TO SCORE FOR YOUR TEAM!',
  };

  // ---------- Helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

  // Seeded random so the pre-rendered grass texture is identical after every resize.
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatTime(ms) {
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  const canvas = document.getElementById('game');
  const mainCtx = canvas.getContext('2d');
  const bg = document.createElement('canvas'); // pre-rendered stadium + pitch
  const bgCtx = bg.getContext('2d');
  let ctx = mainCtx; // swapped to bgCtx while pre-rendering

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  // Sets a font no larger than `size` that fits `text` within `maxW`.
  function fitFont(text, maxW, size, weight = '900') {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const w = ctx.measureText(text).width;
    if (w > maxW) ctx.font = `${weight} ${Math.floor((size * maxW) / w)}px ${FONT}`;
  }

  function outlinedText(text, x, y, fill, stroke, lw) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function teamFill(team, x0, x1) {
    if (team !== 'messi') return '#FFFFFF';
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#004D98');
    g.addColorStop(1, '#A50044');
    return g;
  }

  // ---------- Sound (Web Audio, no files needed) ----------
  const Sound = {
    ctx: null,
    noise: null,
    muted: false,
    lastGoal: 0,
    init() {
      if (this.ctx) return;
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    },
    ready() {
      return this.ctx && !this.muted;
    },
    tone(freq, dur, vol, type = 'sine') {
      if (!this.ready()) return;
      const c = this.ctx;
      const t = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    kick() {
      if (!this.ready()) return;
      const c = this.ctx;
      const t = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(190, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.45, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.16);
    },
    // Referee whistle: one blast per entry (seconds).
    whistle(blasts) {
      if (!this.ready()) return;
      const c = this.ctx;
      let t = c.currentTime;
      for (const d of blasts) {
        const o = c.createOscillator();
        const lfo = c.createOscillator();
        const depth = c.createGain();
        const g = c.createGain();
        o.frequency.value = 2750;
        lfo.frequency.value = 34;
        depth.gain.value = 170;
        lfo.connect(depth).connect(o.frequency);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
        g.gain.setValueAtTime(0.13, t + d - 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(c.destination);
        o.start(t);
        lfo.start(t);
        o.stop(t + d + 0.02);
        lfo.stop(t + d + 0.02);
        t += d + 0.12;
      }
    },
    goal(big) {
      if (!this.ready()) return;
      const c = this.ctx;
      const t = c.currentTime;
      if (t - this.lastGoal < 0.15) return;
      this.lastGoal = t;
      const len = big ? 2.6 : 1.4;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 0.6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(big ? 0.5 : 0.32, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t);
      src.stop(t + len);
      for (const freq of big ? [392, 494, 587] : [440, 554]) {
        const o = c.createOscillator();
        const og = c.createGain();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
        og.gain.exponentialRampToValueAtTime(0.001, t + (big ? 0.9 : 0.4));
        o.connect(og).connect(c.destination);
        o.start(t);
        o.stop(t + 1);
      }
    },
  };

  // Celebration clips (public/sounds/*.mp3), triggered from the controller.
  const CLIPS = {
    messi: new Audio('/sounds/messi.mp3'),
    ronaldo: new Audio('/sounds/ronaldo.mp3'),
    goal: new Audio('/sounds/goal.mp3'),
    senor: new Audio('/sounds/senor.mp3'),
  };
  for (const a of Object.values(CLIPS)) a.preload = 'auto';

  function stopClips() {
    for (const a of Object.values(CLIPS)) {
      a.pause();
      a.currentTime = 0;
    }
  }

  function playClip(team) {
    stopClips();
    if (team === 'stop' || !CLIPS[team]) return;
    if (!Sound.muted) CLIPS[team].play().catch((err) => console.warn('Sound blocked — click Start on the game screen first.', err));
    if (!players[team]) {
      // general goal shouts: the whole crowd jumps
      cheer.messi = 1;
      cheer.ronaldo = 1;
      return;
    }
    const p = players[team];
    if (p.state !== 'kick') Object.assign(p, { state: 'celebrate', stateT: 3 });
    cheer[team] = 1;
  }

  // ---------- Game state ----------
  const serverScores = { messi: 0, ronaldo: 0 };
  const shown = { messi: 0, ronaldo: 0 };
  const pop = { messi: 0, ronaldo: 0 };
  const cheer = { messi: 0, ronaldo: 0 };
  let queue = []; // attacks waiting: { team, value, parts: [{ id, count }] }
  let active = null; // the attack being played
  let ball = null; // the ball of the active attack
  let netBalls = []; // scored balls resting in the net
  let particles = [];
  let floats = [];
  let skillTexts = [];
  let banner = null;
  let now = 0;
  let idleSince = 0;

  const match = {
    phase: 'ready', duration: 180000, remaining: 180000, round: 1,
    wins: { messi: 0, ronaldo: 0 }, streak: { team: null, count: 0 },
    lastResult: null, autoNextRound: true, recvAt: 0,
  };
  let resultT = 99;
  let lastBeep = 0;

  function makePlayer(team) {
    const home = HOME[team];
    return {
      team, home, x: home.x, y: home.y, face: DIR[team], state: 'idle', stateT: 0,
      anim: Math.random() * 10, moving: false, kickT: 0, tilt: 0, lunge: null,
    };
  }
  const players = { messi: makePlayer('messi'), ronaldo: makePlayer('ronaldo') };

  // Goals still to be scored on screen for a team.
  function pending(team) {
    let n = 0;
    for (const q of queue) if (q.team === team) n += q.value;
    if (active && active.team === team && !active.scored) n += active.value;
    return n;
  }

  // Everything speeds up while attacks are waiting.
  function speedMult() {
    return Math.min(3.2, 1 + queue.length * 0.3);
  }

  function timeLeft() {
    const live = match.phase === 'running' || match.phase === 'intermission';
    return Math.max(0, match.remaining - (live ? performance.now() - match.recvAt : 0));
  }

  // ---------- Server events ----------
  function setScores(scores) {
    if (!scores) return;
    for (const t of ['messi', 'ronaldo']) serverScores[t] = Number(scores[t]) || 0;
  }

  function setMatch(m) {
    if (!m) return;
    Object.assign(match, m);
    match.recvAt = performance.now();
  }

  function onSpawn(msg) {
    const part = { id: msg.id, count: msg.count };
    const last = queue[queue.length - 1];
    // A long line of gifts for the same team is merged into one bigger attack.
    if (last && last.team === msg.team && queue.length >= 3) {
      last.value += msg.count;
      last.parts.push(part);
    } else {
      queue.push({ team: msg.team, value: msg.count, parts: [part] });
    }
    addFloat(msg);
  }

  function onUndo(msg) {
    const strip = (item) => {
      const part = item.parts.find((p) => p.id === msg.id);
      if (!part) return;
      item.value -= part.count;
      item.parts = item.parts.filter((p) => p !== part);
    };
    for (const q of queue) strip(q);
    queue = queue.filter((q) => q.value > 0);
    if (active && !active.scored) {
      strip(active);
      if (active.value <= 0) abortAttack();
      else if (ball) ball.value = active.value;
    }
  }

  function abortAttack() {
    if (active) {
      for (const p of [active.A, active.D]) Object.assign(p, { state: 'idle', tilt: 0, lunge: null });
    }
    active = null;
    ball = null;
    idleSince = now;
  }

  function clearField() {
    queue = [];
    if (active && !active.scored) abortAttack();
    for (const t of ['messi', 'ronaldo']) shown[t] = 0;
  }

  function onReset() {
    clearField();
    abortAttack();
    netBalls = [];
    floats = [];
    banner = null;
    for (const t of ['messi', 'ronaldo']) {
      Object.assign(players[t], { state: 'idle', tilt: 0, x: players[t].home.x, y: players[t].home.y });
    }
  }

  function onMatchEvent(msg) {
    switch (msg.event) {
      case 'start':
        banner = { team: null, text: `KICK-OFF! ROUND ${match.round}`, t: 0, big: false };
        Sound.whistle([0.6]);
        break;
      case 'resume':
      case 'pause':
        Sound.whistle([0.25]);
        break;
      case 'end': {
        Sound.whistle([0.3, 0.3, 0.9]);
        clearField();
        banner = null;
        resultT = 0;
        const r = match.lastResult;
        const stay = (match.remaining || 10000) / 1000;
        if (r && r.winner !== 'draw') {
          Object.assign(players[r.winner], { state: 'celebrate', stateT: stay });
          Object.assign(players[OPP[r.winner]], { state: 'sad', stateT: stay, tilt: 0 });
          cheer[r.winner] = 1;
          Sound.goal(true);
        } else {
          for (const t of ['messi', 'ronaldo']) Object.assign(players[t], { state: 'sad', stateT: 2.5, tilt: 0 });
        }
        break;
      }
      default:
        break;
    }
  }

  function handle(msg) {
    setMatch(msg.match);
    setScores(msg.scores);
    if (msg.type === 'spawn') onSpawn(msg);
    else if (msg.type === 'undo') onUndo(msg);
    else if (msg.type === 'reset') onReset(msg);
    else if (msg.type === 'match') onMatchEvent(msg);
    else if (msg.type === 'sound') playClip(msg.team);
  }

  function connect() {
    const es = new EventSource('/events');
    es.onmessage = (e) => {
      try {
        handle(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).catch((err) => console.error(err));
  }

  // ---------- Movement helpers ----------
  // Moves p towards (tx, ty); returns the distance still left.
  function moveTo(p, tx, ty, speed, dt) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    if (Math.abs(dx) > 2) p.face = dx > 0 ? 1 : -1;
    if (d <= step || d < 0.5) {
      p.x = tx;
      p.y = ty;
      p.moving = false;
      return 0;
    }
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    p.moving = true;
    return d - step;
  }

  // Ball close to the dribbler's feet, nudged forward with each touch.
  function ballAtFeet(p, dir, t) {
    ball.x = p.x + dir * (30 + 12 * Math.abs(Math.sin(t * 9)));
    ball.y = p.y + 4;
    ball.z = 0;
    ball.rot += dir * 0.28;
  }

  function bezier(p0, p1, p2, u) {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
  }

  // ---------- Attack: drop -> dribble -> skill past the defender -> run -> shoot -> goal ----------
  function startAttack(item) {
    const team = item.team;
    const A = players[team];
    const D = players[OPP[team]];
    const dir = DIR[team];
    const goal = GOALS[ATTACK[team]];
    for (const p of [A, D]) Object.assign(p, { state: 'idle', tilt: 0, lunge: null });
    A.face = dir;
    D.face = -dir;
    const laneY = clamp(A.y + rand(-70, 70), PITCH.y + 160, PITCH.y + PITCH.h - 140);
    const E = clamp(A.x + dir * rand(400, 520), PITCH.x + 320, PITCH.x + PITCH.w - 320);
    active = {
      team, value: item.value, parts: item.parts, A, D, dir, goal,
      phase: 'drop', t: 0, laneY, E, lunged: false, scored: false,
      block: { x: E + dir * 90, y: laneY + rand(-25, 25) },
      skill: pick(SKILLS),
      S: { x: goal.x - dir * rand(230, 320), y: CY + rand(-120, 120) },
    };
    ball = {
      x: A.x + dir * 34, y: A.y + 4, z: 620, vz: 0, r: BALL_R, rot: 0,
      state: 'drop', value: item.value, team, alpha: 1, netT: 0, vx: 0, vy: 0,
    };
  }

  function nextPhase(phase) {
    active.phase = phase;
    active.t = 0;
  }

  function updateAttack(dt) {
    const a = active;
    const { A, D, dir } = a;
    a.t += dt;
    switch (a.phase) {
      case 'drop':
        ball.vz -= GRAVITY * dt;
        ball.z += ball.vz * dt;
        if (ball.z <= 0) {
          ball.z = 0;
          if (Math.abs(ball.vz) < 230) {
            ball.vz = 0;
            ball.state = 'feet';
            nextPhase('dribble');
          } else {
            ball.vz = -ball.vz * 0.42;
          }
        }
        moveTo(D, a.block.x, a.block.y, 260, dt);
        break;

      case 'dribble': {
        const left = moveTo(A, a.E - dir * 70, a.laneY, 330, dt);
        ballAtFeet(A, dir, a.t);
        moveTo(D, a.block.x, a.block.y, 300, dt);
        if (!D.moving) D.face = -dir;
        if (left === 0) {
          const s = D.y >= a.laneY ? -1 : 1; // go round the side the defender isn't on
          a.P0 = { x: A.x, y: A.y };
          a.P1 = { x: D.x, y: D.y + s * 165 };
          a.P2 = { x: D.x + dir * 185, y: a.laneY + s * 40 };
          a.ball0 = { x: ball.x, y: ball.y };
          a.ball1 = { x: a.P2.x + dir * 34, y: a.P2.y + 4 };
          skillTexts.push({ text: a.skill, x: A.x, y: A.y - 210, t: 0 });
          nextPhase('skill');
        }
        break;
      }

      case 'skill': {
        const u = Math.min(1, a.t / 0.75);
        const q = bezier(a.P0, a.P1, a.P2, u);
        A.x = q.x;
        A.y = q.y;
        A.moving = true;
        A.face = a.skill === 'ROULETTE!' && u > 0.2 && u < 0.7 ? (Math.sin(a.t * 45) > 0 ? 1 : -1) : dir;
        if (a.skill === 'NUTMEG!' || a.skill === 'RAINBOW FLICK!') {
          ball.x = a.ball0.x + (a.ball1.x - a.ball0.x) * u;
          ball.y = a.ball0.y + (a.ball1.y - a.ball0.y) * u;
          ball.z = a.skill === 'RAINBOW FLICK!' ? 4 * 130 * u * (1 - u) : 0;
          ball.rot += dir * 0.3;
        } else {
          ballAtFeet(A, dir, a.t);
        }
        if (!a.lunged && u >= 0.22) {
          a.lunged = true;
          D.state = 'tackle';
          D.face = -dir;
          D.lunge = { t: 0, x0: D.x, y0: D.y, x1: D.x - dir * 60, y1: D.y + (ball.y - D.y) * 0.9 };
        }
        if (u >= 1) nextPhase('run');
        break;
      }

      case 'run': {
        const left = moveTo(A, a.S.x, a.S.y, 360, dt);
        ballAtFeet(A, dir, a.t);
        if (left === 0) {
          A.face = dir;
          A.moving = false;
          A.state = 'kick';
          A.kickT = 0;
          nextPhase('shoot');
        }
        break;
      }

      case 'shoot':
        A.kickT = a.t;
        if (a.t >= 0.12) {
          launch(a);
          nextPhase('flying');
        }
        break;

      case 'flying':
        A.kickT = 0.12 + a.t;
        if (A.state === 'kick' && A.kickT > 0.3) A.state = 'idle';
        updateShot(dt);
        if (ball.state === 'net') nextPhase('celebrate');
        break;

      case 'celebrate':
        if (a.t >= (queue.length ? 0.45 : 1.3)) finishAttack();
        break;

      default:
        break;
    }
  }

  function launch(a) {
    const g = a.goal;
    const tx = g.x + a.dir * 26;
    const ty = CY + rand(-GOAL_HALF + 30, GOAL_HALF - 30);
    const dx = tx - ball.x;
    const dy = ty - ball.y;
    const dist = Math.hypot(dx, dy) || 1;
    ball.shot = {
      u: 0, x0: ball.x, y0: ball.y, x1: tx, y1: ty, dur: Math.max(0.18, dist / 1500),
      h: rand(30, 110), zEnd: rand(4, GOAL_HEIGHT - 2 * BALL_R - 6), curve: rand(-60, 60),
      nx: -dy / dist, ny: dx / dist, dx: dx / dist, dy: dy / dist,
    };
    ball.state = 'shot';
    Sound.kick();
  }

  function updateShot(dt) {
    const s = ball.shot;
    s.u = Math.min(1, s.u + dt / s.dur);
    const u = s.u;
    const off = s.curve * Math.sin(Math.PI * u);
    ball.x = s.x0 + (s.x1 - s.x0) * u + s.nx * off;
    ball.y = s.y0 + (s.y1 - s.y0) * u + s.ny * off;
    ball.z = s.zEnd * u + 4 * s.h * u * (1 - u);
    ball.rot += dt * 22 * active.dir;
    if (u >= 1) {
      ball.state = 'net';
      ball.vx = s.dx * 320;
      ball.vy = s.dy * 320;
      ball.vz = 0;
      scoreGoal(active);
    }
  }

  // Ball resting in the net slows down, drops and fades.
  function updateNetBall(b, dt) {
    const g = GOALS[ATTACK[b.team]];
    b.netT += dt;
    b.vz -= GRAVITY * dt;
    b.z = Math.max(0, b.z + b.vz * dt);
    if (b.z === 0) b.vz = 0;
    const f = Math.exp(-7 * dt);
    b.vx *= f;
    b.vy *= f;
    const inner = g.x + g.dir * (NET_DEPTH - b.r);
    b.x = clamp(b.x + b.vx * dt, Math.min(g.x, inner), Math.max(g.x, inner));
    b.y = clamp(b.y + b.vy * dt, CY - GOAL_HALF + b.r, CY + GOAL_HALF - b.r);
    if (b.netT > 1.2) b.alpha -= dt * 2.5;
  }

  function scoreGoal(a) {
    a.scored = true;
    ball.scored = true;
    const team = a.team;
    const g = a.goal;
    g.shake = 1;
    cheer[team] = 1;
    const big = a.value >= 500;
    burst(g.x, ball.y - 30, team, Math.min(180, 40 + Math.floor(a.value / 4)));
    banner = big
      ? { team, text: `MEGA GOAL +${a.value}!`, t: 0, big: true }
      : { team, text: `GOAL! +${a.value}`, t: 0, big: false };
    Sound.goal(big);
    a.A.state = 'celebrate';
    a.A.stateT = queue.length ? 0.6 : 1.6;
    if (a.D.state !== 'tackle' && a.D.state !== 'down' && a.D.state !== 'getup') {
      a.D.state = 'sad';
      a.D.stateT = 1.4;
    }
  }

  function finishAttack() {
    if (ball) netBalls.push(ball);
    if (queue.length && active.A.state === 'celebrate') active.A.state = 'idle';
    active = null;
    ball = null;
    idleSince = now;
  }

  function playersReady() {
    const home = (p) => Math.hypot(p.x - p.home.x, p.y - p.home.y) < 30;
    return (home(players.messi) && home(players.ronaldo)) || now - idleSince > 2.2;
  }

  function updatePlayers(dt, sdt) {
    for (const p of Object.values(players)) {
      p.anim += dt;
      if (p.state === 'tackle') {
        // slide in, then fall over
        const L = p.lunge;
        L.t += sdt;
        const u = Math.min(1, L.t / 0.25);
        p.x = L.x0 + (L.x1 - L.x0) * u;
        p.y = L.y0 + (L.y1 - L.y0) * u;
        p.tilt = p.face * 1.25 * u;
        p.moving = false;
        if (u >= 1) {
          p.state = 'down';
          p.stateT = 0.9;
          dust(p.x, p.y);
        }
        continue;
      }
      if (p.state === 'down') {
        p.stateT -= sdt;
        if (p.stateT <= 0) {
          p.state = 'getup';
          p.stateT = 0.25;
        }
        continue;
      }
      if (p.state === 'getup') {
        p.stateT -= sdt;
        p.tilt = p.face * 1.25 * Math.max(0, p.stateT / 0.25);
        if (p.stateT <= 0) {
          p.tilt = 0;
          p.state = 'idle';
        }
        continue;
      }
      if (p.state === 'celebrate' || p.state === 'sad') {
        p.stateT -= dt;
        if (p.stateT <= 0) p.state = 'idle';
      }
      const busy = active && (p === active.A || p === active.D);
      if (!busy) {
        moveTo(p, p.home.x, p.home.y, 420 * speedMult(), dt);
        if (!p.moving) p.face = DIR[p.team];
      }
    }
  }

  // ---------- Effects ----------
  function burst(x, y, team, n) {
    const cols = KITS[team].confetti;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(200, 950);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 350, g: 900,
        rot: rand(0, 6), vr: rand(-12, 12), w: rand(8, 16), h: rand(5, 10),
        c: cols[i % cols.length], life: rand(1.2, 2.2),
      });
    }
    trimParticles();
  }

  function dust(x, y) {
    const cols = ['#8b6b3d', '#a5844f', '#6fb84a', '#c9b48a'];
    for (let i = 0; i < 26; i++) {
      const a = rand(Math.PI, Math.PI * 2);
      const s = rand(80, 320);
      particles.push({
        x: x + rand(-30, 30), y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 700,
        rot: rand(0, 6), vr: rand(-6, 6), w: rand(4, 9), h: rand(4, 9), c: pick(cols), life: rand(0.4, 0.8),
      });
    }
    trimParticles();
  }

  function rain(team, n) {
    const cols = KITS[team].confetti;
    for (let i = 0; i < n; i++) {
      particles.push({
        x: rand(PITCH.x, PITCH.x + PITCH.w), y: rand(PITCH.y - 60, PITCH.y + 10), vx: rand(-40, 40), vy: rand(80, 180), g: 60,
        rot: rand(0, 6), vr: rand(-8, 8), w: rand(10, 18), h: rand(6, 10), c: pick(cols), life: rand(4, 7),
      });
    }
    trimParticles();
  }

  function trimParticles() {
    if (particles.length > 1000) particles.splice(0, particles.length - 1000);
  }

  function addFloat(msg) {
    const team = msg.team;
    const stack = floats.filter((f) => f.team === team).length;
    floats.push({
      team,
      text: `${msg.gift ? msg.gift + '  ' : ''}+${msg.count}`,
      sub: msg.sender ? `from ${msg.sender}` : '',
      x: team === 'messi' ? CX - 420 : CX + 420,
      y: PITCH.y + 70 + (stack % 4) * 82,
      t: 0,
    });
    if (floats.length > 8) floats.shift();
  }

  // ---------- Update ----------
  function update(dt) {
    const sdt = dt * speedMult();
    if (!active && queue.length && playersReady()) startAttack(queue.shift());
    if (active) updateAttack(sdt);
    updatePlayers(dt, sdt);

    for (const b of netBalls) updateNetBall(b, dt);
    netBalls = netBalls.filter((b) => b.alpha > 0);

    for (const p of particles) {
      p.vy += p.g * dt;
      p.vx *= Math.exp(-1.5 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0 && p.y < H + 20);
    for (const f of floats) f.t += dt;
    floats = floats.filter((f) => f.t < 3);
    for (const s of skillTexts) s.t += dt;
    skillTexts = skillTexts.filter((s) => s.t < 1.3);
    for (const g of Object.values(GOALS)) g.shake = Math.max(0, g.shake - dt * 1.8);
    for (const t of ['messi', 'ronaldo']) {
      cheer[t] = Math.max(0, cheer[t] - dt * 0.6);
      pop[t] = Math.max(0, pop[t] - dt * 3);
    }
    if (banner) {
      banner.t += dt;
      if (banner.t > (banner.big ? 2.2 : 1.4)) banner = null;
    }

    resultT += dt;
    if (match.phase === 'running') {
      const secs = Math.ceil(timeLeft() / 1000);
      if (secs <= 5 && secs >= 1 && secs !== lastBeep) Sound.tone(880, 0.12, 0.15);
      lastBeep = secs;
    } else {
      lastBeep = 0;
    }
    const r = match.lastResult;
    if (match.phase === 'intermission' && r && r.winner !== 'draw') {
      cheer[r.winner] = Math.max(cheer[r.winner], 0.6);
      if (Math.random() < dt * 30) rain(r.winner, 2);
    }
  }

  // ---------- Shared drawing (players, ball, scoreboard, banners) ----------
  function drawCrowd() {
    const jump = (f) => (Math.sin(now * 12 + f.ph) * 0.5 + 0.5) * (1 + cheer[f.team] * 10);
    ctx.save();
    ctx.globalAlpha = 0.68; // keep the stands in the background
    for (const [color, fans] of crowdByShirt) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const f of fans) ctx.rect(f.x - 6, f.y - jump(f), 12, 10);
      ctx.fill();
    }
    for (const [color, fans] of crowdBySkin) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const f of fans) {
        const y = f.y - 5 - jump(f);
        ctx.moveTo(f.x + 4.5, y);
        ctx.arc(f.x, y, 4.5, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    // scarves held up when their team scores
    for (const team of ['messi', 'ronaldo']) {
      if (cheer[team] < 0.25) continue;
      const [c1, c2] = team === 'messi' ? ['#a50044', '#1b4fd0'] : ['#ffffff', '#f2c94c'];
      ctx.fillStyle = c1;
      ctx.beginPath();
      for (const f of crowd) if (f.scarf && f.team === team) ctx.rect(f.x - 9, f.y - 17 - jump(f) + Math.sin(now * 10 + f.ph) * 2, 18, 4);
      ctx.fill();
      ctx.fillStyle = c2;
      ctx.beginPath();
      for (const f of crowd) if (f.scarf && f.team === team) ctx.rect(f.x - 2, f.y - 17 - jump(f) + Math.sin(now * 10 + f.ph) * 2, 4, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFloodlights() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of [1, -1]) {
      const x = s > 0 ? 66 : W - 66;
      const y = 44;
      for (let i = 0; i < 4; i++) {
        const a0 = 0.3 + i * 0.13;
        const a = s > 0 ? a0 : Math.PI - a0;
        ctx.fillStyle = 'rgba(255,255,225,0.022)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a - 0.045) * 2300, y + Math.sin(a - 0.045) * 2300);
        ctx.lineTo(x + Math.cos(a + 0.045) * 2300, y + Math.sin(a + 0.045) * 2300);
        ctx.closePath();
        ctx.fill();
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, 260);
      g.addColorStop(0, 'rgba(255,255,240,0.7)');
      g.addColorStop(0.15, 'rgba(220,235,255,0.28)');
      g.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 260, y - 260, 520, 520);
    }
    ctx.restore();
    // lamp panels
    for (const s of [1, -1]) {
      const x = s > 0 ? 66 : W - 66;
      ctx.save();
      ctx.translate(x, 44);
      ctx.rotate(s * 0.5);
      ctx.fillStyle = '#20283f';
      rr(-34, -34, 68, 68, 8);
      ctx.fill();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          rr(-28 + i * 20, -28 + j * 20, 16, 16, 4);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  function drawCrown(x, y, w, fill) {
    const h = w * 0.7;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, -h / 5);
    ctx.lineTo(-w / 4, h / 8);
    ctx.lineTo(0, -h / 2);
    ctx.lineTo(w / 4, h / 8);
    ctx.lineTo(w / 2, -h / 5);
    ctx.lineTo(w / 2, h / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    for (const px of [-w / 2, 0, w / 2]) {
      circle(px, px === 0 ? -h / 2 : -h / 5, w * 0.07);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMiniBall(x, y, r) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    circle(x, y, r);
    ctx.fill();
    ctx.save();
    circle(x, y, r);
    ctx.clip();
    ctx.fillStyle = '#1d1d22';
    const penta = (px, py, size, rot) => {
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = rot + (k * Math.PI * 2) / 5 - Math.PI / 2;
        if (k === 0) ctx.moveTo(px + Math.cos(a) * size, py + Math.sin(a) * size);
        else ctx.lineTo(px + Math.cos(a) * size, py + Math.sin(a) * size);
      }
      ctx.closePath();
      ctx.fill();
    };
    penta(x, y, r * 0.36, 0);
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
      penta(x + Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98, r * 0.32, Math.PI);
    }
    ctx.restore();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    circle(x, y, r);
    ctx.stroke();
    ctx.restore();
  }

  function drawCloth(cx, cy, w, h, tilt, team, text) {
    const messi = team === 'messi';
    const wave = Math.sin(now * 2.2 + cx) * 4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    if (cheer[team] > 0.05) {
      ctx.shadowColor = messi ? '#3d7bff' : '#f2c94c';
      ctx.shadowBlur = 34 * cheer[team];
    }
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.quadraticCurveTo(0, -h / 2 + wave, w / 2, -h / 2);
    ctx.lineTo(w / 2, h / 2);
    ctx.quadraticCurveTo(0, h / 2 + wave, -w / 2, h / 2);
    ctx.closePath();
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    if (messi) {
      g.addColorStop(0, '#8a1048');
      g.addColorStop(0.35, '#1d4fc4');
      g.addColorStop(1, '#0b2a8c');
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#e3e7f1');
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f2c94c';
    ctx.stroke();
    const ink = messi ? '#ffffff' : '#1b2a6b';
    drawCrown(-w / 2 + 30, wave * 0.5, 30, ink);
    drawCrown(w / 2 - 30, wave * 0.5, 30, ink);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    fitFont(text, w - 120, 30, 'italic 900');
    ctx.fillText(text, 0, 2 + wave * 0.5);
    ctx.restore();
  }

  function drawPennant(cx, top, team) {
    const messi = team === 'messi';
    const info = CONFIG.teams[team];
    const w = 78;
    const h = 300;
    ctx.strokeStyle = '#c9a43a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 8, top);
    ctx.lineTo(cx + w / 2 + 8, top);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, top);
    const shake = cheer[team] > 0.05 ? Math.sin(now * 14) * 0.06 * cheer[team] : 0;
    ctx.rotate(Math.sin(now * 1.4 + cx) * 0.025 + shake);
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.lineTo(0, h - 34);
    ctx.lineTo(-w / 2, h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (messi) {
      g.addColorStop(0, '#2457d6');
      g.addColorStop(1, '#0a2580');
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#e6e9f2');
    }
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6;
    ctx.strokeStyle = messi ? '#d0103a' : '#f2c94c';
    ctx.stroke();
    const ink = messi ? '#ffffff' : '#1b2a6b';
    drawCrown(0, 42, 34, ink);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    fitFont(info.name, w - 14, 24, 'italic 900');
    ctx.fillText(info.name, 0, 92);
    ctx.font = `900 56px ${FONT}`;
    ctx.fillText(info.number || '', 0, 150);
    drawMiniBall(0, 214, 18);
    ctx.restore();
  }

  function drawBall(b) {
    ctx.save();
    ctx.globalAlpha = clamp(b.alpha, 0, 1);
    const sh = clamp(1 - b.z / 900, 0.25, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.3 * sh})`;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, b.r * sh, b.r * 0.38 * sh, 0, 0, Math.PI * 2);
    ctx.fill();

    const cx = b.x;
    const cy = b.y - b.r - b.z;
    if (b.value >= 100) {
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 35;
    }
    ctx.fillStyle = '#ffffff';
    circle(cx, cy, b.r);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    circle(cx, cy, b.r);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(b.rot);
    ctx.fillStyle = '#1d1d22';
    const penta = (x, y, size, rot) => {
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = rot + (k * Math.PI * 2) / 5 - Math.PI / 2;
        const px = x + Math.cos(a) * size;
        const py = y + Math.sin(a) * size;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    };
    penta(0, 0, b.r * 0.36, 0);
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
      penta(Math.cos(a) * b.r * 0.98, Math.sin(a) * b.r * 0.98, b.r * 0.32, Math.PI);
    }
    ctx.restore();

    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = Math.max(2.5, b.r * 0.1);
    circle(cx, cy, b.r);
    ctx.stroke();

    if (b.value > 1 && !b.scored) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `900 30px ${FONT}`;
      outlinedText(`+${b.value}`, cx, cy - b.r - 14, '#ffd23f', OUTLINE, 8);
    }
    ctx.restore();
  }

  function drawLeg(x, ang, kit) {
    ctx.save();
    ctx.translate(x, -46);
    ctx.rotate(ang);
    ctx.fillStyle = kit.skin;
    rr(-7, 0, 14, 24, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = kit.socks;
    rr(-7, 20, 14, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#16161a';
    rr(-8, 38, 20, 10, 5);
    ctx.fill();
    ctx.restore();
  }

  function drawArm(x, ang, kit) {
    ctx.save();
    ctx.translate(x, -96);
    ctx.rotate(ang);
    ctx.fillStyle = kit.skin;
    rr(-6, 10, 12, 26, 5);
    ctx.fill();
    ctx.stroke();
    circle(0, 38, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = kit.sleeve;
    rr(-8, -2, 16, 18, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawHead(p, kit) {
    const hy = -142;
    const celebrating = p.state === 'celebrate';
    const sad = p.state === 'sad';

    ctx.fillStyle = kit.skin;
    circle(-35, hy + 4, 8);
    ctx.fill();
    ctx.stroke();
    circle(35, hy + 4, 8);
    ctx.fill();
    ctx.stroke();
    circle(0, hy, 37);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = kit.hair;
    if (p.team === 'messi') {
      ctx.beginPath();
      ctx.arc(0, hy, 38, Math.PI * 0.95, Math.PI * 2.05);
      ctx.quadraticCurveTo(22, hy - 24, 4, hy - 16);
      ctx.quadraticCurveTo(-16, hy - 26, -37, hy + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const ex = 37 * Math.cos(0.08 * Math.PI);
      const ey = hy + 37 * Math.sin(0.08 * Math.PI);
      ctx.beginPath();
      ctx.arc(0, hy, 37, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.quadraticCurveTo(0, hy + 32, ex, ey);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, hy, 38, Math.PI, Math.PI * 2);
      ctx.quadraticCurveTo(0, hy - 22, -38, hy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-4, hy - 36, 22, 11, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,110,120,0.35)';
    circle(-22, hy + 10, 6);
    ctx.fill();
    circle(22, hy + 10, 6);
    ctx.fill();

    ctx.fillStyle = OUTLINE;
    if (celebrating) {
      ctx.lineWidth = 4;
      for (const ex of [-13, 13]) {
        ctx.beginPath();
        ctx.arc(ex, hy + 2, 6, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    } else {
      for (const ex of [-13, 13]) {
        ctx.beginPath();
        ctx.ellipse(ex, hy + 1, 5, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      circle(-11, hy - 2, 2);
      ctx.fill();
      circle(15, hy - 2, 2);
      ctx.fill();
    }

    ctx.lineWidth = 4;
    ctx.strokeStyle = kit.hair;
    const tilt = sad ? 4 : 0;
    ctx.beginPath();
    ctx.moveTo(-20, hy - 10 + tilt);
    ctx.lineTo(-7, hy - 12 - tilt);
    ctx.moveTo(20, hy - 10 + tilt);
    ctx.lineTo(7, hy - 12 - tilt);
    ctx.stroke();

    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3.5;
    if (celebrating) {
      ctx.fillStyle = '#6b1d24';
      ctx.beginPath();
      ctx.ellipse(0, hy + 19, 10, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (sad) {
      ctx.beginPath();
      ctx.arc(0, hy + 26, 8, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, hy + 12, 9, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
  }

  function drawPlayer(p) {
    const kit = KITS[p.team];
    const team = CONFIG.teams[p.team];
    const t = p.anim;
    const celebrating = p.state === 'celebrate';
    const sad = p.state === 'sad';
    const swing = p.moving ? Math.sin(t * 18) * 0.7 : 0;
    const bob = p.moving ? Math.abs(Math.sin(t * 18)) * 6 : Math.sin(t * 2.5) * 1.5;
    const jump = celebrating ? Math.abs(Math.sin(t * 7)) * 24 : 0;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 40 - jump * 0.3, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    if (p.tilt) ctx.rotate(p.tilt); // slide tackle / lying on the grass
    ctx.scale(p.face, 1);
    ctx.translate(0, -bob - jump);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.lineJoin = 'round';

    let kickLeg = 0;
    if (p.state === 'kick') kickLeg = Math.sin(Math.min(1, p.kickT / 0.26) * Math.PI) * 1.3;
    drawLeg(-12, swing, kit);
    drawLeg(12, -swing - kickLeg, kit);

    ctx.fillStyle = kit.shorts;
    rr(-27, -58, 54, 20, 6);
    ctx.fill();
    ctx.stroke();

    rr(-30, -106, 60, 52, 14);
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = kit.stripes[i % kit.stripes.length];
      ctx.fillRect(-30 + i * 12, -106, 12, 52);
    }
    ctx.restore();
    rr(-30, -106, 60, 52, 14);
    ctx.stroke();
    ctx.strokeStyle = kit.trim;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -106, 12, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.save();
    ctx.scale(p.face, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 24px ${FONT}`;
    ctx.fillStyle = kit.number;
    ctx.fillText(team.number || '', 0, -76);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;

    // arms (down vector (0,1) rotated by a: positive a swings the left arm outward/up)
    const armL = celebrating ? 2.6 : sad ? 2.95 : 0.15 + swing * 0.8;
    const armR = celebrating ? -2.6 : sad ? -2.95 : -0.15 - swing * 0.8;
    drawArm(-31, armL, kit);
    drawArm(31, armR, kit);

    drawHead(p, kit);
    ctx.restore();

    // name tag
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 26px ${FONT}`;
    const name = team.name;
    const tw = ctx.measureText(name).width + 30;
    rr(p.x - tw / 2, p.y + 16, tw, 38, 19);
    ctx.fillStyle = p.team === 'messi' ? teamFill('messi', p.x - tw / 2, p.x + tw / 2) : '#14286b';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#f2c94c';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(name, p.x, p.y + 36);

    if (celebrating && team.celebrate) {
      const by = p.y - 230 - jump;
      ctx.font = `900 34px ${FONT}`;
      const bw = ctx.measureText(team.celebrate).width + 40;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4;
      rr(p.x - bw / 2, by - 30, bw, 60, 24);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 12, by + 28);
      ctx.lineTo(p.x, by + 50);
      ctx.lineTo(p.x + 12, by + 28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x - 10, by + 24, 20, 6);
      ctx.fillStyle = p.team === 'messi' ? '#A50044' : '#1B2A6B';
      ctx.fillText(team.celebrate, p.x, by + 2);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / 0.5, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
  }

  function drawBanner() {
    if (!banner) return;
    const dur = banner.big ? 2.2 : 1.6;
    const t = banner.t;
    const s = t < 0.25 ? easeOutBack(t / 0.25) : 1;
    const a = t > dur - 0.3 ? (dur - t) / 0.3 : 1;
    const team = banner.team;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(CX, MID_Y);
    ctx.scale(s, s);
    ctx.rotate(-0.05);
    if (team) {
      ctx.fillStyle = teamFill(team, -440, 440);
    } else {
      const g = ctx.createLinearGradient(0, -90, 0, 90);
      g.addColorStop(0, '#1d2340');
      g.addColorStop(1, '#0a0d1a');
      ctx.fillStyle = g;
    }
    rr(-450, -90, 900, 180, 34);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = team === 'ronaldo' ? '#D4AF37' : '#EDBB00';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(banner.text, 820, banner.big || !team ? 96 : 130);
    if (team === 'ronaldo') outlinedText(banner.text, 0, 6, '#1B2A6B', '#D4AF37', 12);
    else if (team === 'messi') outlinedText(banner.text, 0, 6, '#FFFFFF', '#15161c', 12);
    else outlinedText(banner.text, 0, 6, '#EDBB00', '#15161c', 12);
    ctx.restore();
  }

  function drawCountdown() {
    if (match.phase !== 'running') return;
    const left = timeLeft();
    if (left > 5000 || left <= 0) return;
    const secs = Math.ceil(left / 1000);
    const frac = secs - left / 1000; // 0 at the start of each second
    ctx.save();
    ctx.globalAlpha = 0.45 * (1 - frac);
    ctx.translate(CX, MID_Y);
    ctx.scale(1 + frac * 0.6, 1 + frac * 0.6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 380px ${FONT}`;
    outlinedText(String(secs), 0, 0, '#ffffff', '#c0102a', 18);
    ctx.restore();
  }

  function drawResult() {
    const r = match.lastResult;
    if (match.phase !== 'intermission' || !r) return;
    const win = r.winner;
    const t = Math.min(resultT, 99);
    const s = t < 0.4 ? easeOutBack(t / 0.4) : 1;
    const nameOf = (team) => CONFIG.teams[team].name;

    ctx.save();
    ctx.fillStyle = `rgba(3,5,12,${0.45 * clamp(t / 0.4, 0, 1)})`;
    ctx.fillRect(PITCH.x - 28, PITCH.y - 28, PITCH.w + 56, PITCH.h + 56);
    ctx.translate(CX, MID_Y);
    ctx.scale(s, s);

    const cardW = 860;
    const cardH = 520;
    rr(-cardW / 2, -cardH / 2, cardW, cardH, 40);
    if (win === 'draw') {
      const g = ctx.createLinearGradient(0, -cardH / 2, 0, cardH / 2);
      g.addColorStop(0, '#1d2340');
      g.addColorStop(1, '#0a0d1a');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = teamFill(win, -cardW / 2, cardW / 2);
    }
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = win === 'ronaldo' ? '#D4AF37' : '#EDBB00';
    ctx.stroke();

    const ink = win === 'ronaldo' ? '#1B2A6B' : '#FFFFFF';
    const accent = win === 'ronaldo' ? '#B8901F' : '#EDBB00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = accent;
    ctx.font = `900 40px ${FONT}`;
    ctx.fillText(`FULL TIME · ROUND ${r.round}`, 0, -190);

    const headline = win === 'draw' ? "IT'S A DRAW!" : `🏆 ${nameOf(win)} WINS!`;
    fitFont(headline, cardW - 80, 100);
    outlinedText(headline, 0, -95, ink, win === 'ronaldo' ? '#D4AF37' : '#15161c', 10);

    const score = `${r.scores.messi}  -  ${r.scores.ronaldo}`;
    fitFont(score, cardW - 200, 110);
    ctx.fillStyle = ink;
    ctx.fillText(score, 0, 25);
    ctx.font = `900 30px ${FONT}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.fillText(nameOf('messi'), -140, 100);
    ctx.textAlign = 'left';
    ctx.fillText(nameOf('ronaldo'), 140, 100);
    ctx.textAlign = 'center';

    let line;
    if (win === 'draw') line = 'No winner this round';
    else if (match.streak.team === win && match.streak.count >= 2) line = `🔥 ${match.streak.count} WINS IN A ROW!`;
    else line = `Total wins: ${match.wins[win]}`;
    fitFont(line, cardW - 80, 48);
    ctx.fillStyle = ink;
    ctx.fillText(line, 0, 160);

    const next = match.autoNextRound
      ? `Next round in ${Math.ceil(timeLeft() / 1000)}…`
      : 'Next round starting soon…';
    ctx.font = `800 30px ${FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(next, 0, 222);
    ctx.restore();
  }

  function roundPoly(pts, r) {
    const n = pts.length;
    const a = pts[n - 1];
    const b = pts[0];
    ctx.beginPath();
    ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      ctx.arcTo(p[0], p[1], q[0], q[1], r);
    }
    ctx.closePath();
  }

  function drawBadge(team, cx, cy, size) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(size / 64, size / 64);
    if (team === 'messi') {
      const shield = () => {
        ctx.beginPath();
        ctx.moveTo(-28, -32);
        ctx.lineTo(28, -32);
        ctx.lineTo(28, 4);
        ctx.quadraticCurveTo(26, 26, 0, 36);
        ctx.quadraticCurveTo(-26, 26, -28, 4);
        ctx.closePath();
      };
      shield();
      ctx.fillStyle = '#f2c94c';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#6b4a00';
      ctx.stroke();
      ctx.save();
      ctx.scale(0.8, 0.8);
      shield();
      ctx.clip();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#0b2a8c' : '#a50044';
        ctx.fillRect(-30 + i * 10, -14, 10, 52);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-30, -34, 60, 20);
      ctx.restore();
      drawMiniBall(0, -19, 7);
    } else {
      circle(0, 6, 26);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#f2c94c';
      ctx.stroke();
      circle(0, 6, 19);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1b2a6b';
      ctx.stroke();
      ctx.fillStyle = '#1b2a6b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 24px ${FONT}`;
      ctx.fillText(CONFIG.teams.ronaldo.number || '7', 0, 8);
      drawCrown(0, -24, 34, '#f2c94c');
    }
    ctx.restore();
  }

  function drawHUD() {
    const left = timeLeft();
    const running = match.phase === 'running';
    const urgent = running && left <= 10000;

    for (const team of ['messi', 'ronaldo']) {
      const messi = team === 'messi';
      const disp = Math.max(0, serverScores[team] - pending(team));
      if (disp > shown[team]) pop[team] = 1;
      shown[team] = disp;

      const pts = messi
        ? [[118, 12], [442, 12], [416, 138], [96, 138]]
        : [[638, 12], [962, 12], [984, 138], [664, 138]];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 4;
      roundPoly(pts, 16);
      const g = ctx.createLinearGradient(0, 12, 0, 138);
      g.addColorStop(0, messi ? '#2f6cf0' : '#ffffff');
      g.addColorStop(1, messi ? '#0a2580' : '#d6dbe8');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundPoly(pts, 16);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillRect(0, 12, HW, 52);
      ctx.restore();
      roundPoly(pts, 16);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#f2c94c';
      ctx.stroke();

      drawBadge(team, messi ? 168 : HW - 168, 76, 80);

      const tx = messi ? 300 : HW - 300;
      const ink = messi ? '#FFFFFF' : '#14286b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ink;
      fitFont(CONFIG.teams[team].name, 220, 34);
      ctx.fillText(CONFIG.teams[team].name, tx, 42);
      ctx.save();
      ctx.translate(tx, 100);
      const s = 1 + pop[team] * 0.35;
      ctx.scale(s, s);
      fitFont(String(disp), 165, 72); // stays clear of the badge
      outlinedText(String(disp), 0, 0, ink, messi ? '#0a1a5a' : '#c9a43a', 5);
      ctx.restore();

      // wins (+ streak)
      const wp = messi
        ? [[142, 146], [402, 146], [390, 192], [130, 192]]
        : [[678, 146], [938, 146], [950, 192], [690, 192]];
      roundPoly(wp, 10);
      ctx.fillStyle = 'rgba(8,16,48,0.94)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = messi ? '#3b62c9' : '#c9a43a';
      ctx.stroke();
      const wins = match.wins[team] || 0;
      const main = `🏆 ${wins} ${wins === 1 ? 'WIN' : 'WINS'}`;
      const streak = match.streak.team === team && match.streak.count >= 2 ? `   🔥 x${match.streak.count}` : '';
      const cx = messi ? 266 : HW - 266;
      let size = 26;
      ctx.font = `900 ${size}px ${FONT}`;
      let total = ctx.measureText(main + streak).width;
      if (total > 236) {
        size = Math.floor((size * 236) / total);
        ctx.font = `900 ${size}px ${FONT}`;
        total = ctx.measureText(main + streak).width;
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFFFFF';
      const x0 = cx - total / 2;
      ctx.fillText(main, x0, 170);
      if (streak) {
        ctx.save();
        ctx.shadowColor = '#ff7a00';
        ctx.shadowBlur = 8 + 10 * (0.5 + 0.5 * Math.sin(now * 6));
        ctx.fillStyle = '#ffb13b';
        ctx.fillText(streak, x0 + ctx.measureText(main).width, 170);
        ctx.restore();
      }
    }

    // timer
    const cp = [[432, 8], [648, 8], [678, 38], [656, 134], [424, 134], [402, 38]];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    roundPoly(cp, 10);
    const tg = ctx.createLinearGradient(0, 8, 0, 134);
    tg.addColorStop(0, urgent && Math.sin(now * 10) > 0 ? '#4a0812' : '#1d1d24');
    tg.addColorStop(1, '#000000');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.restore();
    roundPoly(cp, 10);
    ctx.lineWidth = 4;
    ctx.strokeStyle = urgent ? '#ff4d4d' : '#f2c94c';
    ctx.stroke();

    const label = {
      ready: 'KICK-OFF SOON',
      running: 'TIME LEFT',
      paused: 'PAUSED',
      intermission: 'FULL TIME',
    }[match.phase] || '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = match.phase === 'paused' ? '#ff9a3c' : '#f2c94c';
    fitFont(label, 180, 22);
    ctx.fillText(label, HW / 2, 34);
    const lw = ctx.measureText(label).width;
    ctx.fillRect(HW / 2 - lw / 2 - 30, 33, 18, 3);
    ctx.fillRect(HW / 2 + lw / 2 + 12, 33, 18, 3);

    const clock = match.phase === 'intermission' ? '0:00' : formatTime(left);
    const blinkOff = match.phase === 'paused' && Math.sin(now * 5) < -0.3;
    if (!blinkOff) {
      ctx.save();
      ctx.translate(HW / 2, 90);
      if (urgent) {
        const sc = 1 + 0.08 * Math.max(0, Math.sin(now * 12));
        ctx.scale(sc, sc);
      }
      fitFont(clock, 220, 76);
      outlinedText(clock, 0, 0, urgent ? '#ff4d4d' : '#FFFFFF', '#000000', 4);
      ctx.restore();
    }

    const rp = [[452, 144], [628, 144], [650, 168], [628, 192], [452, 192], [430, 168]];
    roundPoly(rp, 6);
    ctx.fillStyle = '#0a0a12';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f2c94c';
    ctx.stroke();
    ctx.fillStyle = '#f2c94c';
    const roundText = match.phase === 'intermission' ? `NEXT: ROUND ${match.round}` : `ROUND ${match.round}`;
    fitFont(roundText, 190, 26);
    ctx.fillText(roundText, HW / 2, 169);
  }

  // ---------- Crowd ----------
  const crowd = [];
  const crowdByShirt = new Map();
  const crowdBySkin = new Map();
  (function buildCrowd() {
    const skins = ['#f1c29b', '#e0ac7e', '#c68b5e', '#8d5a3b', '#f6d3b3'];
    const shirts = {
      messi: ['#1b4fd0', '#c0103a', '#1b4fd0', '#a50044', '#f2c94c', '#ffffff'],
      ronaldo: ['#ffffff', '#ffffff', '#f2c94c', '#e8e8ee', '#1b2a6b', '#c0103a'],
    };
    const add = (x, y, team) => crowd.push({
      x: x + rand(-2, 2), y: y + rand(-1.5, 1.5), team,
      shirt: pick(shirts[team]), skin: pick(skins), ph: rand(0, 6), scarf: Math.random() < 0.3,
    });
    for (let y = 14, row = 0; y < RUNOFF.y - 40; y += 14, row++) {
      for (let x = 6 + (row % 2) * 7; x < W; x += 14) add(x, y, x < W / 2 ? 'messi' : 'ronaldo');
    }
    for (let y = RUNOFF.y - 30; y < H; y += 15) {
      for (const x of [10, 26, 42]) add(x, y, 'messi');
      for (const x of [W - 10, W - 26, W - 42]) add(x, y, 'ronaldo');
    }
    for (let x = 6; x < W; x += 14) add(x, H - 4, x < W / 2 ? 'messi' : 'ronaldo');
    for (const f of crowd) {
      if (!crowdByShirt.has(f.shirt)) crowdByShirt.set(f.shirt, []);
      crowdByShirt.get(f.shirt).push(f);
      if (!crowdBySkin.has(f.skin)) crowdBySkin.set(f.skin, []);
      crowdBySkin.get(f.skin).push(f);
    }
  })();

  // ---------- Static background (pre-rendered on resize) ----------
  function drawStands() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1640');
    g.addColorStop(0.5, '#0c1b50');
    g.addColorStop(1, '#070f30');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 10; y < RUNOFF.y; y += 28) ctx.fillRect(0, y, W, 3);
  }

  function drawWalls() {
    const R = RUNOFF;
    const T = 32;
    const wall = (x, y, w, h, vertical) => {
      const g = vertical ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#0a2470');
      g.addColorStop(0.5, '#1d4fc4');
      g.addColorStop(1, '#0a2470');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#f2c94c';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    };
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 24;
    wall(R.x - T, R.y - T, T, R.h + 2 * T, true);
    wall(R.x + R.w, R.y - T, T, R.h + 2 * T, true);
    wall(R.x - T, R.y - T, R.w + 2 * T, T, false);
    wall(R.x - T, R.y + R.h, R.w + 2 * T, T, false);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = '#cfe3ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#eef6ff';
    for (let x = R.x + 120; x < R.x + R.w - 60; x += 170) {
      circle(x, R.y - T / 2, 4);
      ctx.fill();
      circle(x, R.y + R.h + T / 2, 4);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLines() {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 4.5;
    ctx.strokeRect(PITCH.x, PITCH.y, PITCH.w, PITCH.h);
    ctx.beginPath();
    ctx.moveTo(CX, PITCH.y);
    ctx.lineTo(CX, PITCH.y + PITCH.h);
    ctx.stroke();
    circle(CX, CY, 120);
    ctx.stroke();
    circle(CX, CY, 7);
    ctx.fill();
    for (const g of Object.values(GOALS)) {
      const d = -g.dir; // direction into the pitch
      const box = (half, depth) => {
        ctx.beginPath();
        ctx.moveTo(g.x, CY - half);
        ctx.lineTo(g.x + d * depth, CY - half);
        ctx.lineTo(g.x + d * depth, CY + half);
        ctx.lineTo(g.x, CY + half);
        ctx.stroke();
      };
      box(250, 230);
      box(130, 80);
      const spotX = g.x + d * 160;
      circle(spotX, CY, 7);
      ctx.fill();
      const a = Math.acos(70 / 110);
      const mid = d > 0 ? 0 : Math.PI;
      ctx.beginPath();
      ctx.arc(spotX, CY, 110, mid - a, mid + a);
      ctx.stroke();
    }
    const corner = (x, y, a0) => {
      ctx.beginPath();
      ctx.arc(x, y, 22, a0, a0 + Math.PI / 2);
      ctx.stroke();
    };
    corner(PITCH.x, PITCH.y, 0);
    corner(PITCH.x + PITCH.w, PITCH.y, Math.PI / 2);
    corner(PITCH.x + PITCH.w, PITCH.y + PITCH.h, Math.PI);
    corner(PITCH.x, PITCH.y + PITCH.h, -Math.PI / 2);
  }

  function drawPitchStatic() {
    const R = RUNOFF;
    ctx.fillStyle = '#3f9b2c';
    ctx.fillRect(R.x, R.y, R.w, R.h);
    const cols = 16;
    const cw = PITCH.w / cols;
    for (let i = 0; i < cols; i++) {
      ctx.fillStyle = i % 2 ? '#5fc23c' : '#52b333';
      ctx.fillRect(PITCH.x + i * cw, PITCH.y, cw + 0.5, PITCH.h);
    }
    const rnd = seeded(20261001);
    for (let i = 0; i < 16000; i++) {
      const x = R.x + rnd() * R.w;
      const y = R.y + rnd() * R.h;
      ctx.fillStyle = rnd() < 0.55 ? 'rgba(20,70,10,0.10)' : 'rgba(230,255,200,0.07)';
      ctx.fillRect(x, y, 1.6, 2 + rnd() * 4);
    }
    const lg = ctx.createRadialGradient(CX, CY, 80, CX, CY, 1100);
    lg.addColorStop(0, 'rgba(255,255,200,0.14)');
    lg.addColorStop(0.55, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,30,0,0.28)');
    ctx.fillStyle = lg;
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    circle(CX, CY, 96);
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 2;
    drawLines();
    ctx.restore();
  }

  function renderStatic() {
    bg.width = canvas.width;
    bg.height = canvas.height;
    ctx = bgCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, bg.width, bg.height);
    applyView();
    drawStands();
    drawWalls();
    drawPitchStatic();
    ctx = mainCtx;
  }

  // ---------- Goals (side-on boxes; the crossbar is GOAL_HEIGHT above the goal line) ----------
  function goalShape(g) {
    const back = g.x + g.dir * NET_DEPTH;
    return { back, y0: CY - GOAL_HALF, y1: CY + GOAL_HALF, top: GOAL_HEIGHT, backTop: GOAL_HEIGHT * 0.55 };
  }

  function drawGoalBack(g) {
    const s = goalShape(g);
    const x0 = Math.min(g.x, s.back);
    const x1 = Math.max(g.x, s.back);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g.x, s.y0 - s.top);
    ctx.lineTo(s.back, s.y0 - s.backTop);
    ctx.lineTo(s.back, s.y1);
    ctx.lineTo(g.x, s.y1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10,20,15,0.35)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    const wob = g.shake * 6;
    for (let x = x0, i = 0; x <= x1; x += 12, i++) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(now * 45 + i) * wob, s.y0 - s.top);
      ctx.lineTo(x - Math.sin(now * 45 + i) * wob, s.y1);
      ctx.stroke();
    }
    for (let y = s.y0 - s.top, i = 0; y <= s.y1; y += 12, i++) {
      ctx.beginPath();
      ctx.moveTo(x0, y + Math.sin(now * 50 + i) * wob);
      ctx.lineTo(x1, y - Math.sin(now * 50 + i) * wob);
      ctx.stroke();
    }
    ctx.restore();
    // back frame
    ctx.strokeStyle = 'rgba(235,235,235,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(g.x, s.y0 - s.top);
    ctx.lineTo(s.back, s.y0 - s.backTop);
    ctx.lineTo(s.back, s.y1);
    ctx.lineTo(g.x, s.y1);
    ctx.moveTo(s.back, s.y0 - s.backTop);
    ctx.lineTo(s.back, s.y0);
    ctx.lineTo(g.x, s.y0);
    ctx.moveTo(g.x, s.y1 - s.top);
    ctx.lineTo(s.back, s.y1 - s.backTop);
    ctx.stroke();
  }

  function drawGoalFront(g) {
    const s = goalShape(g);
    ctx.lineCap = 'round';
    for (const [w, c] of [[14, OUTLINE], [9, '#ffffff']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(g.x, s.y1);
      ctx.lineTo(g.x, s.y0 - s.top);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const y of [s.y0, s.y1]) {
      ctx.beginPath();
      ctx.ellipse(g.x, y + 2, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCornerFlags() {
    const corners = [
      [PITCH.x, PITCH.y], [PITCH.x + PITCH.w, PITCH.y],
      [PITCH.x, PITCH.y + PITCH.h], [PITCH.x + PITCH.w, PITCH.y + PITCH.h],
    ];
    for (const [x, y] of corners) {
      const dir = x < CX ? 1 : -1;
      const top = y - 48;
      const wave = Math.sin(now * 6 + x * 0.01) * 5;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, top);
      ctx.stroke();
      ctx.fillStyle = '#ffd400';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.quadraticCurveTo(x + dir * 12, top + wave * 0.5, x + dir * 24, top + 6 + wave);
      ctx.lineTo(x, top + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function drawBottomBar() {
    const y0 = H - 50;
    const y1 = H - 6;
    const mid = (y0 + y1) / 2;
    roundPoly([[600, y0], [W - 600, y0], [W - 620, y1], [620, y1]], 12);
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#18235a');
    g.addColorStop(1, '#070b1f');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f2c94c';
    ctx.stroke();
    const text = CONFIG.boardText || '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(text, 560, 26, 'italic 900');
    const tw = ctx.measureText(text).width;
    ctx.save();
    ctx.shadowColor = 'rgba(242,201,76,0.7)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#f2c94c';
    ctx.fillText(text, W / 2, mid + 1);
    ctx.restore();
    drawCrown(W / 2 - tw / 2 - 28, mid, 24, '#f2c94c');
    drawCrown(W / 2 + tw / 2 + 28, mid, 24, '#f2c94c');
    drawMiniBall(612, y0 + 2, 22);
    drawMiniBall(W - 612, y0 + 2, 22);
  }

  function drawFloats() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floats) {
      const a = f.t < 0.25 ? f.t / 0.25 : f.t > 2.4 ? (3 - f.t) / 0.6 : 1;
      const y = f.y - f.t * 20;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      fitFont(f.text, 460, 34);
      const tw = Math.max(ctx.measureText(f.text).width, f.sub ? 180 : 0) + 44;
      const h = f.sub ? 80 : 56;
      rr(f.x - tw / 2, y - h / 2, tw, h, 20);
      ctx.fillStyle = f.team === 'messi' ? 'rgba(0,50,110,0.88)' : 'rgba(255,255,255,0.94)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f2c94c';
      ctx.stroke();
      ctx.fillStyle = f.team === 'messi' ? '#fff' : '#1B2A6B';
      ctx.fillText(f.text, f.x, y - (f.sub ? 12 : 0));
      if (f.sub) {
        fitFont(f.sub, tw - 30, 22, '700');
        ctx.fillText(f.sub, f.x, y + 22);
      }
      ctx.restore();
    }
  }

  function drawSkillTexts() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of skillTexts) {
      const k = s.t < 0.15 ? easeOutBack(s.t / 0.15) : 1;
      ctx.save();
      ctx.globalAlpha = clamp(s.t > 1 ? (1.3 - s.t) / 0.3 : 1, 0, 1);
      ctx.translate(s.x, s.y - s.t * 30);
      ctx.scale(k, k);
      ctx.rotate(-0.06);
      ctx.font = `italic 900 46px ${FONT}`;
      outlinedText(s.text, 0, 0, '#ffd23f', OUTLINE, 9);
      ctx.restore();
    }
  }

  // ---------- Frame loop ----------
  let view = { s: 1, ox: 0, oy: 0, dpr: 1 };

  function applyView() {
    const { s, ox, oy, dpr } = view;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    const s = Math.min(innerWidth / W, innerHeight / H);
    view = { s, ox: (innerWidth - W * s) / 2, oy: (innerHeight - H * s) / 2, dpr };
    renderStatic();
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    applyView();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    drawCrowd();
    drawFloodlights();
    drawCloth(330, RUNOFF.y - 16, 380, 46, -0.02, 'messi', `TEAM ${CONFIG.teams.messi.name}`);
    drawCloth(W - 330, RUNOFF.y - 16, 380, 46, 0.02, 'ronaldo', `TEAM ${CONFIG.teams.ronaldo.name}`);
    drawPennant(50, RUNOFF.y + 60, 'messi');
    drawPennant(W - 50, RUNOFF.y + 60, 'ronaldo');
    drawCornerFlags();
    drawGoalBack(GOALS.left);
    drawGoalBack(GOALS.right);

    const ents = [
      ...netBalls.map((b) => ({ y: b.y, b })),
      ...(ball ? [{ y: ball.y, b: ball }] : []),
      ...Object.values(players).map((p) => ({ y: p.y, p })),
    ].sort((a, b) => a.y - b.y);
    for (const e of ents) (e.b ? drawBall(e.b) : drawPlayer(e.p));

    drawGoalFront(GOALS.left);
    drawGoalFront(GOALS.right);
    drawBottomBar();
    drawSkillTexts();
    drawCountdown();
    drawFloats();
    drawBanner();
    drawResult();
    drawParticles();
    ctx.save();
    ctx.translate((W - HW) / 2, 0);
    drawHUD();
    ctx.restore();
    ctx.restore();
  }

  let last = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    last = ts;
    now += dt;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Input ----------
  document.getElementById('startBtn').addEventListener('click', () => {
    Sound.init();
    if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume();
    document.body.classList.add('started');
  });

  const KEYS = {
    1: () => post('/api/spawn', { team: 'messi', coins: 1, gift: '🧪 Test' }),
    2: () => post('/api/spawn', { team: 'ronaldo', coins: 1, gift: '🧪 Test' }),
    q: () => post('/api/spawn', { team: 'messi', coins: 100, gift: '🧪 Test' }),
    w: () => post('/api/spawn', { team: 'ronaldo', coins: 100, gift: '🧪 Test' }),
    s: () => post('/api/timer', { action: 'toggle' }),
    e: () => post('/api/timer', { action: 'end' }),
    r: () => post('/api/timer', { action: 'reset' }),
    m: () => {
      Sound.muted = !Sound.muted;
      if (Sound.muted) stopClips();
    },
    f: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    },
  };
  window.addEventListener('keydown', (e) => {
    const fn = KEYS[e.key.toLowerCase()];
    if (fn && !e.repeat) fn();
  });

  window.addEventListener('resize', resize);
  resize();

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      CONFIG = { ...CONFIG, ...cfg, teams: { ...CONFIG.teams, ...(cfg.teams || {}) } };
      renderStatic();
    })
    .catch((err) => console.error('Config load failed', err))
    .finally(connect);

  requestAnimationFrame(frame);

  // Exposed for debugging in the browser console.
  window.__game = {
    players, match, clips: CLIPS, serverScores,
    get queue() { return queue; }, get active() { return active; }, get ball() { return ball; },
  };
})();

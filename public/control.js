(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const QTY_OPTIONS = [1, 2, 5, 10, 20];
  const DURATIONS = [60, 120, 180, 300, 600]; // seconds
  let config = { teams: { messi: { name: 'MESSI' }, ronaldo: { name: 'RONALDO' } }, gifts: [] };
  let qty = 1;
  let toastTimer = 0;
  let match = null;
  let matchAt = 0;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // 1250 -> "1.25K", 50000 -> "50K", 2000000 -> "2M"
  function short(n) {
    if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${+(n / 1e3).toFixed(2)}K`;
    return String(n);
  }

  function teamName(team) {
    return (config.teams[team] && config.teams[team].name) || team.toUpperCase();
  }

  function toast(text, isError) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('err', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  async function post(url, body) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      toast(`⚠ ${err.message}`, true);
      return null;
    }
  }

  // ---------- Quantity (for gift streaks like "Rose x5") ----------
  function renderQty() {
    const box = $('qty');
    box.textContent = '';
    for (const n of QTY_OPTIONS) {
      const b = el('button', n === qty ? 'on' : '', `x${n}`);
      b.type = 'button';
      b.onclick = () => {
        qty = n;
        renderQty();
      };
      box.appendChild(b);
    }
  }

  // ---------- Sending ----------
  async function send(team, coins, gift) {
    const sender = $('sender').value.trim();
    const data = await post('/api/spawn', { team, coins, gift, sender });
    if (!data) return;
    if (navigator.vibrate) navigator.vibrate(25);
    toast(`✔ +${data.entry.count} goals ${teamName(team)}${sender ? ' · ' + sender : ''}`);
    $('sender').value = '';
    qty = 1;
    $('gpc').textContent = config.goalsPerCoin || 1;
    renderQty();
  }

  function giftButton(team, gift) {
    const b = el('button', `gift ${team}`);
    b.type = 'button';
    b.appendChild(el('span', 'emoji', gift.emoji || '🎁'));
    const info = el('span', 'info');
    info.appendChild(el('span', 'gname', gift.name));
    const goals = gift.coins * (config.goalsPerCoin || 1);
    info.appendChild(el('span', 'coins', `🪙 ${short(gift.coins)} = ⚽ ${short(goals)}`));
    b.appendChild(info);
    b.onclick = () => {
      const label = `${gift.emoji || '🎁'} ${gift.name}${qty > 1 ? ' x' + qty : ''}`;
      send(team, gift.coins * qty, label);
    };
    return b;
  }

  function render() {
    $('nameMessi').textContent = $('headMessi').textContent = $('customMessi').textContent = teamName('messi');
    $('nameRonaldo').textContent = $('headRonaldo').textContent = $('customRonaldo').textContent = teamName('ronaldo');
    for (const [team, boxId] of [['messi', 'giftsMessi'], ['ronaldo', 'giftsRonaldo']]) {
      const box = $(boxId);
      box.textContent = '';
      // gifts can be one shared list or a separate list per team
      const list = Array.isArray(config.gifts) ? config.gifts : (config.gifts && config.gifts[team]) || [];
      for (const gift of list) box.appendChild(giftButton(team, gift));
    }
    renderQty();
  }

  function sendCustom(team) {
    const coins = Math.floor(Number($('customCoins').value));
    if (!coins || coins < 1) {
      toast('⚠ Enter a number of coins', true);
      return;
    }
    send(team, coins, `🪙 ${coins} coins`);
    $('customCoins').value = '';
  }

  // ---------- Match clock ----------
  function fmt(ms) {
    const total = Math.ceil(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function matchLeft() {
    const live = match.phase === 'running' || match.phase === 'intermission';
    return Math.max(0, match.remaining - (live ? performance.now() - matchAt : 0));
  }

  function renderClock() {
    if (!match) return;
    const left = matchLeft();
    const labels = {
      ready: 'KICK-OFF SOON',
      running: `ROUND ${match.round} · LIVE`,
      paused: `ROUND ${match.round} · PAUSED`,
      intermission: `FULL TIME · NEXT ROUND IN ${Math.ceil(left / 1000)}s`,
    };
    $('phase').textContent = labels[match.phase] || '';
    $('clock').textContent = match.phase === 'intermission' ? '0:00' : fmt(left);
    $('clock').classList.toggle('urgent', match.phase === 'running' && left <= 10000);
  }

  function showMatch(m) {
    match = m;
    matchAt = performance.now();
    const running = m.phase === 'running';
    const toggle = $('tToggle');
    toggle.textContent = running ? '⏸ Pause' : m.phase === 'paused' ? '▶ Resume' : m.phase === 'intermission' ? '▶ Start next round now' : '▶ Start';
    toggle.classList.toggle('pause', running);
    $('winsText').textContent = `${teamName('messi')} ${m.wins.messi} - ${m.wins.ronaldo} ${teamName('ronaldo')}`;
    $('streakText').textContent = m.streak.team && m.streak.count >= 2 ? `🔥 ${teamName(m.streak.team)} x${m.streak.count} streak` : '';
    const box = $('durations');
    box.textContent = '';
    for (const sec of DURATIONS) {
      const b = el('button', m.duration === sec * 1000 ? 'on' : '', sec < 60 ? `${sec}s` : `${sec / 60} min`);
      b.type = 'button';
      b.onclick = () => timer({ action: 'duration', seconds: sec });
      box.appendChild(b);
    }
    renderClock();
  }

  function timer(body) {
    return post('/api/timer', body);
  }

  setInterval(renderClock, 250);

  // ---------- Live state ----------
  function showState(msg) {
    if (msg.match) showMatch(msg.match);
    if (msg.scores) {
      $('scoreMessi').textContent = msg.scores.messi;
      $('scoreRonaldo').textContent = msg.scores.ronaldo;
    }
    const recent = msg.recent || [];
    const log = $('log');
    log.textContent = '';
    for (const e of recent) {
      const li = el('li');
      const left = el('span');
      left.appendChild(el('span', e.team === 'messi' ? 'm' : 'r', `+${e.count} ${teamName(e.team)}`));
      const extra = [e.gift, e.sender && `· ${e.sender}`].filter(Boolean).join(' ');
      if (extra) left.appendChild(document.createTextNode(` ${extra}`));
      li.appendChild(left);
      li.appendChild(el('span', 't', new Date(e.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      log.appendChild(li);
    }
    if (!recent.length) log.appendChild(el('li', 't', 'No gifts yet'));
    const last = recent[0];
    $('undoInfo').textContent = last ? `Undo would remove: +${last.count} ${teamName(last.team)} ${last.gift || ''}` : '';
  }

  function connect() {
    const es = new EventSource('/events');
    es.onopen = () => $('dot').classList.add('on');
    es.onerror = () => $('dot').classList.remove('on');
    es.onmessage = (e) => {
      try {
        showState(JSON.parse(e.data));
      } catch (err) {
        console.error(err);
      }
    };
  }

  // ---------- Wire up ----------
  $('tToggle').onclick = () => timer({ action: 'toggle' });
  $('tEnd').onclick = () => {
    if (confirm('End this round now and declare the winner?')) timer({ action: 'end' });
  };
  $('tReset').onclick = () => timer({ action: 'reset' });
  $('tWins').onclick = () => {
    if (confirm('Reset the win count and streak?')) timer({ action: 'resetWins' });
  };
  for (const b of document.querySelectorAll('[data-sound]')) {
    b.onclick = async () => {
      if (await post('/api/sound', { team: b.dataset.sound })) {
        if (navigator.vibrate) navigator.vibrate(25);
        toast(b.dataset.sound === 'stop' ? '⏹ Sound stopped' : `🔊 ${b.textContent.replace('🔊 ', '')}`);
      }
    };
  }
  for (const b of document.querySelectorAll('[data-add]')) {
    b.onclick = () => timer({ action: 'add', seconds: Number(b.dataset.add) });
  }
  $('customMessi').onclick = () => sendCustom('messi');
  $('customRonaldo').onclick = () => sendCustom('ronaldo');
  $('undo').onclick = async () => {
    const data = await post('/api/undo');
    if (data) toast(`↩ Removed +${data.undone.count} ${teamName(data.undone.team)}`);
  };
  $('reset').onclick = async () => {
    if (!confirm('Reset the score to 0 - 0?')) return;
    if (await post('/api/reset')) toast('⟲ Score reset');
  };

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      config = cfg;
    })
    .catch(() => toast('⚠ Could not load config', true))
    .finally(() => {
      render();
      connect();
    });
})();

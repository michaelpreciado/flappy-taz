// Leaderboard client for Flattenhund.
//
// Talks to the Node server (server/server.js) when it is reachable. When it is
// not (static hosting, server stopped, flaky network) the game keeps a private
// leaderboard in localStorage instead and queues scores to sync later, so the
// leaderboard UI always works. window.gameDB.mode is 'online' or 'local'.
(function () {
  'use strict';

  const API_BASE = '/api';
  const LOCAL_KEY = 'flattenhund_local_scores_v1';
  const QUEUE_KEY = 'flattenhund_pending_scores_v1';
  const HEALTH_TIMEOUT_MS = 2500;
  const RECHECK_MS = 15000;

  let mode = 'local';
  let checkedAt = 0;
  let pending = null;

  // -- tiny safe storage helpers (storage can throw in private windows) -------
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  async function api(path, options) {
    const res = await fetch(API_BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || 'Request failed with status ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // -- local leaderboard -------------------------------------------------------
  function localScores() { return read(LOCAL_KEY, []); }
  function saveLocal(name, score, character) {
    const rows = localScores();
    const row = rows.find((r) => r.name === name);
    let updated = false;
    let previousScore = null;
    if (row) {
      previousScore = row.score;
      if (score > row.score) { row.score = score; row.character = character; updated = true; }
    } else {
      rows.push({ name: name, score: score, character: character });
    }
    rows.sort((a, b) => b.score - a.score);
    write(LOCAL_KEY, rows.slice(0, 50));
    return { updated: updated, previousScore: previousScore };
  }

  // -- connection --------------------------------------------------------------
  async function ping() {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS) : 0;
    try {
      const res = await fetch(API_BASE + '/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (!res.ok) return false;
      const body = await res.json();
      return body && body.ok === true;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function flushQueue() {
    const queue = read(QUEUE_KEY, []);
    if (!queue.length) return;
    const left = [];
    for (const item of queue) {
      try {
        await api('/scores', { method: 'POST', body: JSON.stringify(item) });
      } catch (e) {
        if (!e.status || e.status >= 500 || e.status === 429) left.push(item);
      }
    }
    write(QUEUE_KEY, left);
  }

  async function init() {
    if (pending) return pending;
    pending = (async () => {
      const ok = await ping();
      const wasLocal = mode === 'local';
      mode = ok ? 'online' : 'local';
      checkedAt = Date.now();
      if (ok && wasLocal) {
        console.info('[gameDB] server connected, leaderboard is online');
        flushQueue();
      } else if (!ok) {
        console.info('[gameDB] server unreachable, using the local leaderboard (run `npm start` for the shared one)');
      }
      return ok;
    })().finally(() => { pending = null; });
    return pending;
  }

  async function ensureFresh() {
    if (checkedAt === 0 || (mode === 'local' && Date.now() - checkedAt > RECHECK_MS)) await init();
    return mode === 'online';
  }

  // -- public API --------------------------------------------------------------
  async function getLeaderboard(limit) {
    limit = limit || 10;
    if (await ensureFresh()) {
      try {
        return await api('/leaderboard?limit=' + limit);
      } catch (e) {
        mode = 'local';
        checkedAt = Date.now();
      }
    }
    return localScores().slice(0, limit);
  }

  async function saveScore(name, score, character) {
    const playerName = String(name || '').substring(0, 10);
    if (!playerName || !Number.isInteger(score) || score < 0) return false;
    if (await ensureFresh()) {
      try {
        await api('/scores', { method: 'POST', body: JSON.stringify({ name: playerName, score: score, character: character }) });
        return true;
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) return false; // rejected by the server
        mode = 'local';
        checkedAt = Date.now();
      }
    }
    saveLocal(playerName, score, character);
    const queue = read(QUEUE_KEY, []);
    queue.push({ name: playerName, score: score, character: character });
    write(QUEUE_KEY, queue.slice(-20));
    return true;
  }

  async function createGameSession(character, isNightMode) {
    if (!(await ensureFresh())) return null;
    try {
      return await api('/sessions', { method: 'POST', body: JSON.stringify({ character: character, isNightMode: !!isNightMode }) });
    } catch (e) { return null; }
  }

  async function updateGameSession(sessionId, score, boostUsedCount) {
    if (!sessionId || mode !== 'online') return false;
    try {
      await api('/sessions/' + sessionId, { method: 'PATCH', body: JSON.stringify({ score: score, boostUsedCount: boostUsedCount || 0 }) });
      return true;
    } catch (e) { return false; }
  }

  window.gameDB = {
    getLeaderboard: getLeaderboard,
    saveScore: saveScore,
    createGameSession: createGameSession,
    updateGameSession: updateGameSession,
    // The leaderboard always works: online against the server, local otherwise.
    isAvailable: function () { return true; },
    isOnline: function () { return mode === 'online'; },
    get mode() { return mode; },
    init: init
  };
})();

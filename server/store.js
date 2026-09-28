// Storage layer for the Flattenhund server.
//
// Preferred backend: Node's built-in SQLite (`node:sqlite`, Node 22.5+; it needs
// the --experimental-sqlite flag before 22.13). If that module is missing we
// fall back to a tiny JSON-file store with the same interface, so `npm start`
// works on any Node 18+ instead of crashing at require() time.

const fs = require('fs');
const path = require('path');

const SEED = [
  { name: 'DEV', score: 100, character: 'taz' },
  { name: 'TEST', score: 50, character: 'chloe' },
];

// node:sqlite still prints an ExperimentalWarning; hide only that one line.
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (/SQLite is an experimental feature/.test(text)) return;
  return emitWarning.call(process, warning, ...args);
};

function openSqlite(dataDir, schemaSql) {
  // eslint-disable-next-line global-require
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(dataDir, 'flattenhund.db');
  const isNew = !fs.existsSync(file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(schemaSql);

  const q = {
    top: db.prepare('SELECT name, score FROM leaderboard ORDER BY score DESC, created_at ASC LIMIT ?'),
    find: db.prepare('SELECT id, score FROM leaderboard WHERE name = ? LIMIT 1'),
    insert: db.prepare('INSERT INTO leaderboard (name, score, character_used) VALUES (?, ?, ?)'),
    update: db.prepare(
      "UPDATE leaderboard SET score = ?, character_used = ?, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ),
    newSession: db.prepare('INSERT INTO game_sessions (character_used, is_night_mode) VALUES (?, ?)'),
    getSession: db.prepare('SELECT * FROM game_sessions WHERE id = ?'),
    endSession: db.prepare(
      "UPDATE game_sessions SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), score = ?, boost_used_count = ? WHERE id = ?"
    ),
  };

  const store = {
    backend: 'sqlite',
    location: file,
    topScores: (limit) => q.top.all(limit),
    saveScore(name, score, character) {
      const existing = q.find.get(name);
      if (existing) {
        if (score > existing.score) {
          q.update.run(score, character, existing.id);
          return { saved: true, updated: true, previousScore: existing.score, created: false };
        }
        return { saved: true, updated: false, previousScore: existing.score, created: false };
      }
      q.insert.run(name, score, character);
      return { saved: true, updated: false, previousScore: null, created: true };
    },
    createSession(character, night) {
      const r = q.newSession.run(character, night ? 1 : 0);
      return q.getSession.get(r.lastInsertRowid);
    },
    endSession(id, score, boosts) {
      return q.endSession.run(score, boosts, id).changes > 0;
    },
    close() { db.close(); },
  };
  if (isNew) SEED.forEach((s) => store.saveScore(s.name, s.score, s.character));
  return { store, isNew };
}

function openJson(dataDir) {
  const file = path.join(dataDir, 'flattenhund.json');
  let state = { leaderboard: [], sessions: [], nextSession: 1 };
  const isNew = !fs.existsSync(file);
  if (!isNew) {
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* start fresh */ }
  }
  let timer = null;
  const flush = () => {
    timer = null;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file); // atomic replace: a crash never leaves half a file
  };
  const persist = () => { if (!timer) timer = setTimeout(flush, 50); };

  const store = {
    backend: 'json',
    location: file,
    topScores: (limit) => state.leaderboard
      .slice().sort((a, b) => b.score - a.score || a.at.localeCompare(b.at))
      .slice(0, limit).map(({ name, score }) => ({ name, score })),
    saveScore(name, score, character) {
      const now = new Date().toISOString();
      const existing = state.leaderboard.find((r) => r.name === name);
      if (existing) {
        if (score > existing.score) {
          const previousScore = existing.score;
          Object.assign(existing, { score, character, at: now });
          persist();
          return { saved: true, updated: true, previousScore, created: false };
        }
        return { saved: true, updated: false, previousScore: existing.score, created: false };
      }
      state.leaderboard.push({ name, score, character, at: now });
      persist();
      return { saved: true, updated: false, previousScore: null, created: true };
    },
    createSession(character, night) {
      const s = {
        id: state.nextSession++, character_used: character, is_night_mode: night ? 1 : 0,
        score: 0, boost_used_count: 0, created_at: new Date().toISOString(), ended_at: null,
      };
      state.sessions.push(s);
      if (state.sessions.length > 500) state.sessions.splice(0, state.sessions.length - 500);
      persist();
      return s;
    },
    endSession(id, score, boosts) {
      const s = state.sessions.find((x) => x.id === id);
      if (!s) return false;
      Object.assign(s, { score, boost_used_count: boosts, ended_at: new Date().toISOString() });
      persist();
      return true;
    },
    close() { if (timer) { clearTimeout(timer); flush(); } },
  };
  if (isNew) SEED.forEach((s) => store.saveScore(s.name, s.score, s.character));
  return { store, isNew };
}

function openStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  if (process.env.FLATTENHUND_STORE !== 'json') {
    try {
      return openSqlite(dataDir, schemaSql);
    } catch (err) {
      console.warn(`[store] SQLite unavailable (${err.code || err.message}); using JSON file store. ` +
        'Use Node 22.13+ for SQLite.');
    }
  }
  return openJson(dataDir);
}

module.exports = { openStore };

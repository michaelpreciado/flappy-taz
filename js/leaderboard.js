// Leaderboard + personal-best flow for Flattenhund.
//
// - Personal data (nickname, best score, games played) lives in localStorage.
// - The board itself comes from window.gameDB (js/local-db.js): the shared
//   server board when reachable, a local board otherwise. Either way it works.
(function () {
    'use strict';

    const PLAYER_DATA_KEY = 'flattenhundPlayerData';
    const NAME_MAX = 10;               // matches the database CHECK constraint
    const BOARD_SIZE = 10;
    const MIN_QUALIFYING_SCORE = 5;    // ignore 1-4 point runs
    const REFRESH_MS = 30000;

    // ----------------------------------------------------------------------
    // Name filter. Strong terms match anywhere in the (de-leeted) name; short
    // or ambiguous ones only match the whole name, so CLASS, SHELL, PASS or
    // SIMPLE are fine while the words themselves are not.
    // ----------------------------------------------------------------------
    const BLOCK_ANYWHERE = [
        'nigger', 'nigga', 'faggot', 'retard', 'chink', 'spic', 'kike', 'wetback', 'tranny', 'coon',
        'cunt', 'whore', 'slut', 'bitch', 'fuck', 'fuk', 'shit', 'cock', 'dick', 'pussy', 'bastard',
        'asshole', 'nazi', 'hitler', 'rapist', 'pedo', 'porn', 'blowjob', 'kkk', 'cuck', 'twat',
        'motherfucker', 'penis', 'vagina', 'whitepower', 'kys'
    ];
    const BLOCK_WHOLE = [
        'fag', 'dyke', 'homo', 'ass', 'tit', 'tits', 'sex', 'xxx', 'anal', 'nig', 'jap', 'nip',
        'gook', 'paki', 'wop', 'hoe', 'thot', 'damn', 'hell', 'piss', 'die', 'incel', 'simp',
        '1488', '88', 'hh'
    ];
    const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', '$': 's', '!': 'i' };
    const SAFE_NAMES = ['PLAYER', 'PILOT', 'HERO', 'STAR', 'CHAMP', 'COMET', 'ROCKET', 'TURBO', 'DASH', 'ZOOM'];

    function normalize(text) {
        return text.toLowerCase().replace(/[01345788@$!]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, '');
    }

    function containsProfanity(text) {
        if (!text || typeof text !== 'string') return false;
        const flat = normalize(text);
        // '1488' and '88' are digits, so test the raw digits/letters form too
        const raw = text.toLowerCase().replace(/[^a-z0-9]/g, '');
        return BLOCK_ANYWHERE.some((w) => flat.includes(w)) ||
            BLOCK_WHOLE.some((w) => flat === w || raw === w);
    }

    function sanitizePlayerName(name) {
        if (!name || typeof name !== 'string') return 'PLAYER';
        // eslint-disable-next-line no-control-regex
        const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, NAME_MAX);
        if (!clean) return 'PLAYER';
        if (containsProfanity(clean)) return SAFE_NAMES[(Math.random() * SAFE_NAMES.length) | 0];
        return clean;
    }

    // ----------------------------------------------------------------------
    // Player data
    // ----------------------------------------------------------------------
    function getPlayerData() {
        try {
            const raw = localStorage.getItem(PLAYER_DATA_KEY);
            if (raw) {
                const d = JSON.parse(raw);
                return {
                    nickname: d.nickname ? sanitizePlayerName(d.nickname) : null,
                    highestScore: Number.isFinite(d.highestScore) ? d.highestScore : 0,
                    totalGames: Number.isFinite(d.totalGames) ? d.totalGames : 0,
                    lastPlayed: d.lastPlayed || null
                };
            }
        } catch (e) { /* storage unavailable or corrupt */ }
        return { nickname: null, highestScore: 0, totalGames: 0, lastPlayed: null };
    }

    function savePlayerData(data) {
        try { localStorage.setItem(PLAYER_DATA_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
    }

    function updatePlayerScore(score) {
        const data = getPlayerData();
        const isNewHighScore = score > data.highestScore;
        if (isNewHighScore) data.highestScore = score;
        data.totalGames += 1;
        data.lastPlayed = new Date().toISOString();
        savePlayerData(data);
        return { isNewHighScore, playerData: data };
    }

    const hasStoredNickname = () => !!getPlayerData().nickname;
    const getPlayerNickname = () => getPlayerData().nickname || 'PLAYER';
    function setPlayerNickname(nickname) {
        const data = getPlayerData();
        data.nickname = sanitizePlayerName(nickname);
        savePlayerData(data);
        return data.nickname;
    }

    // ----------------------------------------------------------------------
    // Board state + rendering
    // ----------------------------------------------------------------------
    let board = [];
    let entriesEl, formEl, inputEl, saveBtn, titleEl, statusEl;
    let loading = false;

    const db = () => window.gameDB;
    const isOnline = () => !!(db() && db().isOnline && db().isOnline());

    async function loadLeaderboard() {
        try {
            const rows = db() ? await db().getLeaderboard(BOARD_SIZE) : [];
            board = Array.isArray(rows) ? rows : [];
        } catch (e) {
            board = [];
        }
        return board;
    }

    function renderLeaderboard() {
        if (!entriesEl) return;
        const online = isOnline();
        if (titleEl) {
            titleEl.textContent = online ? 'ONLINE LEADERBOARD' : 'LOCAL LEADERBOARD';
            titleEl.dataset.mode = online ? 'online' : 'local';
            titleEl.title = online ? 'Shared scores from the game server'
                : 'The game server is offline: showing scores saved on this device';
        }
        entriesEl.textContent = '';

        if (!board.length) {
            const row = document.createElement('div');
            row.className = 'leaderboard-row leaderboard-empty';
            row.setAttribute('role', 'listitem');
            row.textContent = 'No scores yet. Be the first!';
            entriesEl.appendChild(row);
            return;
        }

        const me = getPlayerData().nickname;
        const frag = document.createDocumentFragment();
        board.forEach((entry, i) => {
            const row = document.createElement('div');
            row.className = 'leaderboard-row' + (me && entry.name === me ? ' is-me' : '') + (i === 0 ? ' is-first' : '');
            row.setAttribute('role', 'listitem');
            const rank = document.createElement('div');
            rank.className = 'rank';
            rank.textContent = String(i + 1);
            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = sanitizePlayerName(entry.name);
            const score = document.createElement('div');
            score.className = 'score';
            score.textContent = String(entry.score || 0);
            row.append(rank, name, score);
            frag.appendChild(row);
        });
        entriesEl.appendChild(frag);
    }

    async function refreshLeaderboard() {
        if (loading) return board;
        loading = true;
        try {
            await loadLeaderboard();
            renderLeaderboard();
        } finally {
            loading = false;
        }
        return board;
    }

    // ----------------------------------------------------------------------
    // Personal best flow
    // ----------------------------------------------------------------------
    function qualifies(score) {
        if (score < MIN_QUALIFYING_SCORE) return false;
        if (board.length < BOARD_SIZE) return true;
        const lowest = board[board.length - 1];
        return !lowest || score > (lowest.score || 0);
    }

    function setFormBusy(busy, label) {
        if (saveBtn) { saveBtn.disabled = busy; if (label) saveBtn.textContent = label; }
        if (inputEl) inputEl.disabled = busy;
    }

    async function autoSavePlayerScore(nickname, score) {
        const ok = await db().saveScore(sanitizePlayerName(nickname), score, window.selectedCharacter || 'taz');
        if (ok) {
            if (window.triggerHaptic) window.triggerHaptic('success');
            await refreshLeaderboard();
        }
        return ok;
    }

    async function saveHighScore() {
        const data = getPlayerData();
        if (!data.highestScore) { formEl.classList.add('hidden'); return; }
        const name = setPlayerNickname(sanitizePlayerName(inputEl.value));
        setFormBusy(true, 'SAVING...');
        const ok = await db().saveScore(name, data.highestScore, window.selectedCharacter || 'taz');
        if (!ok) {
            setFormBusy(false, 'TRY AGAIN');
            if (window.showMobileHint) window.showMobileHint('Could not save the score. Try again.', 2500);
            return;
        }
        saveBtn.textContent = 'SAVED!';
        if (window.triggerHaptic) window.triggerHaptic('success');
        if (window.showMobileHint) {
            window.showMobileHint(isOnline() ? 'Saved, ' + name + '!' : 'Saved on this device, ' + name + '!', 2500);
        }
        await refreshLeaderboard();
        setTimeout(() => {
            formEl.classList.add('hidden');
            inputEl.value = '';
            setFormBusy(false, 'SAVE SCORE');
        }, 900);
    }

    function checkAndPromptForPersonalBest(score) {
        if (typeof score !== 'number' || !isFinite(score) || score < 0) return false;
        const { isNewHighScore, playerData } = updatePlayerScore(score);
        const eligible = isNewHighScore && qualifies(score);
        formEl && formEl.classList.add('hidden');
        if (!eligible) return false;

        if (playerData.nickname) {
            if (window.showMobileHint) window.showMobileHint('New record, ' + playerData.nickname + ': ' + playerData.highestScore, 2500);
            setTimeout(() => autoSavePlayerScore(playerData.nickname, playerData.highestScore), 400);
            return false;
        }
        if (!formEl) return false;
        const msg = formEl.querySelector('p');
        if (msg) msg.textContent = 'NEW PERSONAL BEST! PICK A NICKNAME';
        setFormBusy(false, 'SAVE SCORE');
        inputEl.value = '';
        formEl.classList.remove('hidden');
        setTimeout(() => { try { inputEl.focus({ preventScroll: true }); } catch (e) { inputEl.focus(); } }, 150);
        return true;
    }

    function syncGameHighScore() {
        const best = getPlayerData().highestScore;
        if (typeof window.setGameHighScore === 'function') window.setGameHighScore(best);
    }

    // ----------------------------------------------------------------------
    // Init
    // ----------------------------------------------------------------------
    function wireForm() {
        saveBtn.addEventListener('click', saveHighScore);
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveHighScore(); }
            e.stopPropagation(); // typing a name must never flap the dog
        });
        inputEl.addEventListener('focus', () => inputEl.select());
        inputEl.addEventListener('input', () => {
            const bad = containsProfanity(inputEl.value);
            inputEl.setAttribute('aria-invalid', bad ? 'true' : 'false');
            saveBtn.disabled = bad;
            saveBtn.textContent = bad ? 'PICK ANOTHER NAME' : 'SAVE SCORE';
        });
    }

    async function initLeaderboard() {
        entriesEl = document.getElementById('leaderboard-entries');
        formEl = document.getElementById('new-high-score-form');
        inputEl = document.getElementById('player-name');
        saveBtn = document.getElementById('save-score-button');
        titleEl = document.querySelector('.leaderboard-title');
        statusEl = null;
        if (saveBtn && inputEl && formEl) wireForm();
        syncGameHighScore();
        if (db()) { try { await db().init(); } catch (e) { /* local mode */ } }
        await refreshLeaderboard();
        setInterval(() => {
            if (!document.hidden && (!window.gameStarted || window.gameOver)) refreshLeaderboard();
        }, REFRESH_MS);
    }

    window.leaderboardDebug = {
        refreshLeaderboard, loadLeaderboard, renderLeaderboard, getPlayerData, getPlayerNickname,
        hasStoredNickname, getCurrentLeaderboard: () => board, containsProfanity, sanitizePlayerName,
        getMode: () => (isOnline() ? 'online' : 'local'),
        clearPlayerData: () => { try { localStorage.removeItem(PLAYER_DATA_KEY); } catch (e) { /* ignore */ } return true; }
    };
    window.checkAndPromptForPersonalBest = checkAndPromptForPersonalBest;
    window.refreshLeaderboard = refreshLeaderboard;
    window.initializeLeaderboardSystem = async function () {
        try { await initLeaderboard(); return true; } catch (e) { console.warn('Leaderboard init failed:', e); return false; }
    };
})();

// WebAudio engine for Flattenhund: synthesized 8-bit effects, no audio files.
//
// - The AudioContext is created lazily and resumed on the first user gesture
//   (browsers keep it suspended until then).
// - Everything routes through one master gain -> compressor, so mute, volume
//   and clipping are handled in a single place.
// - Sounds are scheduled on the audio clock (no setTimeout), so they stay
//   tight even when the main thread is busy.
// - Mute is remembered in localStorage and toggled with the HUD button or "M".
(function () {
    'use strict';

    const MUTE_KEY = 'flattenhund_muted';
    const VOLUME = 0.55;

    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* storage blocked */ }

    function ensure() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try {
            ctx = new AC({ latencyHint: 'interactive' });
        } catch (e) {
            return null;
        }
        master = ctx.createGain();
        master.gain.value = muted ? 0 : VOLUME;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 6;
        master.connect(comp);
        comp.connect(ctx.destination);
        return ctx;
    }

    // Must be called from a user gesture; safe to call repeatedly.
    function unlock() {
        const c = ensure();
        if (c && c.state === 'suspended') c.resume().catch(function () {});
        return !!c;
    }

    function ready() {
        return ctx && ctx.state === 'running' && !muted;
    }

    // One oscillator voice with an attack/decay envelope and optional pitch slide.
    function tone(freq, start, dur, opts) {
        if (!ready()) return;
        const o = opts || {};
        const t0 = ctx.currentTime + (start || 0);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = o.type || 'square';
        osc.frequency.setValueAtTime(freq, t0);
        if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
        const vol = o.vol == null ? 0.16 : o.vol;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
    }

    function noise(start, dur, vol, cutoff) {
        if (!ready()) return;
        if (!noiseBuffer) {
            noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
            const d = noiseBuffer.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const t0 = ctx.currentTime + (start || 0);
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const g = ctx.createGain();
        src.buffer = noiseBuffer;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(cutoff || 1800, t0);
        filter.frequency.exponentialRampToValueAtTime(120, t0 + dur);
        g.gain.setValueAtTime(vol, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(g);
        g.connect(master);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
    }

    // Semitone steps above a base frequency (used for the combo climb).
    const semis = function (base, n) { return base * Math.pow(2, n / 12); };

    const sfx = {
        flap: function () {
            // Tiny upward chirp; pitch wobbles a little so it never gets grating.
            const f = 420 + Math.random() * 60;
            tone(f, 0, 0.09, { slideTo: f * 1.6, vol: 0.09 });
        },
        score: function (combo) {
            const n = Math.min(combo || 0, 7) * 2;
            tone(semis(784, n), 0, 0.08, { vol: 0.12 });
            tone(semis(1047, n), 0.07, 0.14, { vol: 0.12 });
        },
        perfect: function (combo) {
            const n = Math.min(combo || 1, 8);
            const base = semis(659, n);
            tone(base, 0, 0.07, { vol: 0.1, type: 'triangle' });
            tone(base * 1.25, 0.06, 0.07, { vol: 0.1, type: 'triangle' });
            tone(base * 1.5, 0.12, 0.16, { vol: 0.1, type: 'triangle' });
        },
        hit: function () {
            noise(0, 0.32, 0.5, 2400);
            tone(196, 0, 0.28, { type: 'sawtooth', slideTo: 70, vol: 0.2 });
        },
        gameOver: function () {
            [659, 587, 523, 494, 440, 392].forEach(function (f, i) {
                tone(f, 0.35 + i * 0.14, 0.18, { vol: 0.1 });
            });
        },
        highScore: function () {
            [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.11, 0.16, { vol: 0.13 }); });
            [880, 988, 1047, 1175, 1319].forEach(function (f, i) { tone(f, 0.5 + i * 0.07, 0.09, { vol: 0.1 }); });
            tone(523, 0.1, 0.9, { type: 'triangle', vol: 0.07 });
        },
        click: function () { tone(880, 0, 0.05, { vol: 0.07, type: 'triangle' }); },
        toggleOn: function () { tone(660, 0, 0.06, { vol: 0.08, type: 'triangle' }); tone(990, 0.06, 0.08, { vol: 0.08, type: 'triangle' }); }
    };

    function setMuted(value) {
        muted = !!value;
        try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.02);
        syncButtons();
        if (!muted) { unlock(); sfx.toggleOn(); }
    }

    function syncButtons() {
        const btn = document.getElementById('sound-toggle');
        if (!btn) return;
        btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
        btn.setAttribute('aria-label', muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
        btn.classList.toggle('is-muted', muted);
    }

    // First gesture anywhere unlocks audio (autoplay policy, iOS Safari).
    ['pointerdown', 'keydown', 'touchend'].forEach(function (type) {
        window.addEventListener(type, function once() {
            if (unlock()) {
                window.removeEventListener('pointerdown', once, true);
                window.removeEventListener('keydown', once, true);
                window.removeEventListener('touchend', once, true);
            }
        }, true);
    });

    // Do not burn battery or play into the void while the tab is hidden.
    document.addEventListener('visibilitychange', function () {
        if (!ctx) return;
        if (document.hidden) ctx.suspend().catch(function () {});
        else if (!muted) ctx.resume().catch(function () {});
    });

    document.addEventListener('DOMContentLoaded', function () {
        const btn = document.getElementById('sound-toggle');
        if (btn) btn.addEventListener('click', function () { setMuted(!muted); });
        syncButtons();
    });
    window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
            !/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) {
            setMuted(!muted);
        }
    });

    window.gameAudio = {
        unlock: unlock,
        play: function (name, arg) { if (sfx[name]) sfx[name](arg); },
        setMuted: setMuted,
        toggleMute: function () { setMuted(!muted); return muted; },
        isMuted: function () { return muted; }
    };
})();

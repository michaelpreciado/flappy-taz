// Mobile ergonomics for Flattenhund: viewport height, zoom/scroll guards,
// haptics, screen wake lock and a small accessible toast.
//
// Flap/start input is handled once, by pointer events in game.js. This file
// deliberately does not listen for touchstart to flap (that used to fire a
// second flap for every tap on touch screens).
(function () {
    'use strict';

    const canVibrate = typeof navigator.vibrate === 'function';
    const PATTERNS = { light: 8, medium: 16, success: [10, 60, 10], error: [60, 40, 90] };

    // -- viewport: real visible height (iOS toolbars, on-screen keyboard) ------
    function setViewportVars() {
        const vv = window.visualViewport;
        const h = vv ? vv.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-h', h + 'px');
        document.documentElement.style.setProperty('--vh', (h * 0.01) + 'px');
    }
    setViewportVars();
    window.addEventListener('resize', setViewportVars, { passive: true });
    window.addEventListener('orientationchange', function () { setTimeout(setViewportVars, 120); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setViewportVars, { passive: true });

    // -- zoom / scroll guards ---------------------------------------------------
    // The play field must never scroll or zoom; the menu and leaderboard panels
    // must (they are scrollable on short phones), so touchmove is only blocked
    // on the canvas and the layers that sit on it.
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('touchmove', function (e) {
        if (e.touches.length > 1) { e.preventDefault(); return; }
        const t = e.target;
        if (t && t.closest && !t.closest('.start-screen, .game-over, input, .toast')) e.preventDefault();
    }, { passive: false });

    // -- haptics ------------------------------------------------------------------
    window.triggerHaptic = function (type) {
        if (!canVibrate) return;
        try { navigator.vibrate(PATTERNS[type] || PATTERNS.light); } catch (e) { /* ignore */ }
    };

    // -- toast ------------------------------------------------------------------
    let toastTimer = 0;
    window.showMobileHint = function (message, duration) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, duration || 2500);
    };

    // -- wake lock (keep the screen on while playing) ---------------------------
    let wakeLock = null;
    async function requestWakeLock() {
        if (!('wakeLock' in navigator) || wakeLock) return;
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', function () { wakeLock = null; });
        } catch (e) { wakeLock = null; }
    }
    function releaseWakeLock() {
        if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    }
    document.addEventListener('game:start', requestWakeLock);
    document.addEventListener('game:over', releaseWakeLock);
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && window.gameStarted && !window.gameOver) requestWakeLock();
    });

    // -- haptic hooks on game events ----------------------------------------------
    document.addEventListener('game:score', function () { window.triggerHaptic('light'); });
    document.addEventListener('game:over', function () { window.triggerHaptic('error'); });

    // -- landscape phones: nudge once toward portrait -----------------------------
    document.addEventListener('DOMContentLoaded', function () {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (coarse && window.innerWidth > window.innerHeight && window.innerHeight < 500) {
            window.showMobileHint('Portrait feels better on phones', 3500);
        }
    });
})();

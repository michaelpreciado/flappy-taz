// Matrix glyph rain + impact FX for the glass UI layer.
//
// One small transparent canvas sits between the game canvas and the menu
// overlays. Columns fall at three depths (small/slow/dim -> large/fast/bright)
// which gives the rain a cheap parallax, and the whole layer drifts a few
// pixels against the pointer / device tilt. It is throttled to ~30fps, uses
// DPR 1 (glyphs are soft by design), pauses when the tab is hidden and draws a
// single still frame under prefers-reduced-motion.
(function () {
    'use strict';

    const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789<>{}/=+*'.split('');
    const CYAN = '92,225,242';
    const BLUE = '106,166,255';
    const FRAME_MS = 1000 / 30;

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    const prefersReduced = () => !!(reduced && reduced.matches);

    let canvas, ctx, w = 0, h = 0, cols = [], last = 0, running = false, raf = 0;
    let px = 0, py = 0, tx = 0, ty = 0;

    function makeColumns() {
        cols = [];
        const layers = [
            { size: 10, step: 12, speed: 26, alpha: 0.5, tint: BLUE },
            { size: 13, step: 16, speed: 46, alpha: 0.8, tint: CYAN },
            { size: 17, step: 22, speed: 78, alpha: 1,  tint: CYAN }
        ];
        // Column count scales with width but is capped so phones stay cheap.
        const budget = Math.min(64, Math.max(14, Math.floor(w / 26)));
        layers.forEach((L, li) => {
            const n = Math.round(budget * [0.9, 0.7, 0.4][li]);
            for (let i = 0; i < n; i++) {
                cols.push({
                    x: Math.round(Math.random() * w / L.step) * L.step,
                    y: Math.random() * -h,
                    speed: L.speed * (0.7 + Math.random() * 0.6),
                    len: 8 + Math.floor(Math.random() * 14),
                    size: L.size,
                    step: L.step,
                    alpha: L.alpha,
                    tint: L.tint,
                    g: [],
                    acc: 0
                });
            }
        });
    }

    function resize() {
        if (!canvas) return;
        w = canvas.clientWidth || window.innerWidth;
        h = canvas.clientHeight || window.innerHeight;
        canvas.width = w;
        canvas.height = h;
        makeColumns();
        if (prefersReduced()) drawStill();
    }

    function glyph() {
        return GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }

    function drawColumn(c, dt) {
        c.y += c.speed * dt;
        c.acc += c.speed * dt;
        // Shift a fresh glyph into the column each time it advances one cell.
        while (c.acc >= c.step) {
            c.acc -= c.step;
            c.g.unshift(glyph());
            if (c.g.length > c.len) c.g.pop();
        }
        if (c.y - c.len * c.step > h) {
            c.y = -Math.random() * h * 0.5;
            c.x = Math.round(Math.random() * w / c.step) * c.step;
            c.g.length = 0;
        }
        ctx.font = c.size + 'px ' + 'ui-monospace, Menlo, Consolas, monospace';
        for (let i = 0; i < c.g.length; i++) {
            const y = c.y - i * c.step;
            if (y < -c.step || y > h + c.step) continue;
            const fade = 1 - i / c.len;
            if (i === 0) {
                ctx.fillStyle = 'rgba(214,250,255,' + (c.alpha * 0.95).toFixed(2) + ')';
            } else {
                ctx.fillStyle = 'rgba(' + c.tint + ',' + (c.alpha * Math.pow(fade, 1.3)).toFixed(3) + ')';
            }
            ctx.fillText(c.g[i], c.x, y);
        }
    }

    function frame(t) {
        raf = 0;
        if (!running) return;
        raf = requestAnimationFrame(frame);
        if (t - last < FRAME_MS) return;
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;

        // ease the parallax offset toward the pointer target
        px += (tx - px) * 0.06;
        py += (ty - py) * 0.06;
        canvas.style.transform = 'translate3d(' + px.toFixed(2) + 'px,' + py.toFixed(2) + 'px,0)';

        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < cols.length; i++) drawColumn(cols[i], dt);
    }

    function drawStill() {
        ctx.clearRect(0, 0, w, h);
        for (const c of cols) {
            c.y = Math.random() * h;
            c.g = [];
            for (let i = 0; i < c.len; i++) c.g.push(glyph());
            drawColumn(c, 0);
        }
    }

    function start() {
        if (running || prefersReduced() || document.hidden) return;
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
    }
    function stop() {
        running = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
    }

    function initRain() {
        const host = document.querySelector('.game-container');
        if (!host) return;
        canvas = document.createElement('canvas');
        canvas.id = 'matrix-rain';
        canvas.setAttribute('aria-hidden', 'true');
        const gameCanvas = document.getElementById('game-canvas');
        host.insertBefore(canvas, gameCanvas ? gameCanvas.nextSibling : host.firstChild);
        ctx = canvas.getContext('2d');
        resize();

        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
        if (reduced && reduced.addEventListener) {
            reduced.addEventListener('change', () => {
                if (prefersReduced()) { stop(); drawStill(); } else { start(); }
            });
        }

        // Pointer / tilt parallax (a few px — it is atmosphere, not a control).
        window.addEventListener('pointermove', (e) => {
            tx = (e.clientX / window.innerWidth - 0.5) * -18;
            ty = (e.clientY / window.innerHeight - 0.5) * -18;
        }, { passive: true });

        if (prefersReduced()) drawStill(); else start();
    }

    // Body flag so CSS can dim the rain during play and light it on menus.
    document.addEventListener('game:start', () => document.body.classList.add('is-playing', 'has-played'));
    document.addEventListener('game:over', () => document.body.classList.remove('is-playing'));

    // Public helpers used by game.js
    window.fx = {
        reducedMotion: prefersReduced,
        flash() {
            if (prefersReduced()) return;
            let el = document.getElementById('fx-flash');
            if (!el) {
                el = document.createElement('div');
                el.id = 'fx-flash';
                (document.querySelector('.game-container') || document.body).appendChild(el);
            }
            el.classList.remove('go');
            void el.offsetWidth; // restart the animation
            el.classList.add('go');
        },
        shake(mag, ms) {
            if (prefersReduced()) return;
            const el = document.getElementById('game-canvas');
            if (!el || !el.animate) return;
            const n = 7, kf = [];
            for (let i = 0; i < n; i++) {
                const k = 1 - i / n;
                kf.push({ transform: 'translate(' + ((Math.random() * 2 - 1) * mag * k).toFixed(1) + 'px,' +
                                                   ((Math.random() * 2 - 1) * mag * k).toFixed(1) + 'px)' });
            }
            kf.push({ transform: 'translate(0,0)' });
            el.animate(kf, { duration: ms || 320, easing: 'ease-out' });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initRain);
    } else {
        initRain();
    }
})();

// Ambient sky life: pixel birds by day, shooting stars and a wandering UFO by
// night. Time-based (units per second, spawn rates per second) so it looks the
// same at 60 and 144 Hz, and pooled so it never allocates while running.
//
// game.js calls ambient.update(dt, playing, night) and ambient.draw(ctx, night)
// once per rendered frame; nothing here patches other modules.
const ambient = (function () {
    'use strict';

    const BIRDS = 3, STARS = 2, TRAIL = 14;
    const birds = [];
    const stars = [];
    const ufo = { on: false, x: 0, y: 0, vx: 0, t: 0 };
    for (let i = 0; i < BIRDS; i++) birds.push({ on: false, x: 0, y: 0, vx: 0, size: 8, t: 0 });
    for (let i = 0; i < STARS; i++) {
        stars.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, size: 2, life: 0, n: 0, tx: new Float32Array(TRAIL), ty: new Float32Array(TRAIL) });
    }

    let horizon = 400;
    let width = 800;

    function resize(w, groundY) { width = w; horizon = groundY; }

    function update(dt, playing, night) {
        if (!playing) return;
        if (night) {
            birds.forEach(function (b) { b.on = false; });
            // shooting stars: ~1 every 6 s
            for (let i = 0; i < STARS; i++) {
                const s = stars[i];
                if (s.on) {
                    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= 1.2 * dt;
                    // shift trail history (fixed-size ring, no allocation)
                    for (let k = 0; k < TRAIL - 1; k++) { s.tx[k] = s.tx[k + 1]; s.ty[k] = s.ty[k + 1]; }
                    s.tx[TRAIL - 1] = s.x; s.ty[TRAIL - 1] = s.y;
                    if (s.life <= 0 || s.x > width + 20 || s.y > horizon) s.on = false;
                } else if (Math.random() < dt / 6) {
                    const ang = Math.PI * (0.2 + Math.random() * 0.15), sp = 260 + Math.random() * 220;
                    s.on = true; s.x = Math.random() * width * 0.8; s.y = Math.random() * horizon * 0.3;
                    s.vx = Math.cos(ang) * sp; s.vy = Math.sin(ang) * sp; s.life = 1; s.size = 2 + Math.random() * 2;
                    for (let k = 0; k < TRAIL; k++) { s.tx[k] = s.x; s.ty[k] = s.y; }
                }
            }
            // UFO: ~1 every 40 s, crosses slowly
            if (ufo.on) {
                ufo.x += ufo.vx * dt; ufo.t += dt;
                if (ufo.x < -40 || ufo.x > width + 40) ufo.on = false;
            } else if (Math.random() < dt / 40) {
                const left = Math.random() < 0.5;
                ufo.on = true; ufo.x = left ? -30 : width + 30; ufo.vx = (left ? 1 : -1) * (24 + Math.random() * 26);
                ufo.y = 50 + Math.random() * 90; ufo.t = 0;
            }
        } else {
            stars.forEach(function (s) { s.on = false; });
            ufo.on = false;
            for (let i = 0; i < BIRDS; i++) {
                const b = birds[i];
                if (b.on) {
                    b.x += b.vx * dt; b.t += dt;
                    if (b.x < -30 || b.x > width + 30) b.on = false;
                } else if (Math.random() < dt / 3) {
                    const left = Math.random() < 0.5;
                    b.on = true; b.x = left ? -20 : width + 20; b.vx = (left ? 1 : -1) * (30 + Math.random() * 60);
                    b.y = 50 + Math.random() * Math.max(40, horizon - 200); b.size = 8 + Math.random() * 4; b.t = 0;
                }
            }
        }
    }

    function draw(ctx, night) {
        if (night) {
            for (let i = 0; i < STARS; i++) {
                const s = stars[i];
                if (!s.on) continue;
                for (let k = 0; k < TRAIL; k++) {
                    const f = k / TRAIL;
                    ctx.globalAlpha = f * s.life;
                    const sz = s.size * f;
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(s.tx[k] - sz / 2, s.ty[k] - sz / 2, sz, sz);
                }
                ctx.globalAlpha = s.life;
                ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
            }
            ctx.globalAlpha = 1;
            if (ufo.on) {
                const y = Math.round(ufo.y + Math.sin(ufo.t * 3) * 3), x = Math.round(ufo.x);
                ctx.fillStyle = '#CFD8E3'; ctx.fillRect(x - 5, y - 6, 10, 4);
                ctx.fillStyle = '#8C97A6'; ctx.fillRect(x - 10, y - 2, 20, 4);
                ctx.fillStyle = '#5A6473'; ctx.fillRect(x - 6, y + 2, 12, 2);
                ctx.fillStyle = (Math.floor(ufo.t * 6) & 1) ? '#5CE1F2' : '#FFFFFF';
                ctx.fillRect(x - 8, y - 1, 2, 2); ctx.fillRect(x - 1, y - 1, 2, 2); ctx.fillRect(x + 6, y - 1, 2, 2);
            }
            return;
        }
        ctx.fillStyle = 'rgba(8,20,40,0.85)';
        for (let i = 0; i < BIRDS; i++) {
            const b = birds[i];
            if (!b.on) continue;
            const dir = b.vx < 0 ? -1 : 1, s = b.size, x = Math.round(b.x), y = Math.round(b.y);
            ctx.fillRect(x - s / 2, y - s / 4, s, s / 2);                                  // body
            ctx.fillRect(dir > 0 ? x + s / 2 : x - s, y - s / 2, s / 2, s / 2);            // head
            ctx.fillRect(x - s / 4, (Math.floor(b.t * 6) & 1) ? y + s / 4 : y - s / 2, s / 2, s / 4); // wing flap
        }
    }

    return { update: update, draw: draw, resize: resize };
})();

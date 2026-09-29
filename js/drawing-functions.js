// Scenery renderer for Flattenhund: parallax sky, hills / skyline, ground, pipes.
//
// Everything static is painted ONCE into offscreen canvases (sky + sun/moon,
// hill strips, skyline strip, ground tile, pipe body/cap sprites, clouds) whenever the
// size, DPR or day/night theme changes. A frame is then a handful of
// drawImage calls: no per-frame allocations, no per-frame gradient or
// path work. Layouts come from a seeded PRNG so the world never reshuffles.
//
// Globals used from game.js: ctx, canvas, currentDpr, ground, pipes,
// isDarkMode, GROUND_HEIGHT, PIPE_WIDTH.

const CAP_H = 30;      // pipe cap height (px)
const CAP_LIP = 8;     // how far a cap overhangs the pipe body (each side)
const STRIP_STEP = 8;  // hill column width (px)
const GROUND_TILE = 512;

let scenery = null;
let parallaxFar = 0;
let parallaxMid = 0;
let parallaxGround = 0;
let cloudDrift = 0;

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Stable per-column hash for the ground tile
function hash2(i, salt) {
    let h = (i * 374761393 + salt * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function viewW() { return canvas.width / currentDpr; }
function viewH() { return canvas.height / currentDpr; }
function groundTop() { return ground.y || viewH() - GROUND_HEIGHT; }

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const SCENERY_THEMES = {
    day: {
        skyStops: [[0, '#3E8EDE'], [0.55, '#71C6E8'], [1, '#C8EFF5']],
        farLayer: '#93D4DE', midLayer: '#7CC96F', midLayerShade: '#65B25A',
        cloud: 'rgba(255,255,255,0.95)', cloudShade: 'rgba(214,240,246,0.95)',
        grass: '#7ECB3F', grassLight: '#A8E063', grassSeam: '#5FA030',
        dirt: '#E3D18F', dirtSpeck: '#D2BE74', dirtSpeckDark: '#C0AA5E',
        pipe: { edge: '#4E8F1F', shade: '#63AD27', mid: '#74BF2E', hi: '#9FE04A', outline: '#2F5D10', rim: '#B8F06A' }
    },
    night: {
        skyStops: [[0, '#070B22'], [0.55, '#1B2340'], [1, '#40466F']],
        farLayer: '#151B38', midLayer: '#12321F', midLayerShade: '#0C2617',
        cloud: 'rgba(150,160,200,0.22)', cloudShade: 'rgba(120,130,175,0.22)',
        grass: '#2E5D3A', grassLight: '#3E7A4C', grassSeam: '#1F4429',
        dirt: '#4A3B22', dirtSpeck: '#57462A', dirtSpeckDark: '#3C2F1A',
        pipe: { edge: '#173A22', shade: '#20512F', mid: '#2A623D', hi: '#3E7A4C', outline: '#0E2415', rim: '#5CB878', glow: 'rgba(102,242,184,0.16)', glowLine: '#66F2B8' }
    }
};

// ---------------------------------------------------------------------------
// Offscreen helpers
// ---------------------------------------------------------------------------

// A DPR-scaled offscreen layer addressed in CSS pixels.
function makeLayer(wCss, hCss) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(wCss * currentDpr));
    c.height = Math.max(1, Math.ceil(hCss * currentDpr));
    const g = c.getContext('2d');
    g.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    g.imageSmoothingEnabled = false;
    return { c: c, g: g, w: wCss, h: hCss };
}

function snap(v) { return Math.round(v * currentDpr) / currentDpr; }

function paintDisc(g, cx, cy, r, color) {
    g.fillStyle = color;
    for (let y = -r; y < r; y += 4) {
        const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)) / 4) * 4;
        g.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 4);
    }
}

// Shaded vertical pipe band table (fractions of the width)
const PIPE_BANDS = [
    [0.00, 0.08, 'outline'], [0.08, 0.16, 'edge'], [0.16, 0.30, 'shade'], [0.30, 0.52, 'mid'],
    [0.52, 0.68, 'hi'], [0.68, 0.82, 'mid'], [0.82, 0.92, 'shade'], [0.92, 1.00, 'outline']
];

function paintPipeColumn(g, p, x, width, y, height) {
    for (let i = 0; i < PIPE_BANDS.length; i++) {
        const b = PIPE_BANDS[i];
        g.fillStyle = p[b[2]];
        g.fillRect(Math.round(x + width * b[0]), y, Math.max(1, Math.round(width * (b[1] - b[0]))), height);
    }
}

// ---------------------------------------------------------------------------
// Scenery construction (once per resize / DPR / theme change)
// ---------------------------------------------------------------------------

function ensureScenery() {
    const w = viewW();
    const h = viewH();
    const mode = isDarkMode ? 'night' : 'day';
    if (scenery && scenery.w === w && scenery.h === h && scenery.mode === mode && scenery.dpr === currentDpr) {
        return scenery;
    }

    const theme = SCENERY_THEMES[mode];
    const rand = mulberry32(1337);
    const horizon = groundTop();

    // --- sky + sun/moon, one static layer ---
    const sky = makeLayer(w, horizon + GROUND_HEIGHT * 0.4);
    const grad = sky.g.createLinearGradient(0, 0, 0, sky.h);
    theme.skyStops.forEach(function (s) { grad.addColorStop(s[0], s[1]); });
    sky.g.fillStyle = grad;
    sky.g.fillRect(0, 0, w, sky.h);
    if (mode === 'night') {
        const mx = w * 0.78, my = horizon * 0.18, mr = 26;
        const halo = sky.g.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.4);
        halo.addColorStop(0, 'rgba(244,241,222,0.35)');
        halo.addColorStop(1, 'rgba(244,241,222,0)');
        sky.g.fillStyle = halo;
        sky.g.fillRect(mx - mr * 3.4, my - mr * 3.4, mr * 6.8, mr * 6.8);
        paintDisc(sky.g, mx, my, mr, '#F4F1DE');
        sky.g.fillStyle = '#DDD8BC';
        sky.g.fillRect(mx - 10, my - 4, 8, 8);
        sky.g.fillRect(mx + 4, my + 6, 6, 6);
        sky.g.fillRect(mx + 2, my - 14, 5, 5);
    } else {
        const sx = w * 0.8, sy = horizon * 0.16, sr = 30;
        const halo = sky.g.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 3.2);
        halo.addColorStop(0, 'rgba(255,236,160,0.55)');
        halo.addColorStop(1, 'rgba(255,236,160,0)');
        sky.g.fillStyle = halo;
        sky.g.fillRect(sx - sr * 3.2, sy - sr * 3.2, sr * 6.4, sr * 6.4);
        paintDisc(sky.g, sx, sy, sr, '#FFE066');
        paintDisc(sky.g, sx, sy, sr - 8, '#FFF0A8');
    }

    // --- stars (drawn live: they twinkle). Flat typed array, no objects ---
    const starCount = mode === 'night' ? 70 : 0;
    const stars = new Float32Array(starCount * 5); // x, y, size, phase, speed
    for (let i = 0; i < starCount; i++) {
        stars[i * 5] = Math.floor(rand() * w);
        stars[i * 5 + 1] = Math.floor(rand() * horizon * 0.85);
        stars[i * 5 + 2] = rand() < 0.85 ? 2 : 3;
        stars[i * 5 + 3] = rand() * Math.PI * 2;
        stars[i * 5 + 4] = 0.6 + rand() * 1.8;
    }

    // --- hill strips: seamless (integer sine periods over the strip width) ---
    const stripW = Math.ceil(Math.max(w, 640) * 1.5 / STRIP_STEP) * STRIP_STEP;
    const cols = stripW / STRIP_STEP;
    function hillStrip(base, a1, a2, wave1, wave2, color, shade) {
        const height = Math.ceil(base + a1 + a2 + 2);
        const L = makeLayer(stripW, height);
        const k1 = Math.max(1, Math.round(stripW / wave1));
        const k2 = Math.max(1, Math.round(stripW / wave2));
        const p1 = rand() * Math.PI * 2, p2 = rand() * Math.PI * 2;
        for (let i = 0; i < cols; i++) {
            const u = (i / cols) * Math.PI * 2;
            const hc = Math.floor(base + a1 * (0.5 + 0.5 * Math.sin(k1 * u + p1)) + a2 * (0.5 + 0.5 * Math.sin(k2 * u + p2)));
            L.g.fillStyle = color;
            L.g.fillRect(i * STRIP_STEP, height - hc, STRIP_STEP + 1, hc);
            if (shade) {
                L.g.fillStyle = shade;
                L.g.fillRect(i * STRIP_STEP, height - hc * 0.45, STRIP_STEP + 1, hc * 0.45);
            }
        }
        return L;
    }
    const far = hillStrip(34, 26, 14, 570, 210, theme.farLayer, null);

    // --- mid layer: bushes (day) or lit skyline (night) ---
    let mid;
    if (mode === 'night') {
        mid = makeLayer(stripW, 140);
        let x = 0;
        while (x < stripW) {
            const bw = 26 + Math.floor(rand() * 40);
            const bh = 40 + Math.floor(rand() * 90);
            mid.g.fillStyle = '#10152C';
            mid.g.fillRect(x, 140 - bh, bw, bh);
            for (let wx = 5; wx < bw - 6; wx += 9) {
                for (let wy = 8; wy < bh - 6; wy += 12) {
                    if (rand() < 0.35 && rand() > 0.12) {
                        mid.g.fillStyle = rand() < 0.7 ? '#FFD87A' : '#9AD9FF';
                        mid.g.fillRect(x + wx, 140 - bh + wy, 4, 5);
                    }
                }
            }
            x += bw + 2 + Math.floor(rand() * 8);
        }
    } else {
        mid = hillStrip(16, 18, 10, 314, 95, theme.midLayer, theme.midLayerShade);
    }

    // --- clouds: one small sprite each ---
    const clouds = [];
    const cloudCount = Math.max(4, Math.round(w / 110));
    for (let i = 0; i < cloudCount; i++) {
        const u = 0.7 + rand() * 1.1;
        const cw = Math.ceil(64 * u) + 2, ch = Math.ceil(30 * u) + 2;
        const L = makeLayer(cw, ch);
        L.g.fillStyle = theme.cloud;
        L.g.fillRect(10 * u, 8 * u, 44 * u, 12 * u);
        L.g.fillRect(0, 18 * u, 64 * u, 12 * u);
        L.g.fillRect(20 * u, 0, 22 * u, 10 * u);
        L.g.fillStyle = theme.cloudShade;
        L.g.fillRect(0, 25 * u, 64 * u, 5 * u);
        clouds.push({
            img: L, x: rand() * (w + 200) - 100, y: 30 + rand() * horizon * 0.42 - 8 * u,
            speed: 3 + rand() * 5, alpha: 0.65 + rand() * 0.35
        });
    }

    // --- ground tile: periodic, so scrolling is two drawImage calls ---
    const TUFT_PAD = 8;
    const gt = makeLayer(GROUND_TILE, GROUND_HEIGHT + TUFT_PAD);
    const gy = TUFT_PAD;
    gt.g.fillStyle = theme.dirt;
    gt.g.fillRect(0, gy, GROUND_TILE, GROUND_HEIGHT);
    const dirtCols = GROUND_TILE / 16;
    for (let col = 0; col < dirtCols; col++) {
        for (let row = 0; row < Math.floor((GROUND_HEIGHT - 34) / 16); row++) {
            const r = hash2(col, row * 7 + 1);
            if (r < 0.30) {
                gt.g.fillStyle = r < 0.15 ? theme.dirtSpeck : theme.dirtSpeckDark;
                const size = r < 0.08 ? 8 : 6;
                gt.g.fillRect(col * 16 + Math.floor(hash2(col, row + 40) * 8), gy + 36 + row * 16, size, size);
            }
        }
    }
    gt.g.fillStyle = theme.grassLight; gt.g.fillRect(0, gy, GROUND_TILE, 6);
    gt.g.fillStyle = theme.grass;      gt.g.fillRect(0, gy + 6, GROUND_TILE, 14);
    gt.g.fillStyle = theme.grassSeam;  gt.g.fillRect(0, gy + 20, GROUND_TILE, 4);
    for (let col = 0; col < GROUND_TILE / 8; col++) {
        const r = hash2(col, 99);
        if (r < 0.55) {
            const tuftH = 2 + Math.floor(r * 8);
            gt.g.fillStyle = r < 0.28 ? theme.grassLight : theme.grass;
            gt.g.fillRect(col * 8, gy - tuftH, 4, tuftH);
        }
    }

    // --- pipe sprites: body strip + two caps ---
    const p = theme.pipe;
    const pipeW = PIPE_WIDTH;
    const body = makeLayer(pipeW, 8);
    paintPipeColumn(body.g, p, 0, pipeW, 0, 8);
    const capW = pipeW + CAP_LIP * 2;
    function makeCap(rimOnTop) {
        const L = makeLayer(capW, CAP_H);
        paintPipeColumn(L.g, p, 0, capW, 0, CAP_H);
        L.g.fillStyle = p.outline;
        L.g.fillRect(0, rimOnTop ? CAP_H - 3 : 0, capW, 3);       // outer edge
        L.g.fillStyle = p.glowLine || p.rim;
        L.g.fillRect(0, rimOnTop ? 0 : CAP_H - 3, capW, 3);       // bright rim facing the gap
        return L;
    }

    scenery = {
        w: w, h: h, dpr: currentDpr, mode: mode, theme: theme,
        sky: sky, stars: stars, far: far, mid: mid, stripW: stripW, clouds: clouds,
        ground: gt, tuftPad: TUFT_PAD,
        pipeBody: body, capTop: makeCap(false), capBottom: makeCap(true), capW: capW
    };
    return scenery;
}

function invalidateScenery() { scenery = null; }

// ---------------------------------------------------------------------------
// Scroll state (advanced once per rendered frame with real elapsed time)
// ---------------------------------------------------------------------------

// state: 'play' scrolls at game speed, 'idle' drifts slowly, 'frozen' stops.
function advanceScenery(dt, state) {
    if (state === 'frozen') return;
    const playing = state === 'play';
    parallaxFar += dt * (4 + (playing ? PIPE_SPEED_PPS * 0.10 : 0));
    parallaxMid += dt * (9 + (playing ? PIPE_SPEED_PPS * 0.25 : 0));
    parallaxGround += dt * (playing ? PIPE_SPEED_PPS : 12);
    cloudDrift += dt;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawWrapped(L, offset, y, viewWidth, stripW) {
    let x = -(offset % stripW);
    while (x < viewWidth) {
        ctx.drawImage(L.c, snap(x), y, L.w, L.h);
        x += stripW;
    }
}

function drawBackground(nowMs) {
    const s = ensureScenery();
    const horizon = groundTop();

    ctx.drawImage(s.sky.c, 0, 0, s.sky.w, s.sky.h);
    ctx.fillStyle = s.theme.skyStops[2][1];
    ctx.fillRect(0, s.sky.h, s.w, s.h - s.sky.h);   // any sliver below the sky layer

    if (s.stars.length) drawStars(s, nowMs);
    drawWrapped(s.far, parallaxFar, horizon - s.far.h, s.w, s.stripW);
    drawWrapped(s.mid, parallaxMid, horizon - s.mid.h, s.w, s.stripW);
    drawClouds(s);
}

function drawStars(s, nowMs) {
    const t = nowMs / 1000;
    const a = s.stars;
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < a.length; i += 5) {
        ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * a[i + 4] + a[i + 3]));
        ctx.fillRect(a[i], a[i + 1], a[i + 2], a[i + 2]);
    }
    ctx.globalAlpha = 1;
}

function drawClouds(s) {
    const span = s.w + 240;
    for (let i = 0; i < s.clouds.length; i++) {
        const c = s.clouds[i];
        let x = c.x - (cloudDrift * c.speed) % span;
        if (x < -140) x += span;
        ctx.globalAlpha = c.alpha;
        ctx.drawImage(c.img.c, snap(x), Math.round(c.y), c.img.w, c.img.h);
    }
    ctx.globalAlpha = 1;
}

function drawGround() {
    const s = ensureScenery();
    const scroll = Math.floor(parallaxGround);
    const y = groundTop() - s.tuftPad;
    for (let x = -(scroll % GROUND_TILE); x < s.w; x += GROUND_TILE) {
        ctx.drawImage(s.ground.c, x, y, s.ground.w, s.ground.h);
    }
}

// alpha: render interpolation between the last two fixed simulation steps
function drawPipes(alpha) {
    if (pipes.length === 0) return;
    const s = ensureScenery();
    const groundY = groundTop();
    const glow = s.theme.pipe.glow;
    for (let i = 0; i < pipes.length; i++) {
        const pipe = pipes[i];
        const x = Math.round(pipe.px + (pipe.x - pipe.px) * alpha);
        const width = pipe.width;
        const topBodyH = pipe.top.height - CAP_H;
        const bottomBodyY = pipe.bottom.y + CAP_H;

        if (glow) {
            ctx.fillStyle = glow;
            ctx.fillRect(x - CAP_LIP - 5, 0, width + CAP_LIP * 2 + 10, pipe.top.height + 5);
            ctx.fillRect(x - CAP_LIP - 5, pipe.bottom.y - 5, width + CAP_LIP * 2 + 10, groundY - pipe.bottom.y + 5);
        }
        if (topBodyH > 0) ctx.drawImage(s.pipeBody.c, x, 0, width, topBodyH);
        if (groundY - bottomBodyY > 0) ctx.drawImage(s.pipeBody.c, x, bottomBodyY, width, groundY - bottomBodyY);
        ctx.drawImage(s.capTop.c, x - CAP_LIP, topBodyH, s.capW, CAP_H);
        ctx.drawImage(s.capBottom.c, x - CAP_LIP, pipe.bottom.y, s.capW, CAP_H);
    }
}

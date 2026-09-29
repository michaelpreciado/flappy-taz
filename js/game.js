// Flattenhund core: fixed-timestep simulation, render loop, input, game flow.
//
// Loop design
//  - One requestAnimationFrame loop for menu, play and game over.
//  - Physics runs on a fixed 120 Hz step fed by an accumulator, so a 60, 120 or
//    144 Hz display all play identically. Rendering interpolates between the
//    last two steps, so motion stays smooth even when the display rate is not a
//    multiple of the step (e.g. 144 Hz).
//  - Menu / game-over screens render at ~30 fps (the scene is slow and sits
//    behind blurred glass); full rate whenever something is animating.
//  - All sprites, scenery, gradients and glow are cached offscreen; particles
//    and floaters live in fixed pools, so a frame allocates nothing.
//
// All gameplay geometry is in CSS pixels; the canvas transform maps to device
// pixels (DPR capped at 2).

// ---------------------------------------------------------------------------
// Tunables (per-second units; values are the original 60 fps frame values x60)
// ---------------------------------------------------------------------------

const STEP = 1 / 120;                        // fixed simulation step (s)
const MAX_STEPS_PER_FRAME = 10;              // spiral-of-death guard
const MAX_FRAME_DELTA_SECONDS = 0.1;         // clamp after tab switches / hitches

const GRAVITY_ACCEL = 0.25 * 60 * 60;        // 900 px/s^2
const FLAP_VELOCITY_SET = -5.5 * 60;         // -330 px/s
const PIPE_SPEED_PPS = 3.1 * 60;             // 186 px/s
const FORWARD_LEAP_VEL_CHANGE_PPS = 0.6 * 60;
const MAX_FORWARD_SPEED_PPS = 2.0 * 60;
const FORWARD_DRAG_FACTOR = 0.97;            // per 1/60 s
const FLOAT_DURATION_SECONDS = 18 / 60;
const FLOAT_GRAVITY_MULTIPLIER = 0.6;

const PIPE_SPAWN_INTERVAL = 2.0;             // seconds
const PIPE_GAP = 170;
const PIPE_WIDTH = 90;
const GROUND_HEIGHT = 120;
const DOG_SIZE = 48;
const HITBOX_INSET = 5;                      // forgiving hitbox: 5 px shaved off each side of the sprite
const PERFECT_WINDOW = 30;                   // px from gap centre = "perfect" pass (cosmetic combo only)
const MAX_PIPE_CENTRE_DELTA = 260;           // successive gaps never swing further apart than this

const PARTICLE_POOL = 180;
const FLOATER_POOL = 8;
const TRAIL_LEN = 20;                        // recorded sim steps (~167 ms)

const CYAN = '#5CE1F2';
const SMOKE_COLORS = ['#FFFFFF', '#CFF7FC', CYAN];
const BURST_COLORS = ['#FFFFFF', CYAN, '#6AA6FF'];
const DEATH_COLORS = ['#FFFFFF', CYAN, '#6AA6FF', '#FF5A6A'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let canvas, ctx;
let currentDpr = 1;
let ground = { y: 0 };
let pipes = [];
let score = 0;
let highScore = 0;
let combo = 0;
let bestCombo = 0;
let isDarkMode = false;
let selectedCharacter = null;      // 'taz' | 'chloe'
let currentSession = null;

let gameStarted = false;           // true from the first tap until reset
let gameOver = false;
let paused = false;

let rafId = 0;
let lastFrameTs = 0;
let lastRenderTs = 0;
let accumulator = 0;
let pipeTimer = 0;
let deadTime = 0;
let qualityLevel = 'high';
const frameSamples = new Float32Array(60);
let frameSampleIdx = 0;
let frameSampleFill = 0;
let lastPipeCentre = -1;

const dog = {
    x: 80, y: 300, px: 80, py: 300,
    width: DOG_SIZE, height: DOG_SIZE,
    velocity: 0, velocityX: 0,
    floatTimer: 0, flapPulse: false,
    rotation: 0, prevRotation: 0,
    scaleX: 1, scaleY: 1,
    bob: 0, spin: 0
};

// Trail: ring buffer of recent positions (x, y pairs)
const trail = new Float32Array(TRAIL_LEN * 2);
let trailCount = 0;
let trailHead = 0;

// Pools (no allocation during play)
const particles = [];
for (let i = 0; i < PARTICLE_POOL; i++) {
    particles.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, size: 4, life: 0, decay: 1, color: '#fff' });
}
let particleCursor = 0;
const floaters = [];
for (let i = 0; i < FLOATER_POOL; i++) {
    floaters.push({ on: false, x: 0, y: 0, text: '', life: 0, big: false });
}
let floaterCursor = 0;

// Assets
const sprites = { taz: new Image(), chloe: new Image() };
const spriteCache = { taz: null, chloe: null, dpr: 0 };
let glowSprite = null;
let glowDpr = 0;

// DOM
let startScreen, gameOverScreen, scoreDisplay, finalScoreDisplay, highScoreDisplay;
let newHighScoreSplash, splashScoreElement, comboEl, pauseEl, restartBtn;
let splashTimer = 0, finishTimer = 0;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const reducedMotion = () => !!(window.fx && window.fx.reducedMotion());
const sfx = (name, arg) => { if (window.gameAudio) window.gameAudio.play(name, arg); };
// Frame-rate independent exponential smoothing: equivalent to `v += (t - v) * k`
// once per 1/60 s frame, applied over dt.
const smoothing = (k60, dt) => 1 - Math.pow(1 - k60, 60 * dt);

function isPlaying() { return gameStarted && !gameOver && !paused; }

// ---------------------------------------------------------------------------
// Init / resize
// ---------------------------------------------------------------------------

function init() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d', { alpha: false });
    startScreen = document.getElementById('start-screen');
    gameOverScreen = document.getElementById('game-over');
    scoreDisplay = document.getElementById('score');
    finalScoreDisplay = document.getElementById('final-score');
    highScoreDisplay = document.getElementById('high-score');
    newHighScoreSplash = document.getElementById('new-high-score-splash');
    splashScoreElement = document.getElementById('splash-score');
    comboEl = document.getElementById('combo');
    pauseEl = document.getElementById('pause-overlay');
    restartBtn = document.getElementById('restart-button');

    isDarkMode = document.body.classList.contains('dark-mode');
    highScoreDisplay.textContent = highScore;

    sprites.taz.src = 'assets/images/taz.png';
    sprites.chloe.src = 'assets/images/chloe.png';

    resizeCanvas();
    window.addEventListener('resize', scheduleResize, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize, { passive: true });
    watchDpr();
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
    window.addEventListener('blur', pauseGame);

    setupMenu();

    canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    if (pauseEl) pauseEl.addEventListener('pointerdown', (e) => { e.preventDefault(); resumeGame(); });

    window.updateGameTheme = function (darkModeEnabled) {
        isDarkMode = darkModeEnabled;
        invalidateScenery();
        if (!isPlaying()) drawFrame(1, 0, performance.now());
    };
    window.setGameHighScore = function (n) {
        if (Number.isFinite(n) && n > highScore) {
            highScore = n;
            highScoreDisplay.textContent = highScore;
        }
    };

    if (window.initializeLeaderboardSystem) window.initializeLeaderboardSystem();

    lastFrameTs = performance.now();
    rafId = requestAnimationFrame(frame);
}

function setupMenu() {
    const tazBtn = document.getElementById('choose-taz');
    const chloeBtn = document.getElementById('choose-chloe');
    const startBtn = document.getElementById('start-button');

    function choose(name) {
        selectedCharacter = name;
        tazBtn.classList.toggle('selected', name === 'taz');
        chloeBtn.classList.toggle('selected', name === 'chloe');
        tazBtn.setAttribute('aria-pressed', String(name === 'taz'));
        chloeBtn.setAttribute('aria-pressed', String(name === 'chloe'));
        sfx('click');
    }
    tazBtn.addEventListener('click', () => choose('taz'));
    chloeBtn.addEventListener('click', () => choose('chloe'));
    choose('taz');

    startBtn.addEventListener('click', startGame);
    restartBtn.addEventListener('click', resetGame);
}

let resizeQueued = false;
function scheduleResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
}

// Re-fit when the DPR changes (dragging between monitors, browser zoom)
function watchDpr() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    const onChange = () => { resizeCanvas(); watchDpr(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
}

function resizeCanvas() {
    if (!canvas) return;
    const host = canvas.parentElement;
    const cssW = host.clientWidth || window.innerWidth;
    const cssH = host.clientHeight || window.innerHeight;
    currentDpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * currentDpr);
    canvas.height = Math.floor(cssH * currentDpr);
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ground.y = cssH - GROUND_HEIGHT;
    for (let i = 0; i < pipes.length; i++) pipes[i].bottom.height = Math.max(0, cssH - pipes[i].bottom.y);
    ambient.resize(cssW, ground.y);
    if (gameStarted && !gameOver) dog.y = Math.min(dog.y, ground.y - dog.height);
    if (!isPlaying()) drawFrame(1, 0, performance.now());
}

// Sprites pre-scaled once (high-quality downscale) so the per-frame blit is a 1:1 copy
function ensureSpriteCache() {
    if (spriteCache.dpr === currentDpr && spriteCache.taz && spriteCache.chloe) return;
    ['taz', 'chloe'].forEach((name) => {
        const img = sprites[name];
        if (!img.complete || !img.naturalWidth) { spriteCache[name] = null; return; }
        const c = document.createElement('canvas');
        c.width = c.height = Math.round(DOG_SIZE * currentDpr);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        spriteCache[name] = c;
    });
    if (spriteCache.taz && spriteCache.chloe) spriteCache.dpr = currentDpr;   // else retry next frame
}

function ensureGlowSprite() {
    if (glowSprite && glowDpr === currentDpr) return glowSprite;
    const size = Math.round(80 * currentDpr);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 2, r, r, r);
    grad.addColorStop(0, 'rgba(92,225,242,0.55)');
    grad.addColorStop(0.45, 'rgba(92,225,242,0.16)');
    grad.addColorStop(1, 'rgba(92,225,242,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    glowSprite = c;
    glowDpr = currentDpr;
    return c;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    if (gameStarted && !gameOver) return;
    if (!selectedCharacter) selectedCharacter = 'taz';
    clearTimeout(splashTimer);
    clearTimeout(finishTimer);
    if (window.gameAudio) window.gameAudio.unlock();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    gameStarted = true;
    gameOver = false;
    paused = false;
    if (pauseEl) pauseEl.classList.remove('show');
    startScreen.style.display = 'none';
    gameOverScreen.style.display = 'none';
    newHighScoreSplash.classList.remove('show');
    newHighScoreSplash.style.display = 'none';
    canvas.style.transition = 'none';
    canvas.style.filter = 'none';

    score = 0;
    combo = 0;
    bestCombo = 0;
    updateScore();
    updateCombo();

    const h = canvas.height / currentDpr;
    dog.y = dog.py = Math.min(230, h * 0.35);
    dog.x = dog.px = 80;
    dog.velocity = -3.0 * 60;
    dog.velocityX = 0.5 * 60;
    dog.floatTimer = FLOAT_DURATION_SECONDS * 1.33;
    dog.rotation = dog.prevRotation = 0;
    dog.scaleX = dog.scaleY = 1;
    dog.bob = 0;
    dog.spin = 0;

    pipes.length = 0;
    lastPipeCentre = -1;
    for (let i = 0; i < particles.length; i++) particles[i].on = false;
    for (let i = 0; i < floaters.length; i++) floaters[i].on = false;
    trailCount = 0;
    trailHead = 0;
    pipeTimer = PIPE_SPAWN_INTERVAL * 0.35;
    accumulator = 0;
    deadTime = 0;
    qualityLevel = 'high';
    frameSampleFill = 0;
    frameSampleIdx = 0;
    lastFrameTs = performance.now();

    // Session tracking must never delay the first flap
    currentSession = null;
    if (window.gameDB) {
        window.gameDB.createGameSession(selectedCharacter, isDarkMode).then((s) => { currentSession = s; }).catch(() => {});
    }

    document.dispatchEvent(new CustomEvent('game:start'));
}

function resetGame() {
    startGame();
}

function pauseGame() {
    if (!isPlaying()) return;
    paused = true;
    if (pauseEl) pauseEl.classList.add('show');
}

function resumeGame() {
    if (!paused) return;
    paused = false;
    if (pauseEl) pauseEl.classList.remove('show');
    lastFrameTs = performance.now();
    accumulator = 0;
}

function flap() {
    dog.scaleY = 0.9;
    dog.scaleX = 1.05;
    dog.velocity = FLAP_VELOCITY_SET;
    dog.floatTimer = FLOAT_DURATION_SECONDS;
    dog.velocityX = Math.max(-MAX_FORWARD_SPEED_PPS, Math.min(MAX_FORWARD_SPEED_PPS, dog.velocityX + FORWARD_LEAP_VEL_CHANGE_PPS));
    dog.flapPulse = true;   // consumed by the next sim step (spawns smoke, squash)
    sfx('flap');
}

function gameEnd() {
    if (gameOver) return;
    gameOver = true;
    deadTime = 0;
    trailCount = 0;
    dog.velocity = -210;                 // little death hop, then tumble
    dog.velocityX = 0;
    dog.spin = (Math.random() < 0.5 ? -1 : 1) * 7;
    combo = 0;
    updateCombo();

    spawnBurst(dog.x + dog.width / 2, dog.y + dog.height / 2, 26,
        { speed: 300, gravity: 620, lift: 90, size: 5, decay: 1.1, colors: DEATH_COLORS });
    if (window.fx) { window.fx.shake(11, 380); window.fx.flash(); }
    sfx('hit');
    document.dispatchEvent(new CustomEvent('game:over', { detail: { score } }));

    const isNewHighScore = score > highScore;
    if (isNewHighScore) {
        highScore = score;
        showNewHighScoreSplash(score);
        setTimeout(() => sfx('highScore'), 450);
        finishTimer = setTimeout(finishGameOver, 2600);
    } else {
        finishTimer = setTimeout(finishGameOver, reducedMotion() ? 350 : 750);
    }
}

function finishGameOver() {
    canvas.style.transition = 'filter 1.2s ease-in-out';
    canvas.style.filter = 'grayscale(70%) contrast(115%) brightness(72%)';
    sfx('gameOver');

    const stored = window.leaderboardDebug ? window.leaderboardDebug.getPlayerData() : null;
    if (stored && stored.highestScore > highScore) highScore = stored.highestScore;
    finalScoreDisplay.textContent = score;
    highScoreDisplay.textContent = highScore;

    if (window.gameDB && currentSession) {
        window.gameDB.updateGameSession(currentSession.id, score, 0);
    }

    gameOverScreen.style.display = 'flex';
    gameOverScreen.scrollTop = 0;
    try { restartBtn.focus({ preventScroll: true }); } catch (e) { restartBtn.focus(); }
    if (window.checkAndPromptForPersonalBest) window.checkAndPromptForPersonalBest(score);
}

function showNewHighScoreSplash(n) {
    if (!newHighScoreSplash || !splashScoreElement) return;
    splashScoreElement.textContent = n;
    newHighScoreSplash.style.display = 'flex';
    void newHighScoreSplash.offsetWidth;
    newHighScoreSplash.classList.add('show');
    splashTimer = setTimeout(() => {
        newHighScoreSplash.classList.remove('show');
        newHighScoreSplash.style.display = 'none';
    }, 2600);
}

function updateScore() {
    scoreDisplay.textContent = score;
    scoreDisplay.classList.remove('pop');
    if (score > 0) {
        void scoreDisplay.offsetWidth; // restart the CSS keyframe
        scoreDisplay.classList.add('pop');
    }
}

function updateCombo() {
    if (!comboEl) return;
    if (combo >= 2) {
        comboEl.textContent = 'x' + combo;
        comboEl.classList.remove('bump');
        void comboEl.offsetWidth;
        comboEl.classList.add('show', 'bump');
    } else {
        comboEl.classList.remove('show', 'bump');
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function actionPressed() {
    if (paused) { resumeGame(); return; }
    if (!gameStarted) { startGame(); return; }
    if (!gameOver) flap();
}

function handlePointerDown(e) {
    e.preventDefault();
    if (gameOver) return;               // the game-over panel owns restarts
    actionPressed();
}

function handleKeyDown(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.code === 'Escape' || e.code === 'KeyP') {
        if (typing) return;
        if (isPlaying()) pauseGame(); else if (paused) resumeGame();
        return;
    }
    const flapKey = e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
    if (!flapKey || typing) return;

    if (isPlaying() || paused) {          // in play, Space always flaps (never activates a focused button)
        e.preventDefault();
        actionPressed();
        return;
    }
    if (!gameStarted && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault();
        actionPressed();
    }
}

// ---------------------------------------------------------------------------
// Simulation (fixed step)
// ---------------------------------------------------------------------------

function step(dt) {
    dog.px = dog.x;
    dog.py = dog.y;
    dog.prevRotation = dog.rotation;
    for (let i = 0; i < pipes.length; i++) pipes[i].px = pipes[i].x;

    if (gameOver) { stepDead(dt); return; }

    // Vertical: gravity is reduced while the float timer runs
    let g = GRAVITY_ACCEL;
    if (dog.floatTimer > 0) {
        g *= FLOAT_GRAVITY_MULTIPLIER;
        dog.floatTimer = Math.max(0, dog.floatTimer - dt);
    }
    dog.velocity += g * dt;

    if (dog.flapPulse) {
        dog.flapPulse = false;
        dog.scaleY = 1.1;
        dog.scaleX = 0.95;
        spawnSmoke();
    }
    const relax = smoothing(0.1, dt);
    dog.scaleX += (1 - dog.scaleX) * relax;
    dog.scaleY += (1 - dog.scaleY) * relax;
    dog.bob = (dog.bob + dt * 3) % (Math.PI * 2);

    dog.y += dog.velocity * dt;
    dog.x += dog.velocityX * dt;
    dog.velocityX *= Math.pow(FORWARD_DRAG_FACTOR, 60 * dt);

    const viewW = canvas.width / currentDpr;
    const minX = 40, maxX = viewW / 3;
    if (dog.x < minX) { dog.x = minX; dog.velocityX = 0; }
    else if (dog.x > maxX) { dog.x = maxX; dog.velocityX = 0; }

    const target = Math.max(-400, Math.min(400, dog.velocity)) / 400 * 0.3;
    dog.rotation += (target - dog.rotation) * smoothing(0.15, dt);

    // Hitbox is inset from the sprite: brushing a pipe with an ear is forgiven
    const hx = dog.x + HITBOX_INSET, hy = dog.y + HITBOX_INSET;
    const hw = dog.width - HITBOX_INSET * 2, hh = dog.height - HITBOX_INSET * 2;

    if (hy + hh > ground.y) { dog.y = ground.y - hh - HITBOX_INSET; gameEnd(); return; }
    if (dog.y < 0) { dog.y = 0; dog.velocity = 0; }

    pipeTimer += dt;
    if (pipeTimer >= PIPE_SPAWN_INTERVAL) { spawnPipe(); pipeTimer -= PIPE_SPAWN_INTERVAL; }

    for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= PIPE_SPEED_PPS * dt;
        if (pipe.x + pipe.width < 0) { pipes.splice(i, 1); continue; }

        const overlapX = hx + hw > pipe.x && hx < pipe.x + pipe.width;
        if (overlapX) {
            const centre = pipe.top.height + (pipe.bottom.y - pipe.top.height) / 2;
            const dev = Math.abs(hy + hh / 2 - centre);
            if (dev > pipe.worstDev) pipe.worstDev = dev;
            if (hy < pipe.top.height || hy + hh > pipe.bottom.y) { gameEnd(); return; }
        }

        if (!pipe.passed && dog.x > pipe.x + pipe.width) {
            pipe.passed = true;
            onPipePassed(pipe);
        }
    }

    // trail (ring buffer)
    trail[trailHead * 2] = dog.x;
    trail[trailHead * 2 + 1] = dog.y;
    trailHead = (trailHead + 1) % TRAIL_LEN;
    if (trailCount < TRAIL_LEN) trailCount++;
}

// After death: the dog hops, tumbles and lands; pipes freeze
function stepDead(dt) {
    deadTime += dt;
    dog.velocity += GRAVITY_ACCEL * 1.4 * dt;
    dog.y += dog.velocity * dt;
    dog.rotation += dog.spin * dt;
    dog.spin *= Math.pow(0.5, dt * 2);
    const floorY = ground.y - dog.height + HITBOX_INSET;
    if (dog.y > floorY) {
        dog.y = floorY;
        if (dog.velocity > 160) { dog.velocity *= -0.32; dog.spin *= 0.5; } else { dog.velocity = 0; dog.spin = 0; }
    }
}

function onPipePassed(pipe) {
    score++;
    const perfect = pipe.worstDev <= PERFECT_WINDOW;
    combo = perfect ? combo + 1 : 0;
    if (combo > bestCombo) bestCombo = combo;
    updateScore();
    updateCombo();

    const gapY = pipe.top.height + (pipe.bottom.y - pipe.top.height) / 2;
    const px = pipe.x + pipe.width;
    spawnBurst(px, gapY, perfect ? 18 : 10, { speed: perfect ? 240 : 180, gravity: 240, decay: 1.9 });

    const milestone = score % 10 === 0;
    let label = '+1';
    if (milestone) label = score + '!';
    else if (perfect && combo >= 2) label = 'PERFECT x' + combo;
    else if (perfect) label = 'NICE';
    addFloater(dog.x + dog.width / 2, dog.y - 6, label, milestone || combo >= 3);

    if (milestone) {
        spawnBurst(dog.x + dog.width / 2, dog.y + dog.height / 2, 30, { speed: 320, gravity: 120, decay: 1.4, size: 5 });
        if (window.fx) window.fx.flash();
    } else if (combo >= 3 && window.fx) {
        window.fx.shake(Math.min(3 + combo * 0.4, 6), 160);
    }

    sfx('score', combo);
    if (perfect && combo >= 2) sfx('perfect', combo);
    document.dispatchEvent(new CustomEvent('game:score', { detail: { score, combo, perfect } }));
}

function spawnPipe() {
    const viewWidth = canvas.width / currentDpr;
    const viewHeight = canvas.height / currentDpr;

    // Generous gap for the first pipes, tightening to PIPE_GAP by ~10 points
    const gap = PIPE_GAP + Math.max(0, 60 - score * 6);
    const usable = Math.max(60, viewHeight - GROUND_HEIGHT - gap);
    const minTop = Math.max(40, Math.min(80, usable * 0.3));
    const maxTop = Math.max(minTop, usable - minTop);

    let topHeight = Math.floor(minTop + Math.random() * (maxTop - minTop));
    if (lastPipeCentre >= 0) {
        // keep consecutive gaps reachable in the ~1.4 s between pipes
        const centre = topHeight + gap / 2;
        const clamped = Math.max(lastPipeCentre - MAX_PIPE_CENTRE_DELTA, Math.min(lastPipeCentre + MAX_PIPE_CENTRE_DELTA, centre));
        topHeight = Math.floor(Math.max(minTop, Math.min(maxTop, clamped - gap / 2)));
    }
    lastPipeCentre = topHeight + gap / 2;

    const bottomY = topHeight + gap;
    pipes.push({
        x: viewWidth, px: viewWidth, width: PIPE_WIDTH,
        top: { y: 0, height: topHeight, width: PIPE_WIDTH },
        bottom: { y: bottomY, height: viewHeight - bottomY, width: PIPE_WIDTH },
        passed: false, worstDev: 0
    });
}

// ---------------------------------------------------------------------------
// Particles / floaters (pooled)
// ---------------------------------------------------------------------------

function nextParticle() {
    // Reuse the first free slot after the cursor; overwrite the oldest when full
    for (let n = 0; n < PARTICLE_POOL; n++) {
        const p = particles[particleCursor];
        particleCursor = (particleCursor + 1) % PARTICLE_POOL;
        if (!p.on) return p;
    }
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % PARTICLE_POOL;
    return p;
}

function spawnSmoke() {
    if (reducedMotion()) return;
    const n = qualityLevel === 'low' ? 1 : 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
        const p = nextParticle();
        p.on = true;
        p.x = dog.x;
        p.y = dog.y + dog.height / 2 + (Math.random() * 10 - 5);
        p.size = 4 + Math.random() * 6;
        p.vx = -180 + Math.random() * 120;
        p.vy = -60 + Math.random() * 120;
        p.g = 0;
        p.life = 1;
        p.decay = 3;
        p.color = SMOKE_COLORS[(Math.random() * SMOKE_COLORS.length) | 0];
    }
}

function spawnBurst(x, y, count, o) {
    if (reducedMotion()) return;
    if (qualityLevel === 'low') count = Math.ceil(count / 2);
    const colors = o.colors || BURST_COLORS;
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (o.speed || 200) * (0.35 + Math.random() * 0.65);
        const p = nextParticle();
        p.on = true;
        p.x = x;
        p.y = y;
        p.size = 3 + Math.random() * (o.size || 4);
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp - (o.lift || 0);
        p.g = o.gravity || 0;
        p.life = 1;
        p.decay = o.decay || 2.2;
        p.color = colors[(Math.random() * colors.length) | 0];
    }
}

function updateParticles(dt) {
    for (let i = 0; i < PARTICLE_POOL; i++) {
        const p = particles[i];
        if (!p.on) continue;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= p.decay * dt;
        if (p.life <= 0) p.on = false;
    }
}

function addFloater(x, y, text, big) {
    if (reducedMotion()) return;
    const f = floaters[floaterCursor];
    floaterCursor = (floaterCursor + 1) % FLOATER_POOL;
    f.on = true; f.x = x; f.y = y; f.text = text; f.life = 1.2; f.big = !!big;
}

function updateFloaters(dt) {
    for (let i = 0; i < FLOATER_POOL; i++) {
        const f = floaters[i];
        if (!f.on) continue;
        f.y -= 46 * dt;
        f.life -= 1.6 * dt;
        if (f.life <= 0) f.on = false;
    }
}

function hasVisualFx() {
    for (let i = 0; i < PARTICLE_POOL; i++) if (particles[i].on) return true;
    for (let i = 0; i < FLOATER_POOL; i++) if (floaters[i].on) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawParticles() {
    let lastBucket = -1;
    for (let i = 0; i < PARTICLE_POOL; i++) {
        const p = particles[i];
        if (!p.on) continue;
        const bucket = Math.max(0, Math.min(10, Math.floor(p.life * 10)));
        if (bucket !== lastBucket) { ctx.globalAlpha = bucket / 10; lastBucket = bucket; }
        ctx.fillStyle = p.color;
        const s = Math.floor(p.size);
        ctx.fillRect(Math.floor(p.x), Math.floor(p.y), s, s);
    }
    ctx.globalAlpha = 1;
}

function drawFloaters() {
    let any = false;
    for (let i = 0; i < FLOATER_POOL; i++) if (floaters[i].on) { any = true; break; }
    if (!any) return;
    ctx.textAlign = 'center';
    for (let i = 0; i < FLOATER_POOL; i++) {
        const f = floaters[i];
        if (!f.on) continue;
        const t = Math.min(1, f.life);
        const s = (f.big ? 1.25 : 1) * (1 + Math.max(0, f.life - 0.8) * 1.2);
        ctx.font = '14px PressStart2P, monospace';
        ctx.globalAlpha = t;
        ctx.setTransform(currentDpr * s, 0, 0, currentDpr * s, f.x * currentDpr, f.y * currentDpr);
        ctx.fillStyle = '#04060A';
        ctx.fillText(f.text, 2, 2);
        ctx.fillStyle = f.big ? '#FFFFFF' : CYAN;
        ctx.fillText(f.text, 0, 0);
    }
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    ctx.globalAlpha = 1;
}

function drawDog(alpha) {
    const sprite = spriteCache[selectedCharacter];
    if (!sprite) return;
    const x = dog.px + (dog.x - dog.px) * alpha;
    const y = dog.py + (dog.y - dog.py) * alpha;
    const rot = dog.prevRotation + (dog.rotation - dog.prevRotation) * alpha;
    const cx = x + dog.width / 2, cy = y + dog.height / 2;

    if (!gameOver && qualityLevel !== 'low' && !reducedMotion() && trailCount > 3) {
        // soft halo
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(ensureGlowSprite(), cx - 40, cy - 40, 80, 80);
        ctx.globalCompositeOperation = 'source-over';
        // afterimages, oldest first, every 4th recorded step
        for (let k = trailCount - 1; k > 0; k -= 4) {
            const idx = (trailHead - 1 - k + TRAIL_LEN * 2) % TRAIL_LEN;
            ctx.globalAlpha = (1 - k / TRAIL_LEN) * 0.22;
            ctx.drawImage(sprite, Math.round(trail[idx * 2]), Math.round(trail[idx * 2 + 1]), dog.width, dog.height);
        }
        ctx.globalAlpha = 1;
    }

    // Idle-hover wobble near the apex of a flap
    const wob = (Math.abs(dog.velocity) < 50 && !gameOver) ? Math.sin(dog.bob) * 1.5 : 0;

    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(dog.scaleX, dog.scaleY);
    ctx.drawImage(sprite, -dog.width / 2, -dog.height / 2 + wob, dog.width, dog.height);
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
}

// alpha: sim interpolation factor; frameDt: real seconds since the last drawn frame
function drawFrame(alpha, frameDt, nowMs) {
    ensureSpriteCache();
    const playing = isPlaying();
    const state = playing ? 'play' : (gameOver || paused ? 'frozen' : (reducedMotion() ? 'frozen' : 'idle'));
    advanceScenery(frameDt, state);
    ambient.update(frameDt, playing, isDarkMode);

    drawBackground(nowMs);
    ambient.draw(ctx, isDarkMode);
    drawPipes(alpha);
    drawGround();
    drawParticles();

    if (gameStarted) drawDog(alpha);
    drawFloaters();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function sampleFrame(ms) {
    frameSamples[frameSampleIdx] = ms;
    frameSampleIdx = (frameSampleIdx + 1) % frameSamples.length;
    if (frameSampleFill < frameSamples.length) { frameSampleFill++; return; }
    let sum = 0;
    for (let i = 0; i < frameSamples.length; i++) sum += frameSamples[i];
    const avg = sum / frameSamples.length;
    // Judged against a 60 Hz baseline: high-refresh screens report smaller values
    qualityLevel = avg > 24 ? 'low' : avg > 19 ? 'medium' : 'high';
}

function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (document.hidden) return;

    const running = isPlaying();
    const dying = gameStarted && gameOver;

    // Idle screens: ~30 fps unless something is animating
    if (!running && !dying && !hasVisualFx() && ts - lastRenderTs < 32) return;

    let dt = (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;
    if (!(dt > 0)) return;
    if (dt > MAX_FRAME_DELTA_SECONDS) dt = MAX_FRAME_DELTA_SECONDS;

    const drawDt = (ts - lastRenderTs) / 1000;
    lastRenderTs = ts;
    if (running) sampleFrame(dt * 1000);

    let alpha = 1;
    if (running || dying) {
        accumulator += dt;
        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
            step(STEP);
            accumulator -= STEP;
            steps++;
            if (!isPlaying() && !gameOver) break;
        }
        if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
        alpha = accumulator / STEP;
    }

    // Visual-only systems run on real frame time
    updateParticles(dt);
    updateFloaters(dt);

    drawFrame(alpha, Math.min(drawDt, MAX_FRAME_DELTA_SECONDS), ts);
}

window.addEventListener('load', init);

// ---------------------------------------------------------------------------
// Globals other scripts rely on
// ---------------------------------------------------------------------------
window.startGame = startGame;
window.resetGame = resetGame;
window.flap = flap;
Object.defineProperty(window, 'gameStarted', { get: () => gameStarted });
Object.defineProperty(window, 'gameOver', { get: () => gameOver });
Object.defineProperty(window, 'selectedCharacter', {
    get: () => selectedCharacter,
    set: (v) => { selectedCharacter = v; }
});
// Read-only introspection for tests and debugging
window.__flattenhund = {
    get score() { return score; },
    get combo() { return combo; },
    get quality() { return qualityLevel; },
    get pipes() { return pipes.length; },
    get dpr() { return currentDpr; },
    get paused() { return paused; },
    get state() { return !gameStarted ? 'menu' : gameOver ? 'dead' : paused ? 'paused' : 'play'; },
    get dogY() { return dog.y + dog.height / 2; },
    get gapY() {
        for (let i = 0; i < pipes.length; i++) {
            const p = pipes[i];
            if (p.x + p.width > dog.x) return p.top.height + (p.bottom.y - p.top.height) / 2;
        }
        return null;
    }
};

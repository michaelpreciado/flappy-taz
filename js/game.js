// Main game file for Flappy Mario
// This file handles the game initialization, loop, and core mechanics

// Game constants: all speed/acceleration values are in units per second (pixels/sec or pixels/sec^2)
// Target FPS for conversion baseline was 60 FPS.

const GRAVITY_ACCEL = 0.25 * 60 * 60; // Reduced gravity for more floaty feel (900 px/sec^2)
const FLAP_VELOCITY_SET = -5.5 * 60; // Slightly reduced flap strength (-330 px/sec)
const PIPE_SPEED_PPS = 3.1 * 60;     // (3.1 px/frame * 60 frames/sec) = 186 px/sec (was 2.7)
const FORWARD_LEAP_VEL_CHANGE_PPS = 0.6 * 60; // Reduced forward impulse for smoother movement (36 px/sec)
const MAX_FORWARD_SPEED_PPS = 2.0 * 60;   // Reduced max speed for better control (120 px/sec)
const FORWARD_DRAG_FACTOR = 0.97;    // Less drag for smoother horizontal movement

const FLOAT_DURATION_SECONDS = 18 / 60; // Slightly longer float duration (0.3 seconds)
const FLOAT_GRAVITY_MULTIPLIER = 0.6; // Even less gravity during float for better control

const PARTICLE_MIN_SPEED_X_PPS = -3 * 60; // -180 px/sec
const PARTICLE_MAX_SPEED_X_PPS = -1 * 60; // -60 px/sec
const PARTICLE_MIN_SPEED_Y_PPS = -1 * 60; // -60 px/sec
const PARTICLE_MAX_SPEED_Y_PPS = 1 * 60;  // 60 px/sec
const PARTICLE_LIFE_DECAY_PER_SEC = 0.05 * 60; // 3.0 units of life per second (assuming life is 1.0 initially)

const MARIO_ANIM_FPS = 0.2 * 60; // (0.2 anim_frames/game_frame * 60 game_frames/sec) = 12 animation frames/sec

// Game constants continue
const PIPE_SPAWN_INTERVAL = 2000; // Time between pipes (milliseconds) - (was 2200)
const PIPE_GAP = 170; // Reduced gap for harder gameplay (was 190)
const GROUND_HEIGHT = 120; // Taller ground section like in Flappy Bird
const MARIO_WIDTH = 48; // Increased character size
const MARIO_HEIGHT = 48; // Increased character size
const MAX_FRAME_DELTA_SECONDS = 1 / 15; // Clamp for stability after tab pauses

// Game variables
let canvas, ctx;
let mario = {
    x: 80,
    y: 300,
    width: MARIO_WIDTH,
    height: MARIO_HEIGHT,
    velocity: 0,      // Vertical velocity
    velocityX: 0,     // Horizontal velocity for smooth movement
    isFlapping: false,
    frameCount: 0,    // For animation frames
    animationFrameCount: 0, // Accumulator for animation frames
    floatTimer: 0,    // Timer for floating effect (in seconds)
    smoothRotation: 0, // Smoothly interpolated rotation value
    targetRotation: 0, // Target rotation for smoother interpolation
    holdTimer: 0,     // Timer for tracking how long input is held
    bobOffset: 0,     // For idle bobbing animation
    scaleX: 1,        // For sprite direction/animation effects
    scaleY: 1         // For subtle animation effects
};

// Game session tracking (SQLite backend)
let currentSession = null;

// Particle system for smoke trail
let particles = [];
let floaters = [];      // rising "+1" score pops
let trail = [];         // recent character positions for the glow trail
let glowSprite = null;  // pre-rendered radial glow, drawn additively

let pipes = [];
let ground = { y: 0 };
let score = 0;
let highScore = 0;
let gameStarted = false;
let gameOver = false;
let animationFrameId;
let lastTime = 0;
let pipeSpawnTimer = 0;
let currentDpr = 1;
let qualityLevel = 'high';
let frameTimeSampleMs = [];
const FRAME_SAMPLE_SIZE = 60;
let isPointerDown = false;

// 8-bit theme colors
const COLORS_8BIT = {
    sky: '#4EC0CA',
    ground: '#8CC453',
    dirt: '#DED895',
    pipe: '#74BF2E',
    pipeBorder: '#558022',
    scoreText: '#FFFFFF',
    scoreBox: '#000000'
};

// Assets
let marioSprite = new Image();
let tazSprite = new Image();
let chloeSprite = new Image();
let selectedCharacter = null; // 'taz' or 'chloe'
let pipeTopSprite = new Image();
let pipeBottomSprite = new Image();
let backgroundSprite = new Image();
let groundSprite = new Image();

// Sound contexts
let flapSoundContext;
let scoreSoundContext;
let hitSoundContext;
let gameOverSoundContext;

// DOM elements
let startScreen, gameOverScreen, scoreDisplay, finalScoreDisplay, highScoreDisplay;
let newHighScoreSplash, splashScoreElement; // Add splash screen elements
// Game DOM elements

// Dark mode support
let isDarkMode = false;

// Initialize the game
function init() {
    // Get DOM elements
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    startScreen = document.getElementById('start-screen');
    gameOverScreen = document.getElementById('game-over');
    scoreDisplay = document.getElementById('score');
    finalScoreDisplay = document.getElementById('final-score');
    highScoreDisplay = document.getElementById('high-score');
    
    // Get splash screen elements
    newHighScoreSplash = document.getElementById('new-high-score-splash');
    splashScoreElement = document.getElementById('splash-score');
    
    // Game initialization
    
    // Set initial canvas dimensions and add resize listener
    resizeCanvas(); // Initial size
    window.addEventListener('resize', resizeCanvas, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // For crisp pixel art rendering (will be set in resizeCanvas too)
    // ctx.imageSmoothingEnabled = false; // Moved to resizeCanvas
    
    // Initialize 8-bit audio system with reduced music
    if (window.eightBitAudio) {
        window.eightBitAudio.init();
        // Disable background music by default
        window.eightBitAudio.enableMusic(false);
    }
    
    // Ground position is set by resizeCanvas() in CSS pixels; recomputing it
    // here from canvas.height (device pixels) pushed the ground off-screen
    // on high-DPR displays.
    
    // Load high score from new persistent player data system
    // This will be updated by the leaderboard system when it loads
    // For now, just set to 0 and let leaderboard.js handle it
    highScore = 0;
    highScoreDisplay.textContent = highScore;
    
    // Load assets
    loadAssets();

    // Character selection logic
    const chooseTazBtn = document.getElementById('choose-taz');
    const chooseChloeBtn = document.getElementById('choose-chloe');
    const startBtn = document.getElementById('start-button');
    
    // Debug: Log if elements are found
    console.log('🎮 Character selection setup:', {
        chooseTazBtn: !!chooseTazBtn,
        chooseChloeBtn: !!chooseChloeBtn, 
        startBtn: !!startBtn
    });
    
    // Helper function to add both click and touch events for mobile compatibility
    function addButtonListener(element, handler) {
        if (!element) {
            console.error('❌ Cannot add listener to null element');
            return;
        }
        element.addEventListener('pointerup', (e) => {
            e.preventDefault();
            handler();
        });
    }
    
    addButtonListener(chooseTazBtn, () => {
        console.log('🐾 Taz selected');
        selectedCharacter = 'taz';
        chooseTazBtn.classList.add('selected');
        chooseChloeBtn.classList.remove('selected');
    });
    
    addButtonListener(chooseChloeBtn, () => {
        console.log('🐕 Chloe selected');
        selectedCharacter = 'chloe';
        chooseChloeBtn.classList.add('selected');
        chooseTazBtn.classList.remove('selected');
    });

    // Auto-select Taz by default
    if (!selectedCharacter && chooseTazBtn) {
        console.log('🔧 Auto-selecting Taz as default character');
        selectedCharacter = 'taz';
        chooseTazBtn.classList.add('selected');
    }

    // Event listeners - add both click and touch support for mobile
    addButtonListener(document.getElementById('start-button'), () => {
        console.log('🚀 Start button clicked, selectedCharacter:', selectedCharacter);
        // Auto-select Taz if no character selected
        if (!selectedCharacter) {
            console.log('🔧 Auto-selecting Taz since no character was chosen');
            selectedCharacter = 'taz';
        }
        startGame();
    });
    addButtonListener(document.getElementById('restart-button'), resetGame);
    
    // Input handlers
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
    canvas.addEventListener('pointerup', handlePointerUp, { passive: false });
    canvas.addEventListener('pointercancel', handlePointerUp, { passive: false });
    
    // Initial render
    render();
    
    // Check if dark mode is enabled
    isDarkMode = document.body.classList.contains('dark-mode');
    
    // Expose theme update function for dark-mode.js
    window.updateGameTheme = function(darkModeEnabled) {
        isDarkMode = darkModeEnabled;
        // The game loop only runs during play; repaint immediately so the
        // menu/game-over background switches theme too
        if (!gameStarted || gameOver) {
            render();
        }
    };
    
    // Initialize leaderboard system
    if (window.initializeLeaderboardSystem) {
        window.initializeLeaderboardSystem().catch(error => {
            console.warn('⚠️ Leaderboard initialization failed:', error);
        });
    }

    // Ambient background animation for the menu and game-over screens.
    // The main gameLoop renders during play; this keeps clouds drifting and
    // stars twinkling the rest of the time (cheap guard when playing).
    // Throttled to ~30fps on menus (the scene is slow-moving and sits behind
    // blurred glass); runs at full rate while death FX are still animating.
    let ambientLast = 0;
    requestAnimationFrame(function ambientLoop(now) {
        requestAnimationFrame(ambientLoop);
        if (gameStarted && !gameOver) return;
        const fxActive = gameOver && (particles.length > 0 || floaters.length > 0);
        if (!fxActive && now - ambientLast < 33) return;
        const dt = Math.min(MAX_FRAME_DELTA_SECONDS, (now - (ambientLast || now)) / 1000);
        ambientLast = now;
        if (fxActive) {
            updateParticles(dt);
            updateFloaters(dt);
        }
        render();
    });
}

// Function to handle canvas resizing
function resizeCanvas() {
    if (!canvas || !ctx) return;
    currentDpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = window.innerWidth;
    const cssHeight = window.innerHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.floor(cssWidth * currentDpr);
    canvas.height = Math.floor(cssHeight * currentDpr);
    ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
    
    // Update ground position
    ground.y = cssHeight - GROUND_HEIGHT;
    
    // Ensure crisp pixel art rendering after resize
    ctx.imageSmoothingEnabled = false;

    // If the game is over or not started, the main gameLoop isn't running render(),
    // so we might need to manually call render() here to update the static background elements.
    // However, if the game IS running, gameLoop will handle rendering.
    // For simplicity and to avoid potential double rendering issues if gameLoop is active,
    // we can just let the gameLoop handle it if active, or if not, just update static elements.
    // A simple render() call here should be okay as it redraws the current state.
    if (!gameStarted || gameOver) { 
        render(); // Redraw static elements or game over screen
    } 
    // If game is active, gameLoop will pick up the new dimensions in its next frame.
}

// Helper to get current character sprite
function getCurrentCharacterSprite() {
    if (selectedCharacter === 'taz') return tazSprite;
    if (selectedCharacter === 'chloe') return chloeSprite;
    return marioSprite;
}

// Helper to draw rounded rectangles (for score display)
function roundRect(ctx, x, y, width, height, radius, fill) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) {
        ctx.fill();
    } else {
        ctx.stroke();
    }
}

// Render background clouds - strictly in background layer (STATIC VERSION)
function renderBackgroundClouds() {
    // Use a much lighter cloud color with very high transparency for subtle appearance
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    
    // STATIC CLOUDS - fixed positions, no movement or animation
    // These clouds are completely static and will never move or change
    
    // Cloud 1 (upper left corner) - fixed position
    drawStaticPixelCloud(40, 40, 100, 50);
    
    // Cloud 2 (upper middle area) - fixed position
    drawStaticPixelCloud(canvas.width/2 - 80, 60, 120, 60);
    
    // Cloud 3 (upper right) - fixed position
    drawStaticPixelCloud(canvas.width - 140, 50, 100, 50);
}

// Draw the city skyline silhouette in the background
function drawCitySilhouette(baseY) {
    ctx.fillStyle = '#DEECF0'; // Very light color for buildings to match reference
    
    // Draw a series of buildings with different heights - wider buildings
    const buildingWidths = [42, 28, 56, 35, 49, 28, 35, 42, 56, 28, 49, 42, 35];
    // Fixed building heights to remove randomness
    const buildingHeights = [40, 30, 50, 35, 45, 25, 38, 42, 52, 28, 48, 40, 32];
    let xPos = 0;
    
    for (let i = 0; i < buildingWidths.length; i++) {
        const width = buildingWidths[i];
        const height = buildingHeights[i]; // Use fixed heights instead of random
        
        // Building
        ctx.fillRect(xPos, baseY - height, width, height);
        
        // Some buildings have small "windows" - now deterministic
        if (i % 2 === 0) { // Every other building has windows
            ctx.fillStyle = '#D0E0E8'; // Slightly darker color for windows but still very light
            const windowSize = 3;
            const windowY = baseY - height + 5;
            const windowX = xPos + width/2 - windowSize/2;
            ctx.fillRect(windowX, windowY, windowSize, windowSize);
            ctx.fillRect(windowX - 6, windowY + 6, windowSize, windowSize);
            ctx.fillRect(windowX + 6, windowY + 6, windowSize, windowSize);
            ctx.fillStyle = '#DEECF0'; // Back to building color
        }
        
        xPos += width;
        // If we reached the end of the screen, go back to beginning
        if (xPos > canvas.width) xPos = 0;
    }
}

// Helper to draw a single STATIC pixelated cloud (no animation)
function drawStaticPixelCloud(x, y, width, height) {
    // Cloud color is now set in the parent function to ensure consistency
    
    // Main cloud body - completely static, no movement
    ctx.fillRect(x, y, width, height);
    
    // Cloud bumps on top (pixelated look) - fixed positions
    // These bumps are in fixed positions and will never change
    ctx.fillRect(x - 15, y + 15, 22, 22);
    ctx.fillRect(x + width/4, y - 15, 30, 30);
    ctx.fillRect(x + width/2, y - 8, 22, 22);
    ctx.fillRect(x + width - 22, y + 8, 30, 30);
}

// Load game assets
function loadAssets() {
    // Character sprites
    tazSprite.src = 'assets/images/taz.png';
    chloeSprite.src = 'assets/images/chloe.png';
    // Default (legacy) Mario sprite for fallback
    marioSprite.src = 'assets/images/mario.png';
    
    // Add event listeners to process sprites when they load
    tazSprite.onload = () => processSprite(tazSprite);
    chloeSprite.onload = () => processSprite(chloeSprite);
    marioSprite.onload = () => processSprite(marioSprite);
    
    // Environment
    // Pipes, ground and background are drawn procedurally (drawing-functions.js);
    // the old full-size PNGs were downloaded but never used, so they are no
    // longer loaded.
    // Sound functions are loaded from sounds.js
    // No need to preload as they're generated on demand
}

// Function to remove white background from sprites
function processSprite(img) {
    // PERFORMANCE OPTIMIZATION: Skip expensive pixel processing
    // Most modern browsers handle transparent PNGs well without manual processing
    // Only do basic processing if absolutely necessary
    
    try {
        // Just log that the sprite is ready - no expensive processing
        console.log('✅ Sprite loaded and ready:', img.src.split('/').pop());
        
        // If you really need to remove white backgrounds, do it much more efficiently:
        // 1. Use CSS mix-blend-mode instead of pixel manipulation
        // 2. Or prepare the images beforehand
        // 3. Or use a much more optimized algorithm
        
    } catch (error) {
        console.warn('⚠️ Could not load sprite:', error);
    }
}

// Start the game
async function startGame() {
    // PERFORMANCE OPTIMIZATION: Removed console.log statements for better performance
    // Default to Taz if none selected (should not happen)
    if (!selectedCharacter) selectedCharacter = 'taz';
    
    gameStarted = true;
    gameOver = false;
    startScreen.style.display = 'none';
    gameOverScreen.style.display = 'none';
    score = 0;
    updateScore();
    
    // Game start setup
    
    // Create a new game session in the database if available
    try {
        if (window.gameDB) {
            currentSession = await window.gameDB.createGameSession(
                selectedCharacter,
                isDarkMode
            );
        }
    } catch (err) {
        console.error('Error creating game session:', err);
    }
    
    // Only play sound effects, no continuous background music
    // Theme music is disabled by default
    
    // Reset mario position with a better head start
    mario.y = 230; // Start even higher in the air
    mario.velocity = -3.0 * 60; // Stronger initial upward velocity (-180 px/sec)
    mario.velocityX = 0.5 * 60; // Small initial forward momentum (30 px/sec)
    mario.x = 80; // Reset X position
    mario.floatTimer = FLOAT_DURATION_SECONDS * 1.33; // Start with float timer active (a bit more than one flap's worth)
    mario.smoothRotation = 0; // Reset rotation
    mario.targetRotation = 0; // Reset target rotation
    mario.animationFrameCount = 0;
    mario.bobOffset = 0; // Reset bobbing animation
    mario.scaleX = 1; // Reset scale
    mario.scaleY = 1; // Reset scale
    
    // Clear pipes
    pipes = [];
    particles = [];
    floaters = [];
    trail = [];
    pipeSpawnTimer = PIPE_SPAWN_INTERVAL * 0.35;
    frameTimeSampleMs = [];
    qualityLevel = 'high';
    
    // Start game loop
    lastTime = performance.now(); // Initialize lastTime for deltaTime calculation
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    document.dispatchEvent(new CustomEvent('game:start'));
    gameLoop();
}

// Reset the game
function resetGame() {
    // Reset player variables before starting
    mario.velocity = 0;
    mario.velocityX = 0;
    mario.rotation = 0;
    mario.smoothRotation = 0;
    mario.targetRotation = 0;
    mario.x = 80;
    mario.floatTimer = 0;
    mario.bobOffset = 0;
    mario.scaleX = 1;
    mario.scaleY = 1;
    mario.animationFrameCount = 0;
    mario.holdTimer = 0;
    // Reset player properties
    
    // Reset canvas effects
    canvas.style.filter = 'none';
    canvas.style.transition = 'none';
    
    // Reset container effects
    const gameContainer = document.querySelector('.game-container');
    gameContainer.style.boxShadow = 'none';
    
    // Prepare game restart
    
    startGame();
}

// Game loop
function gameLoop() {
    const currentTime = performance.now();
    const deltaTime = Math.min(MAX_FRAME_DELTA_SECONDS, (currentTime - lastTime) / 1000);
    lastTime = currentTime;
    trackFrameTime(deltaTime);

    update(deltaTime);
    render();
    
    if (!gameOver) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

// Make mario flap with floatier physics and smooth forward movement
function flap() {
    // Add slight anticipation animation before flap
    mario.scaleY = 0.9; // Brief squash for anticipation
    mario.scaleX = 1.05; // Slight stretch
    
    // Set vertical velocity and activate float timer
    mario.velocity = FLAP_VELOCITY_SET;
    mario.isFlapping = true;
    mario.floatTimer = FLOAT_DURATION_SECONDS; // Set float timer (in seconds)
    
    // Add forward velocity impulse (reduced for smoother movement)
    mario.velocityX += FORWARD_LEAP_VEL_CHANGE_PPS;
    
    // Cap maximum forward speed
    if (mario.velocityX > MAX_FORWARD_SPEED_PPS) {
        mario.velocityX = MAX_FORWARD_SPEED_PPS;
    }
    if (mario.velocityX < -MAX_FORWARD_SPEED_PPS) { // Cap negative speed too if character can move backward
        mario.velocityX = -MAX_FORWARD_SPEED_PPS;
    }

    // Add immediate visual feedback - rotation anticipation
    mario.targetRotation = -0.2; // Brief upward tilt for better feedback
    
    // Reset animation counters for responsive feel
    mario.animationFrameCount = 0;
    
    // Create smoke particles immediately upon flapping
    // The createSmokeTrail() call was already in update() based on mario.isFlapping, that's fine.
    
    // Reset flap count (if mario.flapCount is used elsewhere, seems it's not fully implemented yet)
    // setTimeout(() => {
    //     mario.flapCount = 0; 
    // }, 500);
    
    // Use 8-bit audio if available
    if (window.eightBitAudio) {
        window.eightBitAudio.playJumpSound();
    } else {
        flapSoundContext = window.gameSounds.flap();
    }
}

// Update particles (smoke, sparks, death shards)
function updateParticles(deltaTime) {
    const MAX_PARTICLES = (qualityLevel === 'low' ? 8 : qualityLevel === 'medium' ? 14 : 20) + 28;

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        if (p.g) p.speedY_pps += p.g * deltaTime;
        p.x += p.speedX_pps * deltaTime;
        p.y += p.speedY_pps * deltaTime;

        p.life -= (p.decay || PARTICLE_LIFE_DECAY_PER_SEC) * deltaTime;
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }

    if (particles.length > MAX_PARTICLES) {
        particles.splice(0, particles.length - MAX_PARTICLES);
    }
}

// Create smoke trail particles when character jumps (cyan-tinted puffs)
const SMOKE_COLORS = ['#FFFFFF', '#CFF7FC', '#5CE1F2'];
function createSmokeTrail() {
    const numParticles = qualityLevel === 'low' ? 1 : 2 + Math.floor(Math.random() * 2);

    for (let i = 0; i < numParticles; i++) {
        particles.push({
            x: mario.x,
            y: mario.y + mario.height/2 + (Math.random() * 10 - 5),
            size: 4 + Math.random() * 6,
            speedX_pps: PARTICLE_MIN_SPEED_X_PPS + Math.random() * (PARTICLE_MAX_SPEED_X_PPS - PARTICLE_MIN_SPEED_X_PPS),
            speedY_pps: PARTICLE_MIN_SPEED_Y_PPS + Math.random() * (PARTICLE_MAX_SPEED_Y_PPS - PARTICLE_MIN_SPEED_Y_PPS),
            life: 1.0,
            color: SMOKE_COLORS[(Math.random() * SMOKE_COLORS.length) | 0]
        });
    }
}

// Radial burst of square sparks (score pickup, death)
function spawnBurst(x, y, count, opts) {
    if (qualityLevel === 'low') count = Math.ceil(count / 2);
    const o = opts || {};
    const colors = o.colors || ['#FFFFFF', '#5CE1F2', '#6AA6FF'];
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (o.speed || 200) * (0.35 + Math.random() * 0.65);
        particles.push({
            x, y,
            size: 3 + Math.random() * (o.size || 4),
            speedX_pps: Math.cos(a) * sp,
            speedY_pps: Math.sin(a) * sp - (o.lift || 0),
            g: o.gravity || 0,
            decay: o.decay || 2.2,
            life: 1.0,
            color: colors[(Math.random() * colors.length) | 0]
        });
    }
}

function updateFloaters(deltaTime) {
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.y -= 46 * deltaTime;
        f.life -= 1.6 * deltaTime;
        if (f.life <= 0) floaters.splice(i, 1);
    }
}

function renderFloaters() {
    if (floaters.length === 0) return;
    ctx.save();
    ctx.font = '14px PressStart2P, monospace';
    ctx.textAlign = 'center';
    for (const f of floaters) {
        const t = Math.min(1, f.life);
        const s = 1 + (1 - t) * 0.0 + Math.max(0, f.life - 0.8) * 1.2; // pop in
        ctx.globalAlpha = t;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.scale(s, s);
        ctx.fillStyle = '#04060A';
        ctx.fillText(f.text, 2, 2);
        ctx.fillStyle = '#5CE1F2';
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
    }
    ctx.restore();
}

// Soft cyan halo, rendered once to an offscreen canvas and reused every frame
function ensureGlowSprite() {
    if (glowSprite) return glowSprite;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(48, 48, 2, 48, 48, 48);
    grad.addColorStop(0, 'rgba(92,225,242,0.55)');
    grad.addColorStop(0.45, 'rgba(92,225,242,0.16)');
    grad.addColorStop(1, 'rgba(92,225,242,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    glowSprite = c;
    return c;
}

// Render particles (cheap: fillRect only, alpha bucketed)
function renderParticles() {
    if (particles.length === 0) return; // Early exit if no particles

    let currentAlpha = -1;

    for (const p of particles) {
        const newAlpha = Math.max(0, Math.min(1, Math.floor(p.life * 10) / 10));
        if (Math.abs(currentAlpha - newAlpha) > 0.05) {
            ctx.globalAlpha = newAlpha;
            currentAlpha = newAlpha;
        }
        
        ctx.fillStyle = p.color;
        
        // Draw a pixelated square (no anti-aliasing)
        const size = Math.floor(p.size);  // Ensure whole pixel sizes
        const x = Math.floor(p.x);  // Ensure whole pixel positions
        const y = Math.floor(p.y);
        ctx.fillRect(x, y, size, size);
    }
    
    // Reset alpha once at the end
    ctx.globalAlpha = 1.0;
}

// Ghosted afterimages + halo behind the character while it is moving
function recordTrail() {
    trail.push(mario.x, mario.y);
    if (trail.length > 10) trail.splice(0, 2);
}

function renderTrail(sprite) {
    if (qualityLevel === 'low' || trail.length < 4) return;
    const n = trail.length / 2;
    // halo
    const glow = ensureGlowSprite();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glow, mario.x + mario.width / 2 - 40, mario.y + mario.height / 2 - 40, 80, 80);
    ctx.restore();
    // afterimages, oldest first
    for (let i = 0; i < n - 1; i += 2) {
        const k = (i + 1) / n;
        ctx.globalAlpha = k * 0.22;
        ctx.drawImage(sprite, Math.round(trail[i * 2]), Math.round(trail[i * 2 + 1]), mario.width, mario.height);
    }
    ctx.globalAlpha = 1;
}

// Update game state
function update(deltaTime) {
    if (!gameStarted || gameOver) return;
    
    // Update mario with floatier physics and forward leap
    
    // Simple hold timer tracking
    if (mario.holdTimer > 0) {
        mario.holdTimer++;
    }
    
    // Apply gravity
    let currentGravity = GRAVITY_ACCEL;
    if (mario.floatTimer > 0) {
        currentGravity *= FLOAT_GRAVITY_MULTIPLIER;
        mario.floatTimer -= deltaTime;
        if (mario.floatTimer < 0) mario.floatTimer = 0; // Ensure it doesn't go negative
    }
    mario.velocity += currentGravity * deltaTime;
    
    // Update character animation frame
    mario.animationFrameCount += MARIO_ANIM_FPS * deltaTime;
    
    // Add subtle idle bobbing animation for more life
    mario.bobOffset += deltaTime * 3; // Slow bobbing
    if (mario.bobOffset > Math.PI * 2) mario.bobOffset -= Math.PI * 2;
    
    if (mario.isFlapping) {
        // Create smoke particles when flapping
        createSmokeTrail();
        mario.isFlapping = false;
        
        // Add subtle scale effect on flap for more impact
        mario.scaleY = 1.1;
        mario.scaleX = 0.95;
    }
    
    // Smoothly return scale to normal
    mario.scaleX = mario.scaleX * 0.9 + 1.0 * 0.1;
    mario.scaleY = mario.scaleY * 0.9 + 1.0 * 0.1;
    
    // Apply vertical velocity to position
    mario.y += mario.velocity * deltaTime;
    
    // Apply horizontal velocity to position with gradual slowdown
    mario.x += mario.velocityX * deltaTime;
    // Apply drag: V_new = V_old * (DRAG_FACTOR_PER_FRAME ^ (TARGET_FPS * deltaTime))
    // This ensures drag is consistent regardless of frame rate.
    mario.velocityX *= Math.pow(FORWARD_DRAG_FACTOR, 60 * deltaTime);
    
    // Keep character within reasonable bounds (CSS pixel space)
    const minX = 40;
    const maxX = (canvas.width / currentDpr) / 3;
    if (mario.x < minX) {
        mario.x = minX;
        mario.velocityX = 0;
    } else if (mario.x > maxX) {
        mario.x = maxX;
        mario.velocityX = 0;
    }
    
    // Improved rotation system for more natural movement
    const velocityFactor = Math.max(-400, Math.min(400, mario.velocity));
    mario.targetRotation = (velocityFactor / 400) * 0.3; // More subtle rotation range
    
    // Much smoother rotation interpolation
    const rotationSpeed = 0.15; // Faster but still smooth
    mario.smoothRotation = mario.smoothRotation * (1 - rotationSpeed) + mario.targetRotation * rotationSpeed;
    
    // Clamp rotation to prevent excessive spinning
    mario.smoothRotation = Math.max(-0.4, Math.min(0.4, mario.smoothRotation));
    
    // Update sprite direction based on horizontal velocity
    if (mario.velocityX > 10) {
        mario.scaleX = mario.scaleX * 0.95 + 1.02 * 0.05; // Face slightly forward when moving fast
    } else if (mario.velocityX < -10) {
        mario.scaleX = mario.scaleX * 0.95 + 0.98 * 0.05; // Face slightly backward when moving back
    }
    
    // Check for collisions with ground
    if (mario.y + mario.height > ground.y) {
        mario.y = ground.y - mario.height;
        gameEnd();
    }
    
    // Check for collisions with ceiling
    if (mario.y < 0) {
        mario.y = 0;
        mario.velocity = 0;
    }
    
    // Spawn pipes
    pipeSpawnTimer += deltaTime * 1000;
    if (pipeSpawnTimer >= PIPE_SPAWN_INTERVAL) {
        spawnPipe();
        pipeSpawnTimer = 0;
    }
    
    // Update pipes
    for (let i = pipes.length - 1; i >= 0; i--) {
        const pipe = pipes[i];
        pipe.x -= PIPE_SPEED_PPS * deltaTime;
        
        // Check if pipe is off screen
        if (pipe.x + pipe.width < 0) {
            pipes.splice(i, 1);
            continue;
        }
        
        // Check for collisions with pipes or if player tries to go around (force them through the gap)
        if (checkCollision(mario, pipe.top) || checkCollision(mario, pipe.bottom) || 
            // Check if player tries to fly over or under the pipes when they're in range
            (mario.x + mario.width > pipe.x && mario.x < pipe.x + pipe.width && 
             (mario.y < pipe.top.y + pipe.top.height || mario.y + mario.height > pipe.bottom.y))) {
            gameEnd();
        }
        
        // Check if mario passed the pipe
        if (!pipe.passed && mario.x > pipe.x + pipe.width) {
            pipe.passed = true;
            score++;
            updateScore();
            // Juice: spark burst in the gap + rising +1
            const gapY = pipe.top.height + (pipe.bottom.y - pipe.top.height) / 2;
            spawnBurst(pipe.x + pipe.width, gapY, 12, { speed: 190, gravity: 240, decay: 1.9 });
            floaters.push({ x: mario.x + mario.width / 2, y: mario.y - 6, text: '+1', life: 1.2 });
            document.dispatchEvent(new CustomEvent('game:score', { detail: { score } }));
            
            // Use 8-bit audio if available
            if (window.eightBitAudio) {
                window.eightBitAudio.playScoreSound();
            } else {
                scoreSoundContext = window.gameSounds.score();
            }
        }
    }
    
    recordTrail();
    updateParticles(deltaTime);
    updateFloaters(deltaTime);
}

// Render game
function render() {
    // PERFORMANCE OPTIMIZATION: Use fillRect for clearing (faster than clearRect)
    ctx.fillStyle = isDarkMode ? '#0F0F0F' : '#87CEEB'; // Sky color
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw the background
    drawBackground();
    
    // Draw pipes
    drawPipes();

    // Draw the ground (textured, scrolls with the world)
    drawGround();

    // Render smoke trail particles behind character
    renderParticles();

    // On the start menu the character hasn't launched yet - don't draw the
    // sprite floating over the menu text
    if (!gameStarted && !gameOver) {
        return;
    }

    // PERFORMANCE OPTIMIZATION: Streamlined character rendering
    const charSprite = getCurrentCharacterSprite();

    if (!gameOver) renderTrail(charSprite);

    ctx.save();
    
    // Move to character position and apply rotation
    ctx.translate(mario.x + mario.width / 2, mario.y + mario.height / 2);
    ctx.rotate(mario.smoothRotation);
    
    // Apply scaling for more dynamic animation
    ctx.scale(mario.scaleX, mario.scaleY);
    
    // Calculate combined animation effects
    let animationOffset = 0;
    
    // Flap bounce effect (more responsive)
    if (mario.isFlapping) {
        animationOffset += Math.sin(mario.animationFrameCount * 3) * 2;
    }
    
    // Subtle idle bobbing when not flapping actively
    if (mario.velocity > -50 && mario.velocity < 50) {
        animationOffset += Math.sin(mario.bobOffset) * 1.5;
    }
    
    // Add slight vertical offset when moving fast horizontally
    if (Math.abs(mario.velocityX) > 20) {
        animationOffset += Math.sin(mario.animationFrameCount * 1.5) * 0.5;
    }
    
    // Draw character with combined animation effects
    ctx.drawImage(charSprite, 
        -mario.width / 2, 
        -mario.height / 2 + animationOffset, 
        mario.width, 
        mario.height
    );
    
    ctx.restore();

    renderFloaters();

    // The score HUD is a DOM element (.score-display); no canvas score box
    // needed here — drawing both stacked two boxes on top of each other.
}

// Spawn a new pipe
function spawnPipe() {
    // IMPORTANT: all gameplay geometry is in CSS pixels (the ctx transform
    // maps CSS px -> device px). canvas.width/height are device pixels, so
    // using them here put pipe gaps below the ground on high-DPR phones.
    const viewWidth = canvas.width / currentDpr;
    const viewHeight = canvas.height / currentDpr;

    // Progressive difficulty: a generous gap for the first pipes that
    // tightens to PIPE_GAP by ~10 points
    const gap = PIPE_GAP + Math.max(0, 60 - score * 6);

    const pipeWidth = 90; // Wider pipes for better visibility
    const minHeight = 80; // Taller minimum pipe height
    const maxHeight = viewHeight - gap - minHeight - GROUND_HEIGHT;
    const topHeight = Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;
    const bottomY = topHeight + gap;

    pipes.push({
        x: viewWidth,
        width: pipeWidth,
        top: {
            y: 0,
            height: topHeight,
            width: pipeWidth
        },
        bottom: {
            y: bottomY,
            height: viewHeight - bottomY,
            width: pipeWidth
        },
        passed: false
    });
}

// Check collision between two rectangles
function checkCollision(rect1, rect2) {
    return (
        rect1.x < rect2.x + rect2.width &&
        rect1.x + rect1.width > rect2.x &&
        rect1.y < rect2.y + rect2.height &&
        rect1.y + rect1.height > rect2.y
    );
}

// End the game with GTA-style WASTED effect
async function gameEnd() {
    if (gameOver) return; // several collisions can land in the same frame
    gameOver = true;
    trail.length = 0;
    // Impact: shards + shake + flash
    spawnBurst(mario.x + mario.width / 2, mario.y + mario.height / 2, 26,
        { speed: 300, gravity: 620, lift: 90, size: 5, decay: 1.1, colors: ['#FFFFFF', '#5CE1F2', '#6AA6FF', '#FF5A6A'] });
    if (window.fx) { window.fx.shake(11, 380); window.fx.flash(); }
    document.dispatchEvent(new CustomEvent('game:over', { detail: { score } }));
    
    // Check for new high score BEFORE any effects
    const isNewHighScore = score > highScore;
    
    if (isNewHighScore) {
        // NEW HIGH SCORE! Show the splash screen first
        console.log('🎉 NEW HIGH SCORE DETECTED!', score, 'vs previous', highScore);
        
        // Update high score immediately
        highScore = score;
        
        // Show the splash screen
        showNewHighScoreSplash(score);
        
        // Play special high score sound
        if (window.eightBitAudio) {
            window.eightBitAudio.playHighScoreSound();
        }
        
        // Wait for splash screen to finish, then continue with normal game over
        setTimeout(() => {
            continueGameEnd();
        }, 3000); // Show splash for 3 seconds
        
    } else {
        // No new high score, proceed with normal game over immediately
        continueGameEnd();
    }
}

// Continue with the normal game over sequence
async function continueGameEnd() {
    // Apply GTA-style effects
    applyWastedEffect();
    
    // Use 8-bit audio if available
    if (window.eightBitAudio) {
        window.eightBitAudio.playHitSound();
        setTimeout(() => {
            window.eightBitAudio.playGameOverSound();
        }, 500);
    } else {
        hitSoundContext = window.gameSounds.hit();
        setTimeout(() => {
            gameOverSoundContext = window.gameSounds.gameOver();
        }, 500);
    }
    
    // Update high score using new persistent player data system
    // The leaderboard system now handles all score tracking
    // Just update the display with player's highest score
    const playerData = window.leaderboardDebug ? window.leaderboardDebug.getPlayerData() : null;
    if (playerData && playerData.highestScore > highScore) {
        highScore = playerData.highestScore;
    } else if (score > highScore) {
        highScore = score;
    }
    
    // Update game session in the database if available
    try {
        if (window.gameDB && currentSession) {
            await window.gameDB.updateGameSession(
                currentSession.id,
                score,
                mario.boostUsedCount
            );
        }
    } catch (err) {
        console.error('Error updating game session:', err);
    }
    
    // Update DOM elements
    finalScoreDisplay.textContent = score;
    highScoreDisplay.textContent = highScore;
    
    // Check for high score and prompt for nickname if needed
    if (window.checkAndPromptForPersonalBest) {
        window.checkAndPromptForPersonalBest(score);
    }
    
    // Show game over screen immediately but keep the slow reveal animation
    gameOverScreen.style.display = 'flex';
}

// Show the NEW HIGH SCORE splash screen
function showNewHighScoreSplash(newScore) {
    if (newHighScoreSplash && splashScoreElement) {
        // Update the score display
        splashScoreElement.textContent = newScore;
        
        // Show the splash screen with animation
        newHighScoreSplash.classList.add('show');
        newHighScoreSplash.style.display = 'flex';
        
        console.log('✨ NEW HIGH SCORE splash screen displayed!');
        
        // Auto-hide after animation completes
        setTimeout(() => {
            newHighScoreSplash.classList.remove('show');
            newHighScoreSplash.style.display = 'none';
        }, 3000);
    } else {
        console.warn('⚠️ Splash screen elements not found');
    }
}

// Update score display
function updateScore() {
    scoreDisplay.textContent = score;

    // Pop the HUD pill (CSS keyframe; restarted by toggling the class)
    scoreDisplay.classList.remove('pop');
    void scoreDisplay.offsetWidth;
    if (score > 0) scoreDisplay.classList.add('pop');
}

// Apply GTA-style WASTED effect
function applyWastedEffect() {
    // Create a desaturation filter on the canvas
    canvas.style.transition = 'all 1.5s ease-in-out';
    canvas.style.filter = 'grayscale(80%) contrast(120%) brightness(70%)';
    
    // Add a red tint to simulate GTA effect
    const gameContainer = document.querySelector('.game-container');
    gameContainer.style.boxShadow = 'inset 0 0 100px rgba(255, 0, 0, 0.3)';
    
    // Slow down the game animation
    const slowMotionFrames = 15; // Number of frames to show slow motion
    let frameCount = 0;
    
    function slowMotionRender() {
        if (frameCount < slowMotionFrames && gameOver) {
            render(); // Render the game at a slower pace
            frameCount++;
            setTimeout(slowMotionRender, 100); // Slow down the frame rate
        }
    }
    
    slowMotionRender();
}

// Add a pixelated Game Over effect
function gameOverEffect() {
    // Flash the canvas briefly for game over effect
    canvas.style.filter = 'brightness(200%) contrast(200%)';
    setTimeout(() => {
        canvas.style.filter = 'none';
    }, 100);
}

// Input handlers
function handleKeyDown(e) {
    if ((e.code === 'Space' || e.code === 'ArrowUp') && !gameOver) {
        if (!gameStarted) {
            startGame();
        } else {
            flap();
            // Start tracking hold time
            mario.holdTimer = 1;
        }
    }
}

function handleKeyUp(e) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        // Reset hold timer when key is released
        mario.holdTimer = 0;
    }
}

function handleTouchStart(e) {
    e.preventDefault();
    if (!gameOver) {
        if (!gameStarted) {
            startGame();
        } else {
            flap();
            // Start tracking hold time
            mario.holdTimer = 1;
        }
    }
}

function handleTouchEnd(e) {
    e.preventDefault();
    // Reset hold timer when touch ends
    mario.holdTimer = 0;
}

function handleMouseDown(e) {
    if (!gameOver) {
        if (!gameStarted) {
            startGame();
        } else {
            flap();
            // Start tracking hold time
            mario.holdTimer = 1;
        }
    } else {
        resetGame();
    }
}

function handleMouseUp(e) {
    // Reset hold timer when mouse button is released
    mario.holdTimer = 0;
}

function handlePointerDown(e) {
    e.preventDefault();
    if (isPointerDown) return;
    isPointerDown = true;

    if (!gameOver) {
        if (!gameStarted) {
            startGame();
        } else {
            flap();
            mario.holdTimer = 1;
        }
    } else {
        resetGame();
    }
}

function handlePointerUp(e) {
    e.preventDefault();
    isPointerDown = false;
    mario.holdTimer = 0;
}

function handleVisibilityChange() {
    if (document.hidden) {
        lastTime = performance.now();
    }
}

function trackFrameTime(deltaTime) {
    const frameMs = deltaTime * 1000;
    frameTimeSampleMs.push(frameMs);
    if (frameTimeSampleMs.length > FRAME_SAMPLE_SIZE) frameTimeSampleMs.shift();
    if (frameTimeSampleMs.length < FRAME_SAMPLE_SIZE) return;

    const avgFrameMs = frameTimeSampleMs.reduce((sum, value) => sum + value, 0) / frameTimeSampleMs.length;
    if (avgFrameMs > 24) qualityLevel = 'low';
    else if (avgFrameMs > 19) qualityLevel = 'medium';
    else qualityLevel = 'high';
}

// Initialize the game when the page loads
window.addEventListener('load', init);

// ---------------------------------------------------------------------------
// Expose game controls & reactive state on the global `window` object
// This is required for helper scripts (like mobile-optimization.js) that
// expect these functions/flags to exist.
// ---------------------------------------------------------------------------
window.startGame = startGame;
window.resetGame = resetGame;
window.flap = flap;

// Keep the boolean flags in sync via accessors so reads/writes stay reactive.
Object.defineProperty(window, 'gameStarted', {
    get: () => gameStarted,
    set: (val) => { gameStarted = !!val; }
});

Object.defineProperty(window, 'gameOver', {
    get: () => gameOver,
    set: (val) => { gameOver = !!val; }
});

Object.defineProperty(window, 'selectedCharacter', {
    get: () => selectedCharacter,
    set: (val) => { selectedCharacter = val; }
});
// ---------------------------------------------------------------------------

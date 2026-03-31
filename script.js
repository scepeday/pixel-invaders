// get the canvas we draw on and the 2d context for drawing
var canvas = document.getElementById("game");
var ctx = canvas.getContext("2d");
// quick references to the HTML elements we update a lot
var ui = {
  score: document.getElementById("score"),
  lives: document.getElementById("lives"),
  startOverlay: document.getElementById("startOverlay"),
  gameOver: document.getElementById("gameOver"),
  pauseOverlay: document.getElementById("pauseOverlay"),
  startBtn: document.getElementById("startBtn"),
  restartBtn: document.getElementById("restartBtn"),
};

// every image file used in the game
var assetSources = {
  player: "./assets/space_ship.svg",
  invaderBlue: "./assets/invader_blue.svg",
  invaderPurple: "./assets/invader_purple.svg",
  invaderGreen: "./assets/invader_green.svg",
  bullet: "./assets/bullets.svg",
  invaderBullet: "./assets/invader_bullets.svg",
  boom: "./assets/Boom.svg",
  background: "./assets/background_stars.svg",
};

// load all the images up front so drawing is smooth
var assets = {};
var assetsReady = false; 
var loaded = 0;
var assetKeys = Object.keys(assetSources);
for (var i = 0; i < assetKeys.length; i++) {
  var key = assetKeys[i];
  var img = new Image();
  img.src = assetSources[key];
  img.onload = function () {
    loaded = loaded + 1;
    if (loaded == assetKeys.length) {
      assetsReady = true;
    }
  };
  assets[key] = img;
}

// background tracks for gameplay and game over screen
var music = {
  game: new Audio("assets/Mercury.mp3"),
  gameOver: new Audio("assets/Game Over.mp3"),
};
music.game.loop = true;

// small sound effects that play during actions
var sfxSources = {
  shoot: "assets/shoot.wav",
  invaderKilled: "assets/invaderkilled.wav",
  explosion: "assets/explosion.wav",
};

var currentMusic = null;

// stop whatever is playing so tracks do not overlap
function stopAllMusic() {
  for (var song in music) {
    if (music[song]) music[song].pause();
  }
  currentMusic = null;
}

// choose a track and start it, resetting when needed
function playMusic(name, options) {
  if (!options) options = {};
  var reset = options.reset;
  var track = music[name];
  if (!track) {
    return;
  }
  if (currentMusic !== name) {
    stopAllMusic();
    track.currentTime = 0;
  } else {
    if (reset) {
      track.currentTime = 0;
    } else if (!track.paused) {
      return;
    }
  }
  var playPromise = track.play();
  if (playPromise && playPromise.catch) {
    playPromise.catch(function () {});
  }
  currentMusic = name;
}

// quick helper to fire a sound effect
function playEffect(name) {
  var src = sfxSources[name];
  if (!src) return;
  var audio = new Audio(src);
  var tryPlay = audio.play();
  if (tryPlay && tryPlay.catch) {
    tryPlay.catch(function () {});
  }
}

// game settings: sizes, speeds and spacing
var config = {
  player: { width: 35, height: 30, speed: 5.0 },
  bullet: { width: 8, height: 18, speed: 6, cooldown: 320 },
  invader: { width: 35, height: 30, speed: 0.6, drop: 15, cols: 10, rows: 5 },
  enemyBullet: { width: 8, height: 18, speed: 4.0, cadence: 0.55 },
  bunker: { count: 4, cellSize: 5, top: 472 },
  padding: 30,
};

// track which keys are being held down
var keys = {
  left: false,
  right: false,
  shoot: false,
};

// everything that can change while playing lives inside state
var state = {
  player: { x: 0, y: 0, cooldownAt: 0, dead: false, explosionTimer: 0, respawnTimer: 0 },
  lastPlayerPosition: { x: 0, y: 0 },
  bullets: [],
  enemyBullets: [],
  invaders: [],
  bunkers: [],
  direction: 1,
  score: 0,
  lives: 3,
  maxLives: 3,
  wave: 1,
  gameOver: false,
  started: false,
  paused: false,
};

// move the player to the bottom center and clear any death timers
function resetPlayer() {
  state.player.x = canvas.width / 2 - config.player.width / 2;
  state.player.y = canvas.height - config.player.height - 32;
  state.player.dead = false;
  state.player.explosionTimer = 0;
  state.player.respawnTimer = 0;
  state.lastPlayerPosition = { x: state.player.x, y: state.player.y };
}


// create a grid of invaders for the current round
function spawnWave() {
  state.invaders = [];
  var cols = config.invader.cols;
  var rows = config.invader.rows;
  var width = config.invader.width;
  var height = config.invader.height;
  var startX = config.padding;
  var startY = config.padding + 16;
  var gapX = 12;
  var gapY = 12;

  var spriteRows = [
    { key: "invaderGreen", value: 40 },
    { key: "invaderPurple", value: 30 },
    { key: "invaderBlue", value: 20 },
    { key: "invaderBlue", value: 10 },
    { key: "invaderBlue", value: 10 },
  ];

  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < cols; col++) {
      var sprite = spriteRows[row % spriteRows.length];
      state.invaders.push({
        x: startX + col * (width + gapX),
        y: startY + row * (height + gapY),
        width: width,
        height: height,
        value: sprite.value,
        type: sprite.key,
      });
    }
  }
}

function bunkerPattern() {
  return [
    "0001111111111111000",
    "0011111111111111100",
    "0111111111111111110",
    "1111111111111111111",
    "1111111111111111111",
    "1111111111111111111",
    "1111111111111111111",
    "1111111000001111111",
    "1111110000000111111",
    "1111100000000011111",
    "1111000000000001111",
  ];
}

function buildBunkers() {
  var pattern = bunkerPattern();
  var rows = pattern.length;
  var cols = pattern[0].length;
  var width = cols * config.bunker.cellSize;
  var totalWidth = config.bunker.count * width;
  var gap = (canvas.width - config.padding * 2 - totalWidth) / (config.bunker.count - 1);
  state.bunkers = [];

  for (var index = 0; index < config.bunker.count; index++) {
    var cells = [];
    for (var row = 0; row < rows; row++) {
      var cellRow = [];
      for (var col = 0; col < cols; col++) {
        cellRow.push(pattern[row][col] === "1");
      }
      cells.push(cellRow);
    }
    state.bunkers.push({
      x: config.padding + index * (width + gap),
      y: config.bunker.top,
      width: width,
      height: rows * config.bunker.cellSize,
      cols: cols,
      rows: rows,
      cellSize: config.bunker.cellSize,
      cells: cells,
    });
  }
}

// start a brand new run
function resetGame() {
  state.score = 0;
  state.lives = state.maxLives;
  state.wave = 1;
  state.gameOver = false;
  state.started = false;
  state.paused = false;
  state.bullets = [];
  state.enemyBullets = [];
  state.direction = 1;
  resetPlayer();
  spawnWave();
  buildBunkers();
  updateHud();
  ui.pauseOverlay.classList.add("hidden");
  stopAllMusic();
}

function startGame() {
  ui.startOverlay.classList.add("hidden");
  state.started = true;
  lastTime = performance.now();
  setPaused(false);
  playMusic("game", { reset: true });
}

// handle what happens when the player gets hit
function loseLife() {
  if (state.player.dead) return;
  state.lastPlayerPosition = { x: state.player.x, y: state.player.y };
  state.lives = state.lives - 1;
  playEffect("explosion");
  state.player.dead = true;
  state.player.explosionTimer = 16;
  state.player.respawnTimer = 34;
  state.bullets = [];
  state.enemyBullets = [];
  updateHud();
  if (state.lives <= 0) {
    state.gameOver = true;
    state.paused = false;
    ui.pauseOverlay.classList.add("hidden");
    ui.gameOver.classList.remove("hidden");
    playMusic("gameOver");
    return;
  }
}

// level up and spawn a fresh set of invaders
function nextWave() {
  state.wave = state.wave + 1;
  state.direction = 1;
  state.bullets = [];
  state.enemyBullets = [];
  // Keep bunker damage between waves so each level stays harder than the last.
  spawnWave();
  updateHud();
}

// reflect the latest score and lives on the screen
function updateHud() {
  ui.score.textContent = "SCORE - " + state.score + " PTS";
  ui.lives.innerHTML = "";
  for (var i = 0; i < state.maxLives; i++) {
    var span = document.createElement("span");
    span.className = "life-icon" + (i >= state.lives ? " life-icon--lost" : "");
    ui.lives.appendChild(span);
  }
}

// show/hide the pause overlay and stop music when needed
function setPaused(paused) {
  if (!state.started || state.gameOver) return;
  state.paused = paused;
  ui.pauseOverlay.classList.toggle("hidden", !paused);
  if (!paused) {
    lastTime = performance.now();
    if (currentMusic && music[currentMusic] && music[currentMusic].paused) {
      music[currentMusic].play().catch(function () {});
    }
  } else {
    if (currentMusic && music[currentMusic] && !music[currentMusic].paused) {
      music[currentMusic].pause();
    }
  }
}

// move the player and fire bullets based on pressed keys
function handleInput(dt, timestamp) {
  if (!state.started) return;
  if (state.paused || state.player.dead || state.gameOver) return;
  var player = state.player;
  var move = 0;
  if (keys.left) move = move - 1;
  if (keys.right) move = move + 1;

  player.x = player.x + move * config.player.speed * dt;
  var maxX = canvas.width - config.player.width - config.padding;
  if (player.x < config.padding) {
    player.x = config.padding;
  }
  if (player.x > maxX) {
    player.x = maxX;
  }

  var readyToShoot = keys.shoot && timestamp > player.cooldownAt;
  if (readyToShoot && !state.gameOver) {
    player.cooldownAt = timestamp + config.bullet.cooldown;
    var newBullet = {};
    newBullet.x = player.x + config.player.width / 2 - config.bullet.width / 2;
    newBullet.y = player.y;
    newBullet.width = config.bullet.width;
    newBullet.height = config.bullet.height;
    state.bullets.push(newBullet);
    playEffect("shoot");
  }
  state.lastPlayerPosition = { x: player.x, y: player.y };
}

// slide the invader block side to side and drop down when they hit edges
function moveInvaders(dt) {
  if (state.invaders.length === 0) return;

  var speed = config.invader.speed + state.wave * 0.04;
  var dx = speed * state.direction * dt * 3;
  var minX = 1000000;
  var maxX = -1000000;
  for (var i = 0; i < state.invaders.length; i++) {
    var inv = state.invaders[i];
    if (inv.x < minX) minX = inv.x;
    if (inv.x + inv.width > maxX) maxX = inv.x + inv.width;
  }

  var hitRight = maxX + dx > canvas.width - config.padding;
  var hitLeft = minX + dx < config.padding;

  if (hitLeft || hitRight) {
    state.direction = state.direction * -1;
    for (var j = 0; j < state.invaders.length; j++) {
      state.invaders[j].y += config.invader.drop;
    }
  } else {
    for (var k = 0; k < state.invaders.length; k++) {
      state.invaders[k].x += dx;
    }
  }
}

// randomly pick an invader column and shoot a bullet downward
function maybeFireEnemy(timestamp) {
  if (state.invaders.length === 0) return;
  if (Math.random() > config.enemyBullet.cadence * 0.03) return;

  var col = Math.floor(Math.random() * config.invader.cols);
  var shooter = null;
  for (var i = 0; i < state.invaders.length; i++) {
    if (i % config.invader.cols === col) {
      if (!shooter || state.invaders[i].y > shooter.y) {
        shooter = state.invaders[i];
      }
    }
  }
  if (!shooter) {
    shooter = state.invaders[0];
  }
  var enemyShot = {};
  enemyShot.x = shooter.x + config.invader.width / 2 - config.enemyBullet.width / 2;
  enemyShot.y = shooter.y + config.invader.height;
  enemyShot.width = config.enemyBullet.width;
  enemyShot.height = config.enemyBullet.height;
  state.enemyBullets.push(enemyShot);
}

// move the player's bullets upward and remove the ones off screen
function updateBullets(dt) {
  var speed = config.bullet.speed * dt * 1;
  var bulletsLen = state.bullets.length;
  for (var i = 0; i < bulletsLen; i++) {
    var thisBullet = state.bullets[i];
    thisBullet.y -= speed;
  }
  var nextBullets = []; // manually copy so it's clearer for me
  for (var b = 0; b < bulletsLen; b++) {
    var bullet = state.bullets[b];
    if (bullet.y + bullet.height > 0) nextBullets.push(bullet);
  }
  state.bullets = nextBullets;
}

// move enemy bullets downward and keep only the visible ones
function updateEnemyBullets(dt) {
  var speed = config.enemyBullet.speed * dt * 1;
  var enemyLen = state.enemyBullets.length;
  for (var i = 0; i < enemyLen; i++) {
    var bullet = state.enemyBullets[i];
    bullet.y += speed;
  }
  var keep = []; // student-style copy
  for (var b = 0; b < enemyLen; b++) {
    var bullet = state.enemyBullets[b];
    if (bullet.y < canvas.height + bullet.height) keep.push(bullet);
  }
  state.enemyBullets = keep;
}

// simple AABB collision check
function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function damageBunker(bunker, impactX, impactY, fromEnemy) {
  var localX = impactX - bunker.x;
  var localY = impactY - bunker.y;
  var centerCol = Math.floor(localX / bunker.cellSize);
  var centerRow = Math.floor(localY / bunker.cellSize);
  var mask = fromEnemy
    ? [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0], [0, 0], [1, 0],
        [0, 1]
      ]
    : [
        [0, -1],
        [-1, 0], [0, 0], [1, 0],
        [-1, 1], [0, 1], [1, 1]
      ];

  for (var i = 0; i < mask.length; i++) {
    var col = centerCol + mask[i][0];
    var row = centerRow + mask[i][1];
    if (row < 0 || row >= bunker.rows || col < 0 || col >= bunker.cols) continue;
    bunker.cells[row][col] = false;
  }
}

function bulletHitsBunkers(bullet, fromEnemy) {
  for (var i = 0; i < state.bunkers.length; i++) {
    var bunker = state.bunkers[i];
    if (!rectsOverlap(bullet, bunker)) continue;

    var sampleX = bullet.x + bullet.width / 2;
    var sampleY = fromEnemy ? bullet.y + bullet.height : bullet.y;
    var localCol = Math.floor((sampleX - bunker.x) / bunker.cellSize);
    var localRow = Math.floor((sampleY - bunker.y) / bunker.cellSize);

    if (
      localRow < 0 ||
      localRow >= bunker.rows ||
      localCol < 0 ||
      localCol >= bunker.cols
    ) {
      continue;
    }

    if (!bunker.cells[localRow][localCol]) {
      continue;
    }

    damageBunker(bunker, sampleX, sampleY, fromEnemy);
    bullet.hit = true;
    return true;
  }
  return false;
}

function updateBunkerDamageFromInvaders() {
  for (var i = 0; i < state.invaders.length; i++) {
    var invader = state.invaders[i];
    for (var j = 0; j < state.bunkers.length; j++) {
      var bunker = state.bunkers[j];
      if (!rectsOverlap(invader, bunker)) continue;

      var startCol = Math.max(0, Math.floor((invader.x - bunker.x) / bunker.cellSize));
      var endCol = Math.min(
        bunker.cols - 1,
        Math.floor((invader.x + invader.width - bunker.x) / bunker.cellSize)
      );
      var startRow = Math.max(0, Math.floor((invader.y - bunker.y) / bunker.cellSize));
      var endRow = Math.min(
        bunker.rows - 1,
        Math.floor((invader.y + invader.height - bunker.y) / bunker.cellSize)
      );

      for (var row = startRow; row <= endRow; row++) {
        for (var col = startCol; col <= endCol; col++) {
          bunker.cells[row][col] = false;
        }
      }
    }
  }
}

// see if bullets hit invaders or the player, and whether invaders reached the bottom
function checkCollisions() {
  for (var i = 0; i < state.bullets.length; i++) {
    var bullet = state.bullets[i];
    if (bulletHitsBunkers(bullet, false)) continue;
    for (var j = 0; j < state.invaders.length; j++) {
      var invader = state.invaders[j];
      if (!invader.dead && rectsOverlap(bullet, invader)) {
        invader.dead = true;
        bullet.hit = true;
        state.score = state.score + invader.value;
        invader.exploding = 12;
        playEffect("invaderKilled");
      }
    }
  }

  var aliveInvaders = [];
  for (var a = 0; a < state.invaders.length; a++) {
    if (!state.invaders[a].dead) {
      aliveInvaders.push(state.invaders[a]);
    }
  }
  state.invaders = aliveInvaders;
  var flyingBullets = [];
  for (var n = 0; n < state.bullets.length; n++) {
    if (!state.bullets[n].hit) {
      flyingBullets.push(state.bullets[n]);
    }
  }
  state.bullets = flyingBullets;

  var playerBox = {
    x: state.player.x,
    y: state.player.y,
    width: config.player.width,
    height: config.player.height,
  };

  var reachedBottom = false;
  var collided = false;
  for (var inv = 0; inv < state.invaders.length; inv++) {
    var invObj = state.invaders[inv];
    if (!state.player.dead && invObj.y + invObj.height >= playerBox.y) {
      reachedBottom = true;
    }
    if (!state.player.dead && rectsOverlap(invObj, playerBox)) {
      collided = true;
    }
  }

  if ((reachedBottom || collided) && !state.gameOver) {
    loseLife();
  }

  updateBunkerDamageFromInvaders();

  for (var eb = 0; eb < state.enemyBullets.length; eb++) {
    var b = state.enemyBullets[eb];
    if (bulletHitsBunkers(b, true)) continue;
    if (rectsOverlap(b, playerBox) && !state.gameOver && !state.player.dead) {
      b.hit = true;
      loseLife();
    }
  }

  var enemyStill = [];
  for (var r = 0; r < state.enemyBullets.length; r++) {
    if (!state.enemyBullets[r].hit) {
      enemyStill.push(state.enemyBullets[r]);
    }
  }
  state.enemyBullets = enemyStill;

}

// paint the dark space background (and stars once loaded)
function drawBackground() {
  ctx.fillStyle = "#080812";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (assetsReady) {
    ctx.drawImage(assets.background, 0, 0, canvas.width, canvas.height);
  }
}

function drawBunkers() {
  for (var i = 0; i < state.bunkers.length; i++) {
    var bunker = state.bunkers[i];
    for (var row = 0; row < bunker.rows; row++) {
      for (var col = 0; col < bunker.cols; col++) {
        if (!bunker.cells[row][col]) continue;
        var x = bunker.x + col * bunker.cellSize;
        var y = bunker.y + row * bunker.cellSize;
        ctx.fillStyle = row < 2 ? "#fcb024" : "#f6543a";
        ctx.fillRect(x, y, bunker.cellSize, bunker.cellSize);
        ctx.fillStyle = "rgba(255, 244, 184, 0.22)";
        ctx.fillRect(x, y, bunker.cellSize, 1);
        ctx.fillStyle = "rgba(43, 0, 0, 0.28)";
        ctx.fillRect(x, y + bunker.cellSize - 1, bunker.cellSize, 1);
      }
    }
  }
}

// draw the player's ship if it is alive
function drawPlayer() {
  if (!assetsReady || state.player.dead) return;
  ctx.drawImage(
    assets.player,
    state.player.x,
    state.player.y,
    config.player.width,
    config.player.height
  );
}

// draw each invader or their explosion sprite
function drawInvaders() {
  if (!assetsReady) return;
  var invaderLen = state.invaders.length;
  for (var i = 0; i < invaderLen; i++) {
    var invader = state.invaders[i];
    if (invader.exploding) {
      invader.exploding = invader.exploding - 1;
      ctx.drawImage(
        assets.boom,
        invader.x - 10,
        invader.y - 10,
        invader.width + 20,
        invader.height + 20
      );
      continue;
    }
    var sprite = assets[invader.type];
    if (!sprite) continue;
    ctx.drawImage(
      sprite,
      invader.x,
      invader.y,
      config.invader.width,
      config.invader.height
    );
  }
}

// draw all player bullets heading upwards
function drawBullets() {
  if (!assetsReady) return;
  var bulletsLen = state.bullets.length;
  for (var i = 0; i < bulletsLen; i++) {
    var bullet = state.bullets[i];
    ctx.drawImage(
      assets.bullet,
      bullet.x,
      bullet.y,
      bullet.width,
      bullet.height
    );
  }
}

// draw the bullets fired by the invaders
function drawEnemyBullets() {
  if (!assetsReady) return;
  var enemyLen = state.enemyBullets.length;
  for (var i = 0; i < enemyLen; i++) {
    var invaderBullet = state.enemyBullets[i];
    ctx.drawImage(
      assets.invaderBullet,
      invaderBullet.x,
      invaderBullet.y,
      invaderBullet.width,
      invaderBullet.height
    );
  }
}


// keep the explosion visible for a short time after the player dies
function drawPlayerExplosion() {
  if (!assetsReady) return;
  if (state.player.dead && state.player.explosionTimer > 0) {
    ctx.drawImage(
      assets.boom,
      state.lastPlayerPosition.x - 8,
      state.lastPlayerPosition.y - 8,
      config.player.width + 16,
      config.player.height + 16
    );
  }
}

// count down respawn timers so the player can come back
function updateRespawn(dt) {
  if (!state.player.dead) return;
  if (state.player.explosionTimer > 0) {
    state.player.explosionTimer -= dt;
  }
  if (state.player.respawnTimer > 0) {
    state.player.respawnTimer -= dt;
  }
  if (state.player.respawnTimer <= 0 && !state.gameOver && state.lives > 0) {
    resetPlayer();
  }
}

var lastTime = performance.now();
// main game loop: update the world then draw everything
function loop(timestamp) {
  var delta = (timestamp - lastTime) / 16.666;
  lastTime = timestamp;

  if (state.started) {
    handleInput(delta, timestamp);
    if (!state.gameOver && !state.paused) {
      moveInvaders(delta);
      updateBullets(delta);
      updateEnemyBullets(delta);
      maybeFireEnemy(timestamp);
      checkCollisions();
      if (state.invaders.length === 0) {
        nextWave();
      }
    }
    if (!state.paused) {
      updateRespawn(delta);
    }
  }

  drawBackground();
  if (state.started) {
    drawBunkers();
    drawInvaders();
    drawBullets();
    drawEnemyBullets();
    drawPlayerExplosion();
    drawPlayer();
  }
  updateHud();

  requestAnimationFrame(loop);
}

// listen for keyboard controls (arrows/A-D to move, space to shoot, P to pause)
document.addEventListener("keydown", function (event) {
  if (event.code === "ArrowLeft" || event.code === "KeyA") keys.left = true;
  if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = true;
  if (event.code === "Space") keys.shoot = true;
  if (event.code === "KeyP") {
    if (state.started && !state.gameOver) {
      setPaused(!state.paused);
    }
  }
});

// stop moving/shooting once the key is released
document.addEventListener("keyup", function (event) {
  if (event.code === "ArrowLeft" || event.code === "KeyA") keys.left = false;
  if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = false;
  if (event.code === "Space") keys.shoot = false;
});

// kick off the initial setup and start the animation loop
resetGame();
requestAnimationFrame(loop);

// start the first game when the player clicks the start button
ui.startBtn.addEventListener("click", function () {
  startGame();
});

// allow restarting after seeing the game over overlay
ui.restartBtn.addEventListener("click", function () {
  resetGame();
  ui.gameOver.classList.add("hidden");
  startGame();
});

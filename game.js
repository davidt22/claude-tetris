'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const SKIN_COLORS = {
  retro:  [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#7986cb', '#ffb74d'],
  neon:   [null, '#00fff5', '#ffee00', '#dd00ff', '#00ff66', '#ff0033', '#4466ff', '#ff8800'],
  pastel: [null, '#a8d8ea', '#ffeaa7', '#d7aefb', '#b5ead7', '#ffb7b2', '#b5c7f0', '#ffd8b1'],
  pixel:  [null, '#4dd0e1', '#ffd54f', '#ba68c8', '#81c784', '#e57373', '#7986cb', '#ffb74d'],
};

let currentSkin = localStorage.getItem('tetris-skin') || 'retro';

function setSkin(name) {
  currentSkin = name;
  localStorage.setItem('tetris-skin', name);
  document.body.className = document.body.className
    .replace(/skin-\w+/g, '')
    .trim();
  document.body.classList.add('skin-' + name);
}

function getColor(index) {
  return (SKIN_COLORS[currentSkin] || SKIN_COLORS.retro)[index];
}

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const pauseOverlay = document.getElementById('pause-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const gameoverScore = document.getElementById('gameover-score');
const resumeBtn = document.getElementById('resume-btn');
const restartBtn = document.getElementById('restart-btn');
const newgameBtn = document.getElementById('newgame-btn');
const controlsBtn = document.getElementById('controls-btn');
const controlsPanel = document.getElementById('controls-panel');
const startLevelSelect = document.getElementById('start-level');
const themeToggleInput = document.getElementById('theme-toggle-input');

themeToggleInput.addEventListener('change', () => {
  document.body.classList.toggle('light-mode', themeToggleInput.checked);
});

let startLevel = 1;
let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, maxCombo;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.max(startLevel, Math.floor(lines / 10) + 1);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    combo = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = getColor(colorIndex);
  context.globalAlpha = alpha ?? 1;

  if (currentSkin === 'neon') {
    // shadowBlur is managed by draw()/drawNext() to avoid per-block state writes
    context.shadowColor = color;
    context.fillStyle = color;
    context.fillRect(x * size + 2, y * size + 2, size - 4, size - 4);
  } else if (currentSkin === 'pastel') {
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.fillStyle = 'rgba(255,255,255,0.25)';
    context.fillRect(x * size + 1, y * size + 1, size - 2, 2);
  } else if (currentSkin === 'pixel') {
    const half = Math.floor(size / 2);
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    // top-left sub-square: brighter
    context.fillStyle = 'rgba(255,255,255,0.20)';
    context.fillRect(x * size + 1, y * size + 1, half - 1, half - 1);
    // bottom-right sub-square: darker
    context.fillStyle = 'rgba(0,0,0,0.25)';
    context.fillRect(x * size + half + 1, y * size + half + 1, half - 2, half - 2);
  } else {
    // retro (default)
    context.fillStyle = color;
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  }

  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board — neon: enable glow once for all solid blocks
  if (currentSkin === 'neon') ctx.shadowBlur = 12;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost — no glow so it stays subtle
  if (currentSkin === 'neon') ctx.shadowBlur = 0;
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece — glow on
  if (currentSkin === 'neon') ctx.shadowBlur = 12;
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  if (currentSkin === 'neon') ctx.shadowBlur = 0;
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  if (currentSkin === 'neon') nextCtx.shadowBlur = 12;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
  if (currentSkin === 'neon') nextCtx.shadowBlur = 0;
}

function loadScores() {
  try {
    return JSON.parse(localStorage.getItem('tetris-scores') || '[]');
  } catch (e) {
    return [];
  }
}

function saveScore(name, s, l, mc) {
  var scores = loadScores();
  var entry = {
    name: name.trim() || 'AAA',
    score: s,
    lines: l,
    maxCombo: mc,
    date: new Date().toISOString().slice(0, 10)
  };
  scores.push(entry);
  scores.sort(function(a, b) { return b.score - a.score; });
  scores = scores.slice(0, 5);
  // Find the index of the newly inserted entry (last push, so search from end)
  var newIdx = -1;
  for (var i = scores.length - 1; i >= 0; i--) {
    if (scores[i] === entry) { newIdx = i; break; }
  }
  localStorage.setItem('tetris-scores', JSON.stringify(scores));
  return { scores: scores, newIdx: newIdx };
}

function renderScores(highlightIdx) {
  var list = document.getElementById('high-scores-list');
  if (!list) return;
  var scores = loadScores();
  if (scores.length === 0) {
    list.innerHTML = '<li class="no-scores">Sin récords aún</li>';
    return;
  }
  list.innerHTML = scores.map(function(entry, i) {
    var cls = (i === highlightIdx) ? ' class="new-record"' : '';
    return '<li' + cls + '>' +
      '<span class="hs-rank">' + (i + 1) + '.</span>' +
      '<span class="hs-name">' + escapeHtml(entry.name) + '</span>' +
      '<span class="hs-score">' + entry.score.toLocaleString() + '</span>' +
      '<span class="hs-detail">' + escapeHtml(String(entry.lines)) + 'L C' + escapeHtml(String(entry.maxCombo)) + '</span>' +
      '</li>';
  }).join('');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resetScores() {
  localStorage.removeItem('tetris-scores');
  renderScores();
}

function checkAndShowScoreEntry() {
  var scores = loadScores();
  var qualifies = scores.length < 5 || score >= scores[scores.length - 1].score;
  var scoreEntry = document.getElementById('score-entry');
  var playerNameInput = document.getElementById('player-name');
  if (qualifies && scoreEntry) {
    scoreEntry.classList.remove('hidden');
    if (playerNameInput) {
      playerNameInput.value = '';
      playerNameInput.focus();
    }
  }
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  gameoverScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  var scoreEntry = document.getElementById('score-entry');
  if (scoreEntry) scoreEntry.classList.add('hidden');
  gameoverOverlay.classList.remove('hidden');
  checkAndShowScoreEntry();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    pauseOverlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    pauseOverlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  startLevel = parseInt(startLevelSelect.value, 10) || 1;
  board = createBoard();
  score = 0;
  lines = 0;
  level = startLevel;
  paused = false;
  gameOver = false;
  combo = 0;
  maxCombo = 0;
  dropInterval = Math.max(100, 1000 - (startLevel - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  renderScores();
  pauseOverlay.classList.add('hidden');
  gameoverOverlay.classList.add('hidden');
  controlsPanel.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.key === 'Escape') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

resumeBtn.addEventListener('click', togglePause);
restartBtn.addEventListener('click', init);
newgameBtn.addEventListener('click', init);
controlsBtn.addEventListener('click', () => {
  controlsPanel.classList.toggle('hidden');
});
startLevelSelect.addEventListener('change', function () {
  startLevel = parseInt(this.value, 10);
});

document.getElementById('save-score-btn').addEventListener('click', function() {
  var playerNameInput = document.getElementById('player-name');
  var name = playerNameInput ? playerNameInput.value : '';
  var result = saveScore(name, score, lines, maxCombo);
  renderScores(result.newIdx);
  var scoreEntry = document.getElementById('score-entry');
  if (scoreEntry) scoreEntry.classList.add('hidden');
});

document.getElementById('reset-scores-btn').addEventListener('click', function() {
  resetScores();
});

document.getElementById('skin-selector').addEventListener('change', function () {
  setSkin(this.value);
});

setSkin(currentSkin);
document.getElementById('skin-selector').value = currentSkin;

init();

// Setup screen: which colours play, their names, ball count, level order and
// starting speed. Settings persist in localStorage. Music is in music.js.

const SETTINGS_KEY = 'colour-arena-settings';
const MIN_COLOURS = 2;

const setupScreen = document.getElementById('setup');
const gameScreen = document.getElementById('game');
const teamGrid = document.getElementById('teamGrid');
const colourSummary = document.getElementById('colourSummary');
const ballNote = document.getElementById('ballNote');
const totalBallsSel = document.getElementById('totalBalls');
const startSpeedSel = document.getElementById('startSpeed');
const orderSeg = document.getElementById('orderSeg');
const startBtn = document.getElementById('startBtn');

const settings = {
  enabled: PALETTE.map((c) => c.id),   // all 12 by default
  names: {},                           // id -> custom name ('' = colour name)
  totalBalls: 2500,
  order: 'fixed',
  speed: 1,
};

function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) { /* private mode / bad data */ }
  if (!saved || typeof saved !== 'object') return;
  const ids = new Set(PALETTE.map((c) => c.id));
  if (Array.isArray(saved.enabled)) {
    const en = saved.enabled.filter((id) => ids.has(id));
    if (en.length >= MIN_COLOURS) settings.enabled = en;
  }
  if (saved.names && typeof saved.names === 'object') {
    for (const id of ids) if (typeof saved.names[id] === 'string') settings.names[id] = saved.names[id].slice(0, 24);
  }
  if ([1000, 1500, 2000, 2500, 3000, 4000].includes(saved.totalBalls)) settings.totalBalls = saved.totalBalls;
  if (saved.order === 'fixed' || saved.order === 'shuffled') settings.order = saved.order;
  if ([1, 2, 4, 8].includes(saved.speed)) settings.speed = saved.speed;
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* private mode */ }
}

// ---- colour grid -------------------------------------------------------------

const nameInputs = {};
const checkBoxes = {};

function buildGrid() {
  teamGrid.replaceChildren();
  for (const c of PALETTE) {
    const row = document.createElement('div');
    row.className = 'team-field';
    row.style.setProperty('--chip', c.ball);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'team-check';
    cb.setAttribute('aria-label', `Include ${c.label}`);
    cb.addEventListener('change', () => onToggle(c.id, cb));

    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.addEventListener('click', () => cb.click());

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'team-name';
    name.maxLength = 24;
    name.placeholder = c.label;
    name.setAttribute('aria-label', `Name for ${c.label}`);
    name.addEventListener('input', () => { settings.names[c.id] = name.value; saveSettings(); });

    row.append(cb, chip, name);
    teamGrid.append(row);
    nameInputs[c.id] = name;
    checkBoxes[c.id] = cb;
  }
}

function onToggle(id, cb) {
  const on = new Set(settings.enabled);
  if (cb.checked) on.add(id); else on.delete(id);
  if (on.size < MIN_COLOURS) { cb.checked = true; return; }
  settings.enabled = PALETTE.map((c) => c.id).filter((x) => on.has(x));
  saveSettings();
  refresh();
}

function refresh() {
  const on = new Set(settings.enabled);
  for (const c of PALETTE) {
    checkBoxes[c.id].checked = on.has(c.id);
    nameInputs[c.id].value = settings.names[c.id] || '';
    checkBoxes[c.id].closest('.team-field').classList.toggle('off', !on.has(c.id));
  }
  const n = settings.enabled.length;
  colourSummary.textContent = `${n} colours · ${n - 1} legs`;
  const per = Math.floor(settings.totalBalls / n);
  ballNote.textContent = `Leg 1 releases ${settings.totalBalls.toLocaleString()} balls, about ${per} per colour. Each later leg keeps the same total shared between fewer colours.`;
  totalBallsSel.value = String(settings.totalBalls);
  startSpeedSel.value = String(settings.speed);
  for (const b of orderSeg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.order === settings.order);
}

document.getElementById('selectAll').addEventListener('click', () => {
  settings.enabled = PALETTE.map((c) => c.id);
  saveSettings(); refresh();
});
document.getElementById('selectNone').addEventListener('click', () => {
  // keep the minimum playable pair rather than an empty game
  settings.enabled = PALETTE.slice(0, MIN_COLOURS).map((c) => c.id);
  saveSettings(); refresh();
});
document.getElementById('resetNames').addEventListener('click', () => {
  settings.names = {};
  saveSettings(); refresh();
});
document.getElementById('applyPaste').addEventListener('click', () => {
  const lines = document.getElementById('pasteBox').value.split('\n').map((s) => s.trim()).filter(Boolean);
  const ids = PALETTE.map((c) => c.id).filter((id) => settings.enabled.includes(id));
  ids.forEach((id, i) => { if (lines[i] !== undefined) settings.names[id] = lines[i].slice(0, 24); });
  saveSettings(); refresh();
});

totalBallsSel.addEventListener('change', () => { settings.totalBalls = Number(totalBallsSel.value); saveSettings(); refresh(); });
startSpeedSel.addEventListener('change', () => { settings.speed = Number(startSpeedSel.value); saveSettings(); });
orderSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-order]');
  if (!b) return;
  settings.order = b.dataset.order;
  saveSettings(); refresh();
});

// ---- screens -----------------------------------------------------------------

function currentConfig() {
  return {
    colours: settings.enabled.slice(),
    names: { ...settings.names },
    totalBalls: settings.totalBalls,
    order: settings.order,
    speed: settings.speed,
  };
}

function showGameScreen() {
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  window.scrollTo(0, 0);
}

function showSetup() {
  running = false;
  clearLeg();
  stopMusic();
  if (document.fullscreenElement) document.exitFullscreen();
  gameScreen.hidden = true;
  setupScreen.hidden = false;
}

function beginFromSetup() {
  showGameScreen();
  startGame(currentConfig());
  playMusic();
}

startBtn.addEventListener('click', beginFromSetup);
document.getElementById('again-btn').addEventListener('click', () => startGame(currentConfig()));
document.getElementById('edit-btn').addEventListener('click', showSetup);
document.getElementById('setup-btn').addEventListener('click', showSetup);

loadSettings();
buildGrid();
refresh();

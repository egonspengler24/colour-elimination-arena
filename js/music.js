// Background music. Three sources: the bundled default track, a file the user
// picks (kept in memory only, nothing is uploaded), or nothing. The mute and
// volume controls in the game screen drive the same audio element.

const DEFAULT_TRACK = 'assets/keep-it-real.mp3';
const DEFAULT_TRACK_LABEL = 'Keep It Real (Nick Petrov)';

const music = new Audio(DEFAULT_TRACK);
music.loop = true;
music.preload = 'auto';

let musicUrl = null;        // object URL for a user-chosen file
let musicMode = 'default';  // 'default' | 'custom' | 'none'

const musicEls = {
  defaultBtn: document.getElementById('musicDefault'),
  fileLabel: document.getElementById('musicFileLabel'),
  file: document.getElementById('musicFile'),
  noneBtn: document.getElementById('musicNone'),
  name: document.getElementById('musicName'),
  mute: document.getElementById('mute-btn'),
  volume: document.getElementById('volume'),
};

music.volume = Number(musicEls.volume.value);

function setMusicMode(mode, label) {
  musicMode = mode;
  musicEls.defaultBtn.classList.toggle('on', mode === 'default');
  musicEls.fileLabel.classList.toggle('on', mode === 'custom');
  musicEls.noneBtn.classList.toggle('on', mode === 'none');
  musicEls.name.textContent = mode === 'none' ? 'The game will be silent.' : label;
  try { localStorage.setItem('colour-arena-music', mode === 'none' ? 'none' : 'default'); } catch (_) { /* private mode */ }
}

function releaseCustomFile() {
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  musicUrl = null;
  musicEls.file.value = '';
}

musicEls.defaultBtn.addEventListener('click', () => {
  releaseCustomFile();
  music.src = DEFAULT_TRACK;
  setMusicMode('default', DEFAULT_TRACK_LABEL);
});

musicEls.file.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (musicUrl) URL.revokeObjectURL(musicUrl);
  musicUrl = URL.createObjectURL(file);
  music.src = musicUrl;
  setMusicMode('custom', file.name);
});

musicEls.noneBtn.addEventListener('click', () => {
  music.pause();
  releaseCustomFile();
  setMusicMode('none');
});

musicEls.volume.addEventListener('input', (e) => { music.volume = Number(e.target.value); });

musicEls.mute.addEventListener('click', () => {
  music.muted = !music.muted;
  musicEls.mute.innerHTML = music.muted ? '&#128263;' : '&#128266;';
  musicEls.mute.setAttribute('aria-pressed', String(music.muted));
});

function playMusic() {
  if (musicMode === 'none') return;
  music.play().catch(() => {});
}

function stopMusic() {
  music.pause();
}

(function initMusic() {
  let saved = null;
  try { saved = localStorage.getItem('colour-arena-music'); } catch (_) { /* private mode */ }
  if (saved === 'none') setMusicMode('none');
  else setMusicMode('default', DEFAULT_TRACK_LABEL);
})();

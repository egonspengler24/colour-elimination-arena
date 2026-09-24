// Ranked collection bins along the bottom of the screen. One column per starting
// colour, live-reordered and live-grown as balls are collected each leg. A colour
// that finishes its leg allocation locks with a checkmark; a colour that loses a
// leg turns into a black "graveyard" column (X) and is pinned to the right for
// the rest of the game. See SPEC.md §6.

class Bins {
  constructor(container, palette) {
    this.container = container;
    this.palette = palette;
    this.els = {};
    this.counts = {};
    this.allocation = 0;
    this.eliminated = new Set();
    this.eliminationOrder = [];
    this.completedSeq = {};
    this.seq = 0;
    this.dirty = new Set();
    container.replaceChildren();

    for (const colour of palette) {
      const el = document.createElement('div');
      el.className = 'bin';
      el.title = colour.label;
      el.style.setProperty('--bin-colour', colour.ball);
      el.innerHTML = `
        <div class="bin-badge">&#10003;</div>
        <div class="bin-fill"></div>
        <div class="bin-count">0</div>
      `;
      container.appendChild(el);
      this.els[colour.id] = el;
      this.counts[colour.id] = 0;
    }
  }

  startLeg(activeIds, allocation) {
    this.allocation = allocation;
    this.completedSeq = {};
    this.seq = 0;
    for (const id of activeIds) {
      this.counts[id] = 0;
      const el = this.els[id];
      el.classList.remove('eliminated', 'complete');
      el.classList.add('active');
      el.querySelector('.bin-fill').style.height = '0%';
      el.querySelector('.bin-count').textContent = '0';
      el.style.order = 0;
    }
    this.dirty.clear();
    this._reorder(activeIds);
  }

  // Counting is immediate (it decides the leg); the DOM is only touched once
  // per frame in flush(), because at high game speed hundreds of balls can be
  // collected between two paints.
  collect(id) {
    if (this.eliminated.has(id)) return;
    this.counts[id] = Math.min(this.allocation, this.counts[id] + 1);
    if (this.counts[id] >= this.allocation && this.completedSeq[id] === undefined) {
      this.completedSeq[id] = ++this.seq;
    }
    this.dirty.add(id);
  }

  flush() {
    if (this.dirty.size === 0) return;
    for (const id of this.dirty) {
      const el = this.els[id];
      const pct = (this.counts[id] / this.allocation) * 100;
      el.querySelector('.bin-fill').style.height = `${pct}%`;
      el.querySelector('.bin-count').textContent = String(this.counts[id]);
      if (this.counts[id] >= this.allocation) el.classList.add('complete');
    }
    this.dirty.clear();
    this._reorder(this._activeIds());
  }

  eliminate(id) {
    this.flush();
    this.eliminated.add(id);
    this.eliminationOrder.push(id);
    const el = this.els[id];
    el.classList.remove('active', 'complete');
    el.classList.add('eliminated');
    el.style.order = 1000 + this.eliminationOrder.length;
  }

  isComplete(id) {
    return this.counts[id] >= this.allocation;
  }

  count(id) {
    return this.counts[id] || 0;
  }

  _activeIds() {
    return this.palette.map((c) => c.id).filter((id) => !this.eliminated.has(id));
  }

  _reorder(activeIds) {
    const ranked = [...activeIds].sort((a, b) => this.counts[b] - this.counts[a]);
    ranked.forEach((id, i) => {
      this.els[id].style.order = i;
    });
  }
}

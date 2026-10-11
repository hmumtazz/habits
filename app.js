'use strict';

const STORE = 'habits.v1';
const VIEW_KEY = 'habits.view';
const SYNC_KEY = 'habits.sync';
const SYNC_FILE = 'backup.json';
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SVGNS = 'http://www.w3.org/2000/svg';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLORS = ['#a3e635', '#22d3ee', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#fb7185', '#38bdf8',
  '#fb923c', '#2dd4bf', '#818cf8', '#facc15', '#e879f9', '#60a5fa', '#f87171', '#94a3b8'];
const COLOR_NAMES = ['Lime', 'Cyan', 'Amber', 'Violet', 'Emerald', 'Pink', 'Rose', 'Sky',
  'Orange', 'Teal', 'Indigo', 'Yellow', 'Fuchsia', 'Blue', 'Red', 'Slate'];

const $ = sel => document.querySelector(sel);
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const weekday = d => (d.getDay() + 6) % 7;
const longDate = d => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const clampInt = (v, lo, hi, dflt) => Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const colorVars = c => ({ '--c': c, '--tint': rgba(c, 0.07), '--dim': rgba(c, 0.15), '--dim2': rgba(c, 0.28), '--half': rgba(c, 0.55) });

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function icon(name, cls = 'ic') {
  const s = svgEl('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true', focusable: 'false' });
  s.innerHTML = ICONS[name] || ICONS.target;
  return s;
}

function ring(frac) {
  const C = 2 * Math.PI * 15;
  const s = svgEl('svg', { viewBox: '0 0 36 36', class: 'ring', 'aria-hidden': 'true' });
  s.append(svgEl('circle', { cx: 18, cy: 18, r: 15, class: 'ring-bg' }),
    svgEl('circle', { cx: 18, cy: 18, r: 15, class: 'ring-fg', 'stroke-dasharray': `${(C * frac).toFixed(2)} ${C.toFixed(2)}`, transform: 'rotate(-90 18 18)' }));
  return s;
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.habits)) return null;
  const seen = new Set();
  const habits = [];
  for (const x of raw.habits) {
    if (!x || typeof x.name !== 'string' || !x.name.trim()) continue;
    let id = typeof x.id === 'string' && x.id && x.id.length <= 64 ? x.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const days = {};
    if (x.days && typeof x.days === 'object') {
      for (const [k, v] of Object.entries(x.days)) {
        const n = v === true ? 1 : clampInt(v, 0, 999, 0);
        if (DATE_RE.test(k) && n > 0) days[k] = n;
      }
    }
    const first = Object.keys(days).sort()[0];
    let created = typeof x.created === 'string' && DATE_RE.test(x.created) ? x.created : first || keyOf(today());
    if (first && first < created) created = first;
    habits.push({
      id,
      name: x.name.trim().slice(0, 60),
      desc: typeof x.desc === 'string' ? x.desc.trim().slice(0, 120) : '',
      icon: HABIT_ICONS.includes(x.icon) ? x.icon : HABIT_ICONS[0],
      color: COLORS.includes(x.color) ? x.color : COLORS[0],
      goal: clampInt(x.goal, 1, 99, 1),
      created,
      days,
    });
  }
  const lastBackup = typeof raw.lastBackup === 'string' && DATE_RE.test(raw.lastBackup) ? raw.lastBackup : null;
  return { habits, lastBackup };
}

function load() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORE))) || { habits: [], lastBackup: null };
  } catch {
    return { habits: [], lastBackup: null };
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    toast('Could not save. Storage is full or blocked.');
    return;
  }
  if (sync.token) { sync.dirty = true; saveSync(); scheduleSync(); }
}

function loadSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_KEY));
    return s && REPO_RE.test(s.repo) && typeof s.token === 'string' ? s : {};
  } catch {
    return {};
  }
}

const saveSync = () => localStorage.setItem(SYNC_KEY, JSON.stringify(sync));

let state = load();
let sync = loadSync();
const ui = { view: localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid', detailId: null, month: null, editId: null, draft: null };

const find = id => state.habits.find(x => x.id === id);
const countOn = (hb, k) => hb.days[k] || 0;
const isDone = (hb, k) => countOn(hb, k) >= hb.goal;
const doneKeys = hb => Object.keys(hb.days).filter(k => isDone(hb, k));

function currentStreak(hb) {
  let d = today();
  if (!isDone(hb, keyOf(d))) d = addDays(d, -1);
  let n = 0;
  while (isDone(hb, keyOf(d))) { n++; d = addDays(d, -1); }
  return n;
}

function bestStreak(hb) {
  let best = 0, run = 0, prev = null;
  for (const k of doneKeys(hb).sort()) {
    run = prev && keyOf(addDays(prev, 1)) === k ? run + 1 : 1;
    if (run > best) best = run;
    prev = fromKey(k);
  }
  return best;
}

function completionRate(hb) {
  const span = Math.round((today() - fromKey(hb.created)) / 86400000) + 1;
  return span > 0 ? Math.min(100, Math.round((doneKeys(hb).length / span) * 100)) : 0;
}

function bump(id, k) {
  const hb = find(id);
  if (!hb || k > keyOf(today())) return;
  const n = countOn(hb, k);
  if (n >= hb.goal) delete hb.days[k];
  else hb.days[k] = n + 1;
  if (k < hb.created) hb.created = k;
  save();
  renderAll();
}

function heatmap(hb, weeks, cell, gap, extra = '') {
  const end = today();
  const start = addDays(end, -weekday(end) - 7 * (weeks - 1));
  const g = h('div', { class: `heat ${extra}`, 'aria-hidden': 'true', style: { '--cell': `${cell}px`, '--gap': `${gap}px` } });
  const frag = document.createDocumentFragment();
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const cellEl = document.createElement('i');
    if (d > end) cellEl.className = 'fut';
    else {
      const n = countOn(hb, keyOf(d));
      cellEl.className = n >= hb.goal ? 'on' : n ? 'part' : '';
    }
    frag.append(cellEl);
  }
  g.append(frag);
  return g;
}

function checkButton(hb, k) {
  const n = countOn(hb, k);
  const done = n >= hb.goal;
  const multi = hb.goal > 1;
  const b = h('button', {
    class: `check${done ? ' done' : ''}${multi && !done ? ' multi' : ''}`,
    'data-f': `${hb.id}|${k}|check`,
    'aria-label': multi ? `${hb.name}: ${n} of ${hb.goal} today` : `${hb.name} done today`,
    'aria-pressed': multi ? null : String(done),
    onclick: () => bump(hb.id, k),
  });
  if (multi && !done) b.append(ring(n / hb.goal), icon('plus', 'ic small'));
  else b.append(icon('check'));
  return b;
}

function gridView() {
  const t = keyOf(today());
  const home = $('#home');
  const cs = getComputedStyle(home);
  const inner = Math.max(220, home.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 30);
  const gap = 3;
  const weeks = Math.max(8, Math.floor((inner + gap) / 13));
  const cell = (inner - gap * (weeks - 1)) / weeks;
  return h('ul', { class: 'cards' }, state.habits.map(hb => h('li', { class: 'card', style: colorVars(hb.color) },
    h('div', { class: 'card-head' },
      h('button', { class: 'card-open', onclick: () => openDetail(hb.id) },
        h('span', { class: 'chip' }, icon(hb.icon)),
        h('span', { class: 'titles' },
          h('span', { class: 'name' }, hb.name),
          hb.desc && h('span', { class: 'desc' }, hb.desc),
          h('span', { class: 'sr' }, `, ${currentStreak(hb)} day streak`))),
      checkButton(hb, t)),
    heatmap(hb, weeks, cell, gap))));
}

function squareButton(hb, d, t) {
  const k = keyOf(d);
  const n = countOn(hb, k);
  const done = n >= hb.goal;
  const status = hb.goal > 1 ? `${n} of ${hb.goal}` : done ? 'done' : 'not done';
  const b = h('button', {
    class: `sq${done ? ' on' : n ? ' part' : ''}${k === t ? ' today' : ''}`,
    'data-f': `${hb.id}|${k}|sq`,
    'aria-label': `${hb.name}, ${longDate(d)}: ${status}`,
    onclick: () => bump(hb.id, k),
  });
  if (!done && n) b.append(ring(n / hb.goal));
  return b;
}

function listView() {
  const end = today();
  const t = keyOf(end);
  const N = 5;
  const days = Array.from({ length: N }, (_, i) => addDays(end, i - N + 1));
  const fmt = d => `${MONTHS[d.getMonth()].toUpperCase()} ${d.getDate()}`;
  return h('div', { class: 'list-view' },
    h('div', { class: 'list-top' },
      h('span', { class: 'pill' }, `Last ${N} days`),
      h('span', { class: 'mono' }, `${fmt(days[0])} – ${fmt(end)}`)),
    h('div', { class: 'list-card' },
      h('div', { class: 'list-row list-head', 'aria-hidden': 'true' },
        h('span', { class: 'mono' }, `${state.habits.length} HABIT${state.habits.length === 1 ? '' : 'S'}`),
        days.map(d => h('span', { class: `col${keyOf(d) === t ? ' is-today' : ''}` },
          h('span', {}, DOW[weekday(d)].slice(0, 2)), h('span', {}, d.getDate())))),
      h('ul', { class: 'list' }, state.habits.map(hb => h('li', { class: 'list-row', style: colorVars(hb.color) },
        h('button', { class: 'row-open', onclick: () => openDetail(hb.id) },
          h('span', { class: 'chip sm' }, icon(hb.icon)), h('span', { class: 'name' }, hb.name)),
        days.map(d => squareButton(hb, d, t)))))));
}

function emptyState() {
  return h('div', { class: 'empty panel' },
    h('span', { class: 'chip xl', style: colorVars(COLORS[3]) }, icon('sparkles')),
    h('h2', {}, 'No habits yet'),
    h('p', { class: 'muted' }, 'Add as many as you like. Tap the square each day you do one.'),
    h('button', { class: 'btn primary', onclick: () => openEdit(null) }, icon('plus'), 'Create your first habit'));
}

function renderHome() {
  const home = $('#home');
  $('#view-grid').setAttribute('aria-pressed', String(ui.view === 'grid'));
  $('#view-list').setAttribute('aria-pressed', String(ui.view === 'list'));
  const t = keyOf(today());
  const total = state.habits.length;
  const done = state.habits.filter(hb => isDone(hb, t)).length;
  $('#summary').textContent = !total ? '' : done === total ? 'All done today' : `${done} of ${total} done today`;
  home.replaceChildren(!total ? emptyState() : ui.view === 'grid' ? gridView() : listView());
}

function yearHeat(hb) {
  const weeks = 53, cell = 11, gap = 3;
  const end = today();
  const start = addDays(end, -weekday(end) - 7 * (weeks - 1));
  const months = h('div', { class: 'months', 'aria-hidden': 'true', style: { '--cols': weeks, '--cell': `${cell}px`, '--gap': `${gap}px` } });
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, w * 7);
    if (monday.getDate() <= 7) months.append(h('span', { style: { 'grid-column': `${w + 1} / span 3` } }, MONTHS[monday.getMonth()]));
  }
  const wrap = h('div', { class: 'year-wrap' }, months, heatmap(hb, weeks, cell, gap, 'big'));
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });
  return h('div', { class: 'panel' }, wrap);
}

function monthCalendar(hb) {
  const m = ui.month;
  const end = today();
  const t = keyOf(end);
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const start = addDays(first, -weekday(first));
  const cells = Math.ceil((weekday(first) + daysIn) / 7) * 7;
  const label = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const grid = h('div', { class: 'cal', role: 'group', 'aria-label': label },
    DOW.map(d => h('span', { class: 'cal-dow', 'aria-hidden': 'true' }, d)));
  for (let i = 0; i < cells; i++) {
    const d = addDays(start, i);
    const k = keyOf(d);
    if (d.getMonth() !== m.getMonth()) {
      grid.append(h('span', { class: 'cal-day out', 'aria-hidden': 'true' }, d.getDate()));
      continue;
    }
    const n = countOn(hb, k);
    const done = n >= hb.goal;
    grid.append(h('button', {
      class: `cal-day${done ? ' on' : n ? ' part' : ''}${k === t ? ' today' : ''}`,
      'data-f': `${hb.id}|${k}|cal`,
      disabled: k > t,
      'aria-pressed': hb.goal > 1 ? null : String(done),
      'aria-label': `${longDate(d)}${hb.goal > 1 ? `, ${n} of ${hb.goal}` : ''}`,
      onclick: () => bump(hb.id, k),
    }, h('span', {}, d.getDate()), h('i', { class: 'pip' })));
  }
  return h('div', { class: 'panel' }, grid,
    h('div', { class: 'cal-nav' },
      h('span', { class: 'cal-label' }, icon('calendar', 'ic small'), `${MONTHS[m.getMonth()]} ${m.getFullYear()}`),
      h('div', { class: 'cal-btns' },
        h('button', { class: 'icon-btn sm', 'aria-label': 'Previous month', onclick: () => shiftMonth(-1) }, icon('chevron-left')),
        h('button', { class: 'icon-btn sm', 'aria-label': 'Next month', disabled: next > end, onclick: () => shiftMonth(1) }, icon('chevron-right')))));
}

function monthChart(hb) {
  const end = today();
  const W = 300, H = 100;
  const months = Array.from({ length: 12 }, (_, i) => new Date(end.getFullYear(), end.getMonth() - 11 + i, 1));
  const done = doneKeys(hb);
  const counts = months.map(m => { const p = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-`; return done.filter(k => k.startsWith(p)).length; });
  const max = Math.max(1, ...counts);
  const pts = counts.map((c, i) => [(i * W) / 11, H - 3 - (c / max) * (H - 14)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'none', role: 'img',
    'aria-label': `Completions per month: ${months.map((m, i) => `${MONTHS[m.getMonth()]} ${counts[i]}`).join(', ')}`,
  });
  const grad = svgEl('linearGradient', { id: 'chart-grad', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: '0', class: 'stop-a' }), svgEl('stop', { offset: '1', class: 'stop-b' }));
  const defs = svgEl('defs');
  defs.append(grad);
  svg.append(defs, svgEl('path', { d: `${line}L${W},${H}L0,${H}Z`, class: 'chart-area' }), svgEl('path', { d: line, class: 'chart-line' }));
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-title' }, h('h3', {}, 'Completions per month'), h('span', { class: 'chip sm' }, icon('activity'))),
    svg,
    h('div', { class: 'chart-x', 'aria-hidden': 'true' }, months.map(m => h('span', {}, MONTHS[m.getMonth()][0]))));
}

const stat = (label, value, ic) => h('div', { class: 'stat' },
  h('div', { class: 'stat-top' }, h('span', { class: 'stat-v' }, value), h('span', { class: 'chip sm' }, icon(ic))),
  h('span', { class: 'stat-l' }, label));

function renderDetail() {
  const hb = find(ui.detailId);
  const dlg = $('#detail');
  if (!hb) { if (dlg.open) dlg.close(); return; }
  for (const [p, v] of Object.entries(colorVars(hb.color))) dlg.style.setProperty(p, v);
  const cs = currentStreak(hb);
  $('#detail-body').replaceChildren(
    h('div', { class: 'd-head' },
      h('span', { class: 'chip lg' }, icon(hb.icon)),
      h('div', { class: 'titles' }, h('h2', { id: 'detail-title' }, hb.name), hb.desc && h('p', { class: 'desc' }, hb.desc))),
    yearHeat(hb),
    h('div', { class: 'tags' },
      h('span', { class: 'tag' }, icon('flame', 'ic small'), `${cs} day streak`),
      h('span', { class: 'tag' }, icon('target', 'ic small'), hb.goal > 1 ? `${hb.goal} times a day` : 'Daily')),
    monthCalendar(hb),
    h('div', { class: 'stats' },
      stat('Days completed', doneKeys(hb).length, 'circle-check'),
      stat('Completion rate', `${completionRate(hb)}%`, 'percent')),
    monthChart(hb),
    h('div', { class: 'stats' },
      stat('Current streak', cs, 'flame'),
      stat('Best streak', bestStreak(hb), 'trophy')));
}

function renderAll() {
  const active = document.activeElement;
  const f = active && active.dataset ? active.dataset.f : null;
  const dlg = $('#detail');
  const top = dlg.scrollTop;
  renderHome();
  if (ui.detailId && dlg.open) { renderDetail(); dlg.scrollTop = top; }
  if (f) {
    const el = document.querySelector(`[data-f="${CSS.escape(f)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
}

function openDetail(id) {
  const t = today();
  ui.detailId = id;
  ui.month = new Date(t.getFullYear(), t.getMonth(), 1);
  renderDetail();
  const dlg = $('#detail');
  dlg.showModal();
  dlg.scrollTop = 0;
}

function shiftMonth(delta) {
  ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + delta, 1);
  renderDetail();
}

function renderEdit() {
  const hb = ui.editId ? find(ui.editId) : null;
  const draft = ui.draft;
  const dlg = $('#edit');
  const preview = h('span', { class: 'chip xl' }, icon(draft.icon));
  const paint = () => {
    for (const [p, v] of Object.entries(colorVars(draft.color))) dlg.style.setProperty(p, v);
    preview.replaceChildren(icon(draft.icon));
  };
  const err = h('p', { class: 'err', id: 'name-err' });
  const goalVal = h('output', { class: 'goal-val', 'aria-live': 'polite' }, draft.goal);
  const step = d => { draft.goal = Math.min(99, Math.max(1, draft.goal + d)); goalVal.textContent = draft.goal; };

  $('#edit-title').textContent = hb ? 'Edit habit' : 'New habit';
  $('#edit-body').replaceChildren(
    h('div', { class: 'preview' }, preview),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Name'),
      h('input', {
        id: 'f-name', type: 'text', maxlength: 60, value: draft.name, autocomplete: 'off', enterkeyhint: 'done',
        placeholder: 'Morning run', 'aria-describedby': 'name-err', required: true,
        oninput: e => { draft.name = e.target.value; err.textContent = ''; },
      })),
    err,
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Description (optional)'),
      h('input', {
        id: 'f-desc', type: 'text', maxlength: 120, value: draft.desc, autocomplete: 'off', enterkeyhint: 'done',
        placeholder: 'Start the day with a run', oninput: e => { draft.desc = e.target.value; },
      })),
    h('fieldset', { class: 'field' }, h('legend', { class: 'label' }, 'Color'),
      h('div', { class: 'opt-grid colors' }, COLORS.map((c, i) => h('label', { class: 'opt-wrap' },
        h('input', { type: 'radio', name: 'color', value: c, class: 'sr', checked: c === draft.color, onchange: () => { draft.color = c; paint(); } }),
        h('span', { class: 'swatch', style: { '--sw': c } }),
        h('span', { class: 'sr' }, COLOR_NAMES[i]))))),
    h('fieldset', { class: 'field' }, h('legend', { class: 'label' }, 'Icon'),
      h('div', { class: 'opt-grid' }, HABIT_ICONS.map(n => h('label', { class: 'opt-wrap' },
        h('input', { type: 'radio', name: 'icon', value: n, class: 'sr', checked: n === draft.icon, onchange: () => { draft.icon = n; paint(); } }),
        h('span', { class: 'opt' }, icon(n)),
        h('span', { class: 'sr' }, n.replace(/-\d+$/, '').replace(/-/g, ' ')))))),
    h('div', { class: 'field' }, h('span', { class: 'label', id: 'goal-label' }, 'Times per day'),
      h('div', { class: 'stepper', role: 'group', 'aria-labelledby': 'goal-label' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fewer times per day', onclick: () => step(-1) }, icon('minus')),
        goalVal,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More times per day', onclick: () => step(1) }, icon('plus')))),
    hb && h('div', { class: 'row2' },
      h('button', { type: 'button', class: 'btn', onclick: () => move(hb.id, -1) }, icon('arrow-up'), 'Move up'),
      h('button', { type: 'button', class: 'btn', onclick: () => move(hb.id, 1) }, icon('arrow-down'), 'Move down')),
    hb && h('button', { type: 'button', class: 'btn danger', onclick: () => removeHabit(hb.id) }, icon('trash-2'), 'Delete habit'));
  paint();
}

function openEdit(id) {
  const hb = id ? find(id) : null;
  ui.editId = hb ? hb.id : null;
  ui.draft = hb
    ? { name: hb.name, desc: hb.desc, icon: hb.icon, color: hb.color, goal: hb.goal }
    : { name: '', desc: '', icon: HABIT_ICONS[state.habits.length % HABIT_ICONS.length], color: COLORS[state.habits.length % COLORS.length], goal: 1 };
  renderEdit();
  const dlg = $('#edit');
  dlg.showModal();
  dlg.scrollTop = 0;
  if (!hb) $('#f-name').focus();
}

function saveEdit(e) {
  e.preventDefault();
  const d = ui.draft;
  const name = d.name.trim();
  if (!name) {
    $('#name-err').textContent = 'Give your habit a name.';
    $('#f-name').focus();
    return;
  }
  const fields = { name, desc: d.desc.trim(), icon: d.icon, color: d.color, goal: d.goal };
  const hb = ui.editId && find(ui.editId);
  if (hb) Object.assign(hb, fields);
  else state.habits.push({ id: uid(), ...fields, created: keyOf(today()), days: {} });
  save();
  $('#edit').close();
  renderAll();
  toast(hb ? 'Saved' : `Added ${name}`);
}

function move(id, delta) {
  const i = state.habits.findIndex(x => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.habits.length) return;
  [state.habits[i], state.habits[j]] = [state.habits[j], state.habits[i]];
  save();
  renderAll();
  toast(delta < 0 ? 'Moved up' : 'Moved down');
}

function removeHabit(id) {
  const hb = find(id);
  if (!hb || !confirm(`Delete "${hb.name}" and all of its history? This cannot be undone.`)) return;
  state.habits = state.habits.filter(x => x.id !== id);
  save();
  $('#edit').close();
  if (ui.detailId === id) $('#detail').close();
  renderAll();
  toast('Deleted');
}

function renderSettings() {
  $('#last-backup').textContent = state.lastBackup
    ? `Last backup: ${fromKey(state.lastBackup).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
    : 'No backup yet.';
  $('#sync-repo').value = sync.repo || '';
  renderSync();
}

const backupJson = () => JSON.stringify({ app: 'habits', version: 1, exportedAt: new Date().toISOString(), habits: state.habits }, null, 2);

function exportBackup() {
  const stamp = keyOf(today());
  const file = new File([backupJson()], `habits-backup-${stamp}.json`, { type: 'application/json' });
  const done = () => { state.lastBackup = stamp; save(); renderSettings(); toast('Backup exported'); };
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).then(done, err => { if (err.name !== 'AbortError') toast('Export failed'); });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  done();
}

async function importBackup(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { toast('That file is too large to be a backup.'); return; }
  let data = null;
  try { data = sanitize(JSON.parse(await f.text())); } catch { data = null; }
  if (!data) { toast("That file isn't a Habits backup."); return; }
  replaceHabits(data.habits, 'this backup');
}

function replaceHabits(habits, source) {
  if (!confirm(`Replace your ${state.habits.length} habits with the ${habits.length} in ${source}?`)) return false;
  state.habits = habits;
  save();
  $('#settings').close();
  renderAll();
  toast(`Imported ${habits.length} habits`);
  return true;
}

const toBase64 = s => { let b = ''; for (const x of new TextEncoder().encode(s)) b += String.fromCharCode(x); return btoa(b); };
const fromBase64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
const errText = err => err instanceof TypeError ? 'Offline. Will retry.' : err.message;
const syncMsg = status => status === 401 ? 'Token is invalid or expired.'
  : status === 403 || status === 404 ? "Token can't write to that repo."
  : `GitHub error ${status}.`;

function ghFile(method, body) {
  return fetch(`https://api.github.com/repos/${sync.repo}/contents/${SYNC_FILE}`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
}

async function getRemote() {
  const res = await ghFile('GET');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(syncMsg(res.status));
  const file = await res.json();
  let data = null;
  try { data = sanitize(JSON.parse(fromBase64(file.content))); } catch { data = null; }
  return { sha: file.sha, data };
}

let syncTimer = 0;
let syncing = null;

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushBackup, 4000);
}

function pushBackup() {
  clearTimeout(syncTimer);
  if (syncing || !sync.token || !sync.dirty || !state.habits.length) return syncing || Promise.resolve();
  sync.dirty = false;
  const body = { message: `Backup ${new Date().toISOString()}`, content: toBase64(backupJson()) };
  syncing = (async () => {
    let res = await ghFile('PUT', { ...body, sha: sync.sha || undefined });
    if (res.status === 409 || res.status === 422) res = await ghFile('PUT', { ...body, sha: (await getRemote())?.sha });
    if (!res.ok) throw new Error(syncMsg(res.status));
    sync.sha = (await res.json()).content.sha;
    sync.at = new Date().toISOString();
    sync.error = null;
  })().catch(err => {
    sync.dirty = true;
    sync.error = errText(err);
    if (!(err instanceof TypeError)) toast('GitHub backup failed. Check Settings.');
  }).finally(() => {
    syncing = null;
    saveSync();
    renderSync();
    if (sync.dirty && !sync.error) scheduleSync();
  });
  return syncing;
}

function renderSync() {
  $('#sync-token').placeholder = sync.token ? 'Saved. Paste a new one to replace it.' : 'github_pat_…';
  $('#sync-status').textContent = !sync.token ? 'Not connected.'
    : sync.error ? `Last try failed. ${sync.error}`
    : sync.at ? `Last GitHub backup: ${new Date(sync.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : 'Connected. Waiting for a change to back up.';
}

function restoreFrom(remote) {
  if (!replaceHabits(remote.data.habits, 'the GitHub backup')) return;
  clearTimeout(syncTimer);
  Object.assign(sync, { sha: remote.sha, dirty: false, error: null });
  saveSync();
}

async function connectSync() {
  const repo = $('#sync-repo').value.trim();
  const token = $('#sync-token').value.trim() || sync.token;
  if (!REPO_RE.test(repo) || !token) { toast('Enter the repo as username/repo and paste a token.'); return; }
  sync = { repo, token };
  saveSync();
  $('#sync-token').value = '';
  try {
    const remote = await getRemote();
    sync.sha = remote && remote.sha;
    if (!state.habits.length && remote && remote.data && remote.data.habits.length) { restoreFrom(remote); return; }
  } catch (err) {
    sync.error = errText(err);
    saveSync();
    renderSync();
    return;
  }
  sync.dirty = true;
  await pushBackup();
  if (!sync.error) toast(state.habits.length ? 'Backed up to GitHub' : 'Connected');
}

async function restoreSync() {
  if (!sync.token) { toast('Connect a repo first.'); return; }
  let remote = null;
  try { remote = await getRemote(); } catch (err) { toast(errText(err)); return; }
  if (!remote || !remote.data) { toast('No backup found on GitHub.'); return; }
  restoreFrom(remote);
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function setView(v) {
  ui.view = v;
  localStorage.setItem(VIEW_KEY, v);
  renderHome();
}

function init() {
  for (const el of document.querySelectorAll('[data-icon]')) el.prepend(icon(el.dataset.icon));
  for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', () => el.closest('dialog').close());
  $('#detail').addEventListener('close', () => { ui.detailId = null; });
  $('#open-new').addEventListener('click', () => openEdit(null));
  $('#detail-edit').addEventListener('click', () => openEdit(ui.detailId));
  $('#open-settings').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
  $('#view-grid').addEventListener('click', () => setView('grid'));
  $('#view-list').addEventListener('click', () => setView('list'));
  $('#edit-form').addEventListener('submit', saveEdit);
  $('#export').addEventListener('click', exportBackup);
  $('#import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importBackup);
  $('#sync-connect').addEventListener('click', connectSync);
  $('#sync-restore').addEventListener('click', restoreSync);
  window.addEventListener('online', pushBackup);

  let resizeTimer = 0;
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderHome, 150);
  });
  let dayKey = keyOf(today());
  const checkDay = () => { const k = keyOf(today()); if (k !== dayKey) { dayKey = k; renderAll(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); pushBackup(); });
  setInterval(checkDay, 30000);

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  renderHome();
  pushBackup();
}

init();

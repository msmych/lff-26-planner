/* LFF 2026 Planner — vanilla JS, no build step */

const VENUE_COLORS = {
  'BFI Southbank': '#3b82f6',
  'BFI IMAX': '#a855f7',
  'Southbank Centre': '#f43f5e',
  'Curzon Soho': '#22c55e',
  'Vue West End': '#f97316',
  'ICA': '#06b6d4',
  'Prince Charles Cinema': '#eab308',
};
const DEFAULT_COLOR = '#6b7280';
const HOUR_H = 60; // px per hour
const HEAD_H = 36; // day header height
const GUTTER_W = 52;
const MIN_CARD_H = 50;
const MIN_DAY_W = 180;
const MIN_LANE_W = 110; // px per concurrent-lane
const MAX_CARD_W = 300;
const TIGHT_GAP_MIN = 30; // min minutes to travel between venues

const state = {
  screenings: [],
  hiddenVenues: new Set(JSON.parse(localStorage.getItem('lff26-hidden-venues') || '[]')),
  hiddenIds: new Set(JSON.parse(localStorage.getItem('lff26-hidden-screenings') || '[]')),
  selected: new Set(JSON.parse(localStorage.getItem('lff26-plan') || '[]')),
  festivalDays: [],
  dayPos: [], // [{ day, x, w }] — column offsets inside #calendar, for the day-nav
};

function mainVenue(venueName) {
  if (/southbank centre/i.test(venueName)) return 'Southbank Centre';
  let v = venueName.replace(/^((LFF\s+)?2026\s+)?(LFF\s+)?/i, '').trim();
  if (/^ICA\b/i.test(v)) return 'ICA';
  v = v.split(/,| - /)[0];
  if (/^(curzon|vue)/i.test(v)) v = v.replace(/\s+Cinema$/i, '');
  return v.trim();
}

function venueColor(v) {
  return VENUE_COLORS[v] || DEFAULT_COLOR;
}

function parseStart(iso) {
  // "2026-10-14T19:45" -> { day: "2026-10-14", minutes: 1185 }
  const [date, time] = iso.split('T');
  const [h, m] = time.split(':').map(Number);
  return { day: date, minutes: h * 60 + m };
}

function fmtTime(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

function endTime(s) {
  return parseStart(s.start).minutes + s.durationMin;
}

function fmtEnd(end) {
  return fmtTime(end >= 24 * 60 ? end - 24 * 60 : end);
}

function groupByDay(list) {
  const byDay = new Map();
  list.forEach(s => {
    const d = parseStart(s.start).day;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  });
  return byDay;
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()];
  return { dow, dnum: d };
}

/* ---- conflict & gap analysis among selected screenings ---- */
function analyseSelection() {
  const sel = state.screenings.filter(s => state.selected.has(s.id));
  const status = new Map(); // id -> {overlap: bool, tight: bool}
  sel.forEach(s => status.set(s.id, { overlap: false, tight: false }));
  const warnings = [];

  const byDay = groupByDay(sel);

  for (const [, list] of byDay) {
    list.sort((a, b) => parseStart(a.start).minutes - parseStart(b.start).minutes);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const aS = parseStart(a.start).minutes;
      const aE = endTime(a);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const bS = parseStart(b.start).minutes;
        if (bS >= aE) {
          const gap = bS - aE;
          if (gap < TIGHT_GAP_MIN && mainVenue(a.venue) !== mainVenue(b.venue)) {
            status.get(a.id).tight = true;
            status.get(b.id).tight = true;
            warnings.push({
              type: 'tight',
              text: `Only ${gap} min between “${a.title}” (${a.venue}) and “${b.title}” (${b.venue}) — different venues.`,
            });
          }
          break;
        }
        // overlap
        const overlap = Math.min(aE, bS + b.durationMin) - bS;
        status.get(a.id).overlap = true;
        status.get(b.id).overlap = true;
        warnings.push({
          type: 'overlap',
          text: `“${a.title}” and “${b.title}” overlap by ${overlap} min.`,
        });
      }
    }
  }
  return { selected: sel, status, warnings };
}

/* ---- lane layout so overlapping cards don't cover each other ---- */
function layoutDay(screenings) {
  const items = screenings
    .map(s => ({ s, start: parseStart(s.start).minutes, end: endTime(s) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const clusters = [];
  let cur = null;
  let curEnd = -1;
  for (const it of items) {
    if (cur && it.start >= curEnd) {
      clusters.push(cur);
      cur = null;
    }
    if (!cur) cur = [];
    cur.push(it);
    curEnd = Math.max(curEnd, it.end);
  }
  if (cur) clusters.push(cur);

  const placed = new Map();
  for (const cluster of clusters) {
    const lanes = []; // lane -> end time
    const assign = new Map();
    for (const it of cluster) {
      let lane = lanes.findIndex(e => e <= it.start);
      if (lane === -1) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = it.end;
      assign.set(it.s.id, lane);
    }
    const n = lanes.length;
    for (const [id, lane] of assign) {
      placed.set(id, { lane, lanes: n });
    }
  }
  return placed;
}

/* ---- rendering ---- */

/* mini-map strip above the calendar: one cell per day, flex-sized proportionally
   to the calendar column, with a venue-coloured tick per visible screening */
function renderDayNav(dayData, tMin, tMax) {
  const nav = document.getElementById('day-nav');
  nav.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);
  const span = Math.max(1, tMax - tMin);

  state.festivalDays.forEach((d, i) => {
    const dd = dayData[i];
    const cell = document.createElement('div');
    cell.className = 'dn-cell' + (d === today ? ' today' : '');
    cell.style.flexGrow = dd.width;
    const { dow, dnum } = dayLabel(d);
    cell.innerHTML = `<div class="dn-label"><span class="dn-dow">${dow}</span><span class="dn-dnum">${dnum}</span></div>`;

    const ticks = document.createElement('div');
    ticks.className = 'dn-ticks';
    for (const s of dd.list) {
      const p = dd.lanes.get(s.id);
      const tick = document.createElement('div');
      tick.className = 'dn-tick' + (state.selected.has(s.id) ? ' sel' : '');
      tick.style.background = venueColor(mainVenue(s.venue));
      tick.style.top = ((parseStart(s.start).minutes - tMin) / span) * 100 + '%';
      tick.style.left = (p.lane / p.lanes) * 100 + '%';
      tick.title = `${fmtTime(parseStart(s.start).minutes)} · ${s.title}`;
      ticks.appendChild(tick);
    }
    cell.appendChild(ticks);

    cell.onclick = () => {
      const wrap = document.getElementById('calendar-wrap');
      const pos = state.dayPos[i];
      wrap.scrollTo({
        left: Math.max(0, pos.x - (wrap.clientWidth - GUTTER_W - pos.w) / 2),
        behavior: 'smooth',
      });
    };
    nav.appendChild(cell);
  });
  updateDayNavActive();
}

function updateDayNavActive() {
  const wrap = document.getElementById('calendar-wrap');
  const cells = document.querySelectorAll('#day-nav .dn-cell');
  const center = wrap.scrollLeft + wrap.clientWidth / 2;
  let best = 0, bestDist = Infinity;
  state.dayPos.forEach((p, i) => {
    const dist = Math.abs(p.x + p.w / 2 - center);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  cells.forEach((c, i) => c.classList.toggle('active', i === best));
}

function renderLegend(venues) {
  const el = document.getElementById('venue-legend');
  el.innerHTML = '';
  venues.forEach(v => {
    const chip = document.createElement('div');
    chip.className = 'venue-chip' + (state.hiddenVenues.has(v) ? ' off' : '');
    chip.innerHTML = `<span class="dot" style="background:${venueColor(v)}"></span>${v}`;
    chip.onclick = () => {
      if (state.hiddenVenues.has(v)) state.hiddenVenues.delete(v);
      else state.hiddenVenues.add(v);
      localStorage.setItem('lff26-hidden-venues', JSON.stringify([...state.hiddenVenues]));
      render();
    };
    el.appendChild(chip);
  });
}

function renderCalendar() {
  const cal = document.getElementById('calendar');
  const days = state.festivalDays;
  cal.innerHTML = '';

  const visible = state.screenings.filter(s =>
    !state.hiddenVenues.has(mainVenue(s.venue)) && !state.hiddenIds.has(s.id));
  const allStarts = visible.map(s => parseStart(s.start).minutes);
  const allEnds = visible.map(endTime);
  const tMin = Math.min(8 * 60, ...(allStarts.length ? allStarts : [9 * 60]));
  const tMax = Math.max(23 * 60, ...(allEnds.length ? allEnds : [23 * 60]));
  const px = min => ((min - tMin) / 60) * HOUR_H;

  // per-day: screenings, lane layout, column width sized for max concurrent lanes
  const dayData = days.map(d => {
    const list = visible.filter(s => parseStart(s.start).day === d);
    const lanes = layoutDay(list);
    const maxLanes = list.length ? Math.max(...[...lanes.values()].map(p => p.lanes)) : 1;
    return { list, lanes, width: Math.max(MIN_DAY_W, maxLanes * MIN_LANE_W) };
  });

  // absolute layout: #calendar is a positioned block of fixed size; day columns
  // are absolutely placed, the time gutter is an in-flow sticky child (so its
  // sticky range covers the full width) with an inner sticky corner.
  cal.style.position = 'relative';
  cal.style.width = GUTTER_W + dayData.reduce((a, dd) => a + dd.width, 0) + 'px';
  cal.style.height = HEAD_H + px(tMax) + 40 + 'px';

  const today = new Date().toISOString().slice(0, 10);
  const { status } = analyseSelection();

  // day columns
  state.dayPos = [];
  let x = GUTTER_W;
  days.forEach((d, i) => {
    const dd = dayData[i];
    const col = document.createElement('div');
    col.className = 'grid-col';
    col.style.left = x + 'px';
    col.style.width = dd.width + 'px';
    state.dayPos.push({ day: d, x, w: dd.width });
    x += dd.width;
    const head = document.createElement('div');
    const { dow, dnum } = dayLabel(d);
    head.className = 'day-head' + (d === today ? ' today' : '');
    head.innerHTML = `<span class="dow">${dow}</span><span class="dnum">${dnum}</span>`;
    col.appendChild(head);
    for (let m = Math.ceil(tMin / 60) * 60; m <= tMax; m += 60) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = HEAD_H + px(m) + 'px';
      col.appendChild(line);
    }
    for (const s of dd.list) {
      col.appendChild(renderCard(s, dd.lanes.get(s.id), dd.width, tMin, status.get(s.id)));
    }
    cal.appendChild(col);
  });

  // time gutter: in-flow child of the full-width calendar, so sticky left: 0
  // keeps it pinned for the whole horizontal scroll
  const gutter = document.createElement('div');
  gutter.className = 'gutter';
  const corner = document.createElement('div');
  corner.className = 'corner';
  gutter.appendChild(corner);
  for (let m = Math.ceil(tMin / 60) * 60; m <= tMax; m += 60) {
    const l = document.createElement('div');
    l.className = 'time-label';
    l.style.top = HEAD_H + px(m) + 'px';
    l.textContent = fmtTime(m === 24 * 60 ? 0 : m);
    gutter.appendChild(l);
  }
  cal.appendChild(gutter);

  renderDayNav(dayData, tMin, tMax);
}

function renderCard(s, laneInfo, dayWidth, tMin, st) {
  const start = parseStart(s.start).minutes;
  const end = endTime(s);
  const el = document.createElement('div');
  const venue = mainVenue(s.venue);
  const color = venueColor(venue);
  const selected = state.selected.has(s.id);

  el.className = 'card' + (selected ? ' selected' : '');
  if (st && selected) {
    if (st.overlap) el.classList.add('conflict');
    else if (st.tight) el.classList.add('tight');
  }
  el.style.setProperty('--accent', color);
  el.style.borderColor = color;
  el.style.color = selected ? color : 'var(--text)';
  el.style.background = selected
    ? `color-mix(in srgb, ${color} 22%, #191c23)`
    : `color-mix(in srgb, ${color} 7%, #191c23)`;

  const top = HEAD_H + ((start - tMin) / 60) * HOUR_H;
  const h = Math.max(((end - start) / 60) * HOUR_H - 2, MIN_CARD_H);
  el.style.top = top + 'px';
  el.style.height = h + 'px';
  const laneW = dayWidth / laneInfo.lanes;
  el.style.left = laneInfo.lane * laneW + 1 + 'px';
  el.style.width = Math.min(laneW - 2, MAX_CARD_W) + 'px';

  const endMinus1 = fmtEnd(end);
  // title first; secondary lines only if the card is tall enough for them
  el.innerHTML = `
    <div class="title">${escapeHtml(s.title)}</div>
    ${h >= 66 ? `<div class="meta">${fmtTime(start)} – ${endMinus1} · ${escapeHtml(s.venue)}</div>` : ''}
    ${h >= 96 && s.strand ? `<div class="strand">${escapeHtml(s.strand)}</div>` : ''}`;
  el.title = 'Click for details · checkbox adds to plan';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'check';
  check.checked = selected;
  check.title = 'Add to my plan';
  check.onclick = e => { e.stopPropagation(); toggle(s.id); };
  el.appendChild(check);

  const ext = document.createElement('a');
  ext.className = 'ext';
  ext.href = s.url;
  ext.target = '_blank';
  ext.textContent = '↗';
  ext.title = 'Open on BFI site';
  ext.onclick = e => e.stopPropagation();
  el.appendChild(ext);

  el.onclick = () => openMovieDetails(s.title);
  return el;
}

function toggle(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  localStorage.setItem('lff26-plan', JSON.stringify([...state.selected]));
  render();
}

function hideScreening(id) {
  state.hiddenIds.add(id);
  localStorage.setItem('lff26-hidden-screenings', JSON.stringify([...state.hiddenIds]));
  render();
}

function unhideScreening(id) {
  state.hiddenIds.delete(id);
  localStorage.setItem('lff26-hidden-screenings', JSON.stringify([...state.hiddenIds]));
  render();
}

function renderPlanPanel() {
  const { selected, warnings } = analyseSelection();
  const stats = document.getElementById('stats');
  const warnEl = document.getElementById('warnings');
  const listEl = document.getElementById('plan-list');

  stats.textContent = `${selected.length} screening${selected.length === 1 ? '' : 's'} in my plan` +
    (warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '');

  warnEl.innerHTML = '';
  warnings.slice(0, 12).forEach(w => {
    const d = document.createElement('div');
    d.className = 'warning-item ' + w.type;
    d.textContent = w.text;
    warnEl.appendChild(d);
  });

  listEl.innerHTML = '';
  if (!selected.length) {
    listEl.innerHTML = '<div class="empty-hint">Tick screenings on the calendar to build your plan. Click a card for details; the checkbox adds it to your plan. Hidden screenings land in the bin below and can be restored.</div>';
    return;
  }
  const byDay = groupByDay(selected);
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { dow, dnum } = dayLabel(day);
    const wrap = document.createElement('div');
    wrap.className = 'plan-day';
    wrap.innerHTML = `<h3>${dow} ${dnum} Oct</h3>`;
list.sort((a, b) => a.start.localeCompare(b.start));
    list.forEach(s => {
      const start = parseStart(s.start).minutes;
      const item = document.createElement('div');
      item.className = 'plan-item';
      item.style.borderColor = venueColor(mainVenue(s.venue));
      item.innerHTML = `<span class="time">${fmtTime(start)}</span>
        <span><span class="t">${escapeHtml(s.title)}</span><span class="v">${escapeHtml(s.venue)}</span></span>
        <button class="plan-remove" title="Remove from my plan">✕</button>`;
      item.title = 'Click for details';
      item.onclick = e => {
        if (e.target.classList.contains('plan-remove')) {
          toggle(s.id);
          return;
        }
        openMovieDetails(s.title);
      };
      const entry = document.createElement('div');
      entry.className = 'plan-entry';
      entry.appendChild(item);
      wrap.appendChild(entry);
    });
    listEl.appendChild(wrap);
  }
}

function renderHiddenBin() {
  const el = document.getElementById('hidden-bin');
  el.innerHTML = '';
  if (!state.hiddenIds.size) return;
  el.innerHTML = `<h2>Hidden screenings <span class="bin-count">${state.hiddenIds.size}</span></h2>`;
  const all = document.createElement('button');
  all.className = 'btn bin-clear';
  all.textContent = 'Unhide all';
  all.onclick = () => {
    state.hiddenIds.clear();
    localStorage.setItem('lff26-hidden-screenings', '[]');
    render();
  };
  el.appendChild(all);
  const byId = new Map(state.screenings.map(s => [s.id, s]));
  const hidden = [...state.hiddenIds]
    .map(id => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => a.start.localeCompare(b.start));
  hidden.forEach(s => {
    const item = document.createElement('div');
    item.className = 'hidden-item';
    const { dow, dnum } = dayLabel(parseStart(s.start).day);
    item.innerHTML = `<span class="when">${dow} ${dnum} ${fmtTime(parseStart(s.start).minutes)}</span>
      <span class="t">${escapeHtml(s.title)}</span>
      <span class="n">${escapeHtml(s.venue)}</span> <span class="undo">restore</span>`;
    item.title = 'Click to bring back';
    item.onclick = () => unhideScreening(s.id);
    el.appendChild(item);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---- overlay (export / help) ---- */
const overlay = () => document.getElementById('overlay');
const sheet = () => document.getElementById('overlay-sheet');

function openOverlay() {
  const el = sheet();
  if (!document.getElementById('sheet-close')) {
    const x = document.createElement('button');
    x.id = 'sheet-close';
    x.className = 'sheet-close no-print';
    x.textContent = '✕';
    x.title = 'Close (Esc)';
    x.onclick = closeOverlay;
    el.appendChild(x);
  }
  overlay().classList.remove('hidden');
}
function closeOverlay() {
  overlay().classList.add('hidden');
}

function stateJson() {
  return JSON.stringify({
    app: 'lff-26',
    plan: [...state.selected].sort(),
    hiddenScreenings: [...state.hiddenIds].sort(),
    hiddenVenues: [...state.hiddenVenues].sort(),
  }, null, 2);
}

function downloadJson() {
  const blob = new Blob([stateJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lff-plan.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  file.text()
    .then(text => {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.plan)) throw new Error('no "plan" array');
      const validIds = new Set(state.screenings.map(s => s.id));
      const validVenues = new Set(state.screenings.map(s => mainVenue(s.venue)));
      state.selected = new Set(data.plan.filter(id => validIds.has(id)));
      if (Array.isArray(data.hiddenScreenings)) {
        state.hiddenIds = new Set(data.hiddenScreenings.filter(id => validIds.has(id)));
      }
      if (Array.isArray(data.hiddenVenues)) {
        state.hiddenVenues = new Set(data.hiddenVenues.filter(v => validVenues.has(v)));
      }
      localStorage.setItem('lff26-plan', JSON.stringify([...state.selected]));
      localStorage.setItem('lff26-hidden-screenings', JSON.stringify([...state.hiddenIds]));
      localStorage.setItem('lff26-hidden-venues', JSON.stringify([...state.hiddenVenues]));
      render();
    })
    .catch(e => alert('Could not import plan: ' + e.message));
}

function openExport() {
  const { selected, warnings } = analyseSelection();
  const el = sheet();
  el.innerHTML = '';

  const h = document.createElement('h2');
  h.textContent = 'LFF 2026 — my plan';
  el.appendChild(h);
  const sub = document.createElement('p');
  sub.className = 'sheet-sub';
  sub.textContent = `${selected.length} screening${selected.length === 1 ? '' : 's'} · 7–18 October 2026`;
  el.appendChild(sub);

  const actions = document.createElement('div');
  actions.className = 'sheet-actions no-print';
  for (const [label, fn] of [
    ['Print', () => window.print()],
    ['Download JSON', downloadJson],
  ]) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.onclick = fn;
    actions.appendChild(b);
  }
  el.appendChild(actions);

  if (!selected.length) {
    const p = document.createElement('p');
    p.textContent = 'Nothing selected yet — tick some screenings first.';
    el.appendChild(p);
    openOverlay();
    return;
  }

  const warnBox = document.createElement('div');
  warnings.forEach(w => {
    const d = document.createElement('div');
    d.className = 'warning-item ' + w.type;
    d.textContent = w.text;
    warnBox.appendChild(d);
  });
  if (warnings.length) el.appendChild(warnBox);

  const byDay = groupByDay(selected);
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { dow, dnum } = dayLabel(day);
    const dayEl = document.createElement('div');
    dayEl.className = 'sheet-day';
    dayEl.innerHTML = `<h3>${dow} ${dnum} Oct</h3>`;
    list.sort((a, b) => a.start.localeCompare(b.start));
    list.forEach(s => {
      const start = parseStart(s.start).minutes;
      const item = document.createElement('div');
      item.className = 'sheet-item';
      item.innerHTML = `
        <span class="time">${fmtTime(start)}–${fmtEnd(endTime(s))}</span>
        <span class="body">
          <span class="t">${escapeHtml(s.title)}</span>
          <span class="v">${escapeHtml(s.venue)}${s.strand ? ` · ${escapeHtml(s.strand)}` : ''}</span>
        </span>`;
      dayEl.appendChild(item);
    });
    el.appendChild(dayEl);
  }
  openOverlay();
}

/* ---- movie details (grouped by title, opens on card/plan click) ---- */
function openMovieDetails(title) {
  const showings = state.screenings
    .filter(s => s.title === title)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!showings.length) return;
  const el = sheet();
  const first = showings[0];
  const priceLo = Math.min(...showings.map(s => parseFloat(String(s.priceMin || '').replace('£', ''))).filter(Number.isFinite));
  const priceHi = Math.max(...showings.map(s => parseFloat(String(s.priceMax || '').replace('£', ''))).filter(Number.isFinite));
  const price = Number.isFinite(priceLo) ? ` · £${priceLo}${priceHi > priceLo ? `–£${priceHi}` : ''}` : '';

  el.innerHTML = `
    <h2>${escapeHtml(title)}</h2>
    ${first.tagline ? `<p class="sheet-tagline">${escapeHtml(first.tagline)}</p>` : ''}
    <p class="sheet-sub">${showings.length} screening${showings.length === 1 ? '' : 's'} · ${first.durationMin} min${first.strand ? ` · ${escapeHtml(first.strand)}` : ''}${price}</p>
    <div class="sheet-actions no-print">
      <button id="mv-hide-others" class="btn">Hide others</button>
      <a class="btn" href="${first.url}" target="_blank" title="Open this film on the BFI site">BFI ↗</a>
    </div>`;

  showings.forEach(s => {
    const start = parseStart(s.start).minutes;
    const { dow, dnum } = dayLabel(parseStart(s.start).day);
    const inPlan = state.selected.has(s.id);
    const isHidden = state.hiddenIds.has(s.id);
    const row = document.createElement('div');
    row.className = 'mv-row' + (inPlan ? ' sel' : '') + (isHidden ? ' is-hidden' : '');
    row.innerHTML = `
      <input type="checkbox" class="mv-check" ${inPlan ? 'checked' : ''} title="Add to / remove from my plan">
      <span class="when">${dow} ${dnum} Oct · ${fmtTime(start)}–${fmtEnd(endTime(s))}</span>
      <span class="venue">${escapeHtml(s.venue)}</span>`;

    const hideBtn = document.createElement('button');
    hideBtn.className = 'btn mv-hide';
    hideBtn.textContent = isHidden ? 'restore' : 'hide';
    hideBtn.title = isHidden ? 'Bring this screening back to the calendar' : 'Hide this screening from the calendar';
    if (inPlan && !isHidden) {
      hideBtn.disabled = true;
      hideBtn.title = 'In your plan — remove it first';
    } else {
      hideBtn.onclick = () => {
        if (isHidden) unhideScreening(s.id); else hideScreening(s.id);
        openMovieDetails(title);
      };
    }
    row.appendChild(hideBtn);

    row.querySelector('.mv-check').onchange = () => { toggle(s.id); openMovieDetails(title); };
    el.appendChild(row);
  });

  const hideBtnTop = document.getElementById('mv-hide-others');
  const anySelected = showings.some(s => state.selected.has(s.id));
  const hideAll = !anySelected;
  const anythingToHide = showings.some(s => !state.hiddenIds.has(s.id) &&
    (hideAll || !state.selected.has(s.id)));
  hideBtnTop.textContent = hideAll ? 'Hide all' : 'Hide others';
  if (!anythingToHide) {
    hideBtnTop.disabled = true;
    hideBtnTop.title = hideAll ? 'All screenings are already hidden' : 'Nothing to hide — all other screenings are already hidden';
  } else {
    hideBtnTop.title = hideAll
      ? 'Hide all screenings of this film'
      : 'Hide every screening of this film that is not in my plan';
  }
  hideBtnTop.onclick = () => {
    let changed = false;
    showings.forEach(s => {
      if (!state.hiddenIds.has(s.id) && (hideAll || !state.selected.has(s.id))) {
        state.hiddenIds.add(s.id);
        changed = true;
      }
    });
    if (changed) {
      localStorage.setItem('lff26-hidden-screenings', JSON.stringify([...state.hiddenIds]));
      render();
      openMovieDetails(title);
    }
  };
  openOverlay();
}

function openHelp() {
  const el = sheet();
  el.innerHTML = `
    <h2>LFF 2026 Planner</h2>
    <p class="sheet-sub">All BFI London Film Festival 2026 screenings (7–18 October) on one calendar:
    cards sit at their start time, are sized by runtime, and colour-coded by venue.</p>
    <h3>Calendar</h3>
    <ul>
      <li>All 12 festival days on one calendar. Days are columns, sized to fit their
      busiest overlap — the calendar scrolls horizontally when needed.</li>
      <li>The strip above the calendar is a map of the whole festival: one cell per
      day with a tick for every screening (coloured by venue; your picks are
      brighter). Click a day to scroll to it — the cell nearest the middle of the
      view stays highlighted.</li>
      <li>Click a venue chip in the legend to show/hide that venue's screenings.</li>
      <li><b>Click a card</b> to open the film's details: its synopsis, every
      screening of that film with a checkbox (add/remove from plan) and a
      hide/restore button. The <b>BFI ↗</b> link opens the film on the BFI site to
      book. <b>Hide others</b> hides all the film's screenings that aren't in your
      plan; <b>Hide all</b> hides every screening of the film — handy for
      decluttering repeats.</li>
      <li>Hidden screenings can be recovered from the “Hidden screenings” bin
      in the side panel.</li>
      <li>The <b>↗</b> on a card opens the screening on the BFI site to book.</li>
    </ul>
    <h3>Plan</h3>
    <ul>
      <li>Your plan is saved in the browser (localStorage) — it survives reloads and server restarts.</li>
      <li>Overlapping picks are outlined red; tight transfers between different venues
      (&lt; 30 min gap) are orange.</li>
      <li>Plan entries open the same film details popup — manage or remove picks from there.</li>
      <li><b>Export</b> prints your plan or downloads it as JSON (including hidden
      screenings and venues). <b>Import</b> loads such a file — useful for moving
      your plan between browsers or sharing it.</li>
      <li>The <b>»</b> button hides the sidebar for a full-screen calendar —
      bring it back with the <b>« Sidebar</b> button in the header.</li>
    </ul>
    <p class="sheet-sub" style="margin-top:16px">Feedback: <a href="https://t.me/msmych" target="_blank">t.me/msmych</a></p>`;
  openOverlay();
}

function render() {
  const wrap = document.getElementById('calendar-wrap');
  const { scrollLeft, scrollTop } = wrap;
  const venues = [...new Set(state.screenings.map(s => mainVenue(s.venue)))].sort();
  renderLegend(venues);
  renderCalendar();
  renderPlanPanel();
  renderHiddenBin();
  wrap.scrollLeft = scrollLeft;
  wrap.scrollTop = scrollTop;
  updateDayNavActive();
}

async function init() {
  localStorage.removeItem('lff26-hidden-films'); // old per-film hide key, no longer used
  const res = await fetch('data/screenings.json');
  const data = await res.json();
  state.screenings = data.screenings;
  state.festivalDays = data.festivalDays;

  document.getElementById('clear-plan').onclick = () => {
    if (!state.selected.size) return;
    if (!confirm('Remove all screenings from your plan?')) return;
    state.selected.clear();
    localStorage.setItem('lff26-plan', '[]');
    render();
  };
  document.getElementById('export-plan').onclick = openExport;
  document.getElementById('import-plan').onclick = () =>
    document.getElementById('import-file').click();
  document.getElementById('import-file').onchange = e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  };
  document.getElementById('show-help').onclick = openHelp;
  document.getElementById('overlay').onclick = e => {
    if (e.target === e.currentTarget) closeOverlay();
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeOverlay();
  });

  document.getElementById('toggle-plan').onclick = () => {
    document.body.classList.add('plan-hidden');
  };
  document.getElementById('show-sidebar').onclick = () => {
    document.body.classList.remove('plan-hidden');
  };
  document.getElementById('calendar-wrap').addEventListener('scroll', () => {
    requestAnimationFrame(updateDayNavActive);
  });
  render();
}

init();

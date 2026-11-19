// Research network: each paper is a point, a ring-shaped pie of its disciplines' colours (secondary
// disciplines, i.e. methods and side themes, in fainter slices); each discipline is a labelled hub,
// linked to its papers. Data: content/papers.json. Uses d3 (force layout only).
//
// Layout (computed when the page opens, deterministic, about 0.2 s), in two passes:
// 1. papers and main disciplines only:
//    - papers are pulled towards their disciplines' hubs, and each hub towards the middle of its
//      papers, so its links fan out around it like a star;
//    - papers with more disciplines sit closer to the centre, with enough room around each of them
//      for the core not to be cluttered;
//    - when two links leaving a node run on top of each other, that node is nudged off their line;
//    - a few deterministic starts are tried; the one with the fewest crossing/overlapping links is kept;
// 2. secondary disciplines ("secondary": true in papers.json) are then spread around that picture,
//    which stays fixed, each on the side of its papers. They are shown with the "Add secondary
//    fields" toggle (off by default).
// Positions saved in content/network-layout.json (made with the edit mode below) override both
// passes for the papers and disciplines they list; anything not listed is placed around them.
//
// Private tools (not shown to visitors):
// - research.html?edit  "Network edit mode": drag papers and disciplines (secondary ones too, with
//                       "Add secondary fields" on), then copy or download every position as
//                       content/network-layout.json (?edit&fresh starts from the computed layout)
// - research.html?pdf   "Export PDF" button (the view on screen, with or without secondary fields)

// Discipline colours (light / dark). Identity is never colour-alone: every hub is labelled.
const DISC_COLORS = {
  pp:     ["#e03131", "#ff6b6b"],
  data:   ["#15aabf", "#99e9f2"],
  model:  ["#9c6644", "#d8b08c"],
  ct:     ["#f76707", "#ff922b"],
  net:    ["#20c997", "#38d9a9"],
  cb:     ["#1971c2", "#339af0"],
  hum:    ["#7048e8", "#9775fa"],
  games:  ["#f2b705", "#ffd43b"],
  eco:    ["#3b6e2b", "#5c9a3f"],
  gt:     ["#f783ac", "#fcc2d7"],
  ai:     ["#94d82d", "#d8f5a2"],
  soc:    ["#9c36b5", "#be4bdb"],
  pol:    ["#748ffc", "#bac8ff"],
  risk:   ["#a61e4d", "#c2255c"],
};
const FALLBACK_COLOR = ["#898781", "#898781"];

// a discipline colour made dark (light theme) or light (dark theme) enough to be read as text
function readable(hex, theme) {
  const ch = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const bg = lum(ch(theme.surface.length === 7 ? theme.surface : theme.dark ? "#000000" : "#ffffff"));
  const to = theme.dark ? 255 : 0, c0 = ch(hex);
  for (let t = 0; t <= 1; t += 0.05) {
    const c = c0.map(v => Math.round(v + (to - v) * t)), l = lum(c);
    if ((Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05) >= 4.5) return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
  }
  return theme.ink;
}

const SUBMITTED = new Set(["published", "under review", "submitted", "accepted"]);
const STATUS_TEXT = {
  "published": "Published", "under review": "Submitted", "submitted": "Submitted", "accepted": "Accepted",
  "in preparation": "In preparation", "in progress": "In progress", "paused": "Paused",
};

const NET = {
  link: 110,         // paper-hub link length
  repelPaper: 70,    // repulsion between papers...
  repelK: 1,         // ...times (1 + repelK x (number of main disciplines - 1))
  repelHub: 220,     // repulsion between main hubs
  centre: 0.01,      // pull to the centre, per main discipline beyond the first
  fan: 16,           // two links from one node whose ends are closer than this (px) are pushed apart
  star: 0.25,        // pull of each main hub towards the middle of its papers
  space: 24,         // minimum clear space around each point / hub (more for interdisciplinary papers)
  ticks: 300, bottom: "pp",
  fieldFont: 13,     // font size of the main field names (secondary ones: 1px smaller)
  starts: 4,         // starting arrangements tried in pass 1 (all deterministic)
  ringGap: 60,       // pass 2: how far outside the main picture the secondary disciplines sit
};

/* ---------------- layout ---------------- */

// width of a text in the page font (falls back to an estimate)
let measureCtx = null;
function textWidth(str, size, weight = 400) {
  try {
    measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
    measureCtx.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`;
    return measureCtx.measureText(str).width;
  } catch (e) { return str.length * size * 0.58; }
}

// force: when two links leaving a node run on top of each other, move that node off the line through
// their other ends (only nodes accepted by `movable`; hubs carrying many links move less)
function fanForce(around, movable, gain = 1, reach = NET.fan) {
  return alpha => {
    for (const [c, ends] of around) {
      if (!movable(c)) continue;
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
        const A = ends[i], B = ends[j];
        const ax = A.x - c.x, ay = A.y - c.y, bx = B.x - c.x, by = B.y - c.y;
        const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
        const gap = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
        const apart = Math.min(la, lb) * Math.sin(Math.min(gap, Math.PI / 2));   // distance between the links at the shorter one's end
        if (gap > Math.PI / 2 || apart >= reach) continue;
        let nx = -(B.y - A.y), ny = B.x - A.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const side = nx * (c.x - A.x) + ny * (c.y - A.y) >= 0 ? 1 : -1;
        const f = (reach - apart) * (c.kind === "hub" && !c.secondary ? 0.15 : 0.4) * gain * alpha;
        c.vx += nx * side * f; c.vy += ny * side * f;
      }
    }
  };
}
const linksAround = (nodes, links) => {
  const m = new Map(nodes.map(n => [n, []]));
  links.forEach(l => { m.get(l.source).push(l.target); m.get(l.target).push(l.source); });
  return m;
};

function computeNetwork(data, saved = null) {
  const discs = data.disciplines.map((d, i) => ({ ...d, kind: "hub", order: i, count: 0 }));
  const idx = Object.fromEntries(discs.map((d, i) => [d.id, i]));
  const papers = data.works.map(w => ({
    ...w, kind: "paper",
    disc: (w.disciplines || []).filter(t => t in idx).sort((a, b) => idx[a] - idx[b]),   // fixed colour order
  }));
  papers.forEach(p => {
    p.disc.forEach(t => discs[idx[t]].count++);
    p.main = p.disc.filter(t => !discs[idx[t]].secondary);
    p.sec = p.disc.filter(t => discs[idx[t]].secondary);
    p.label = p.short || p.title;
    p.r = 7 + 3 * (p.weight || 1);
    p.showLabel = p.showLabel ?? (p.weight || 1) >= 2;
    p.bold = (p.weight || 1) >= 3;                       // main papers: bold title
    p.lw = p.showLabel ? textWidth(p.label, 12, p.bold ? 600 : 400) : 0;
  });
  discs.forEach(d => {
    d.fs = d.secondary ? NET.fieldFont - 1 : NET.fieldFont;
    d.tw = d.secondary ? textWidth(d.label, d.fs, 600) + 6 : textWidth(d.label, d.fs, 600) + 20;
    d.th = d.secondary ? d.fs + 5 : d.fs + 10;
  });

  const links = [];
  papers.forEach(p => p.disc.forEach(t => links.push({ source: p, target: discs[idx[t]], disc: t, secondary: !!discs[idx[t]].secondary })));
  const mainLinks = links.filter(l => !l.secondary), secLinks = links.filter(l => l.secondary);
  const core = discs.filter(d => !d.secondary), outer = discs.filter(d => d.secondary);
  const km = p => Math.max(1, p.main.length);

  /* pass 1: papers and main disciplines */
  const nodes1 = [...core, ...papers];
  const around1 = linksAround(nodes1, mainLinks);
  const key = n => (n.kind === "hub" ? "disc:" : "") + n.id;           // ids in network-layout.json
  const pos = (saved && saved.positions) || {};
  const pinned = nodes1.filter(n => pos[key(n)]);
  const run = coreOrder => {
    coreOrder.forEach((d, i) => { const a = (2 * Math.PI * i) / core.length; d.x = 130 * Math.cos(a); d.y = 95 * Math.sin(a); });
    papers.forEach((p, i) => {                       // each paper starts at the average of its main hubs
      const hs = (p.main.length ? p.main : p.disc).map(t => discs[idx[t]]).filter(h => !h.secondary);
      p.x = hs.reduce((s, h) => s + h.x, 0) / (hs.length || 1) + 8 * Math.cos(i * 2.4);
      p.y = hs.reduce((s, h) => s + h.y, 0) / (hs.length || 1) + 8 * Math.sin(i * 2.4);
    });
    pinned.forEach(n => { [n.x, n.y] = pos[key(n)]; n.fx = n.x; n.fy = n.y; });   // saved positions stay put
    nodes1.forEach(n => { n.vx = n.vy = 0; });
    const sim = d3.forceSimulation(nodes1)
      .force("link", d3.forceLink(mainLinks).distance(l => NET.link + 4 * km(l.source)).strength(l => 0.9 / Math.sqrt(km(l.source))))
      .force("charge", d3.forceManyBody().strength(n => n.kind === "hub" ? -NET.repelHub : -NET.repelPaper * (1 + NET.repelK * (km(n) - 1))).distanceMax(350))
      .force("collide", d3.forceCollide(n => n.kind === "hub" ? n.tw / 2 + NET.space : n.r + NET.space + 6 * (km(n) - 1)).strength(0.9))
      .force("fan", fanForce(around1, () => true))
      .force("star", alpha => {                       // each main hub drifts towards the middle of its papers
        for (const d of core) {
          const ps = around1.get(d);
          if (!ps.length) continue;
          d.vx += (ps.reduce((s, q) => s + q.x, 0) / ps.length - d.x) * NET.star * alpha;
          d.vy += (ps.reduce((s, q) => s + q.y, 0) / ps.length - d.y) * NET.star * alpha;
        }
      })
      .force("x", d3.forceX(0).strength(n => n.kind === "hub" ? 0.02 : 0.015 + NET.centre * (km(n) - 1)))
      .force("y", d3.forceY(0).strength(n => n.kind === "hub" ? 0.06 : 0.04 + NET.centre * 1.5 * (km(n) - 1)))
      .stop();
    sim.randomSource(() => 0.5);                     // no randomness: same picture on every load
    for (let i = 0; i < NET.ticks; i++) sim.tick();
    const len = mainLinks.reduce((s, l) => s + Math.hypot(l.source.x - l.target.x, l.source.y - l.target.y), 0);
    return crossings(mainLinks) + 4 * parallelLinks(around1).length + len / 150;   // lower is better
  };
  const starts = [];
  for (let i = 0; i < NET.starts; i++) {             // the papers.json order, then rotations and reversals
    const c = core.map((_, j) => core[(j + Math.floor(i / 2) * 3) % core.length]);
    starts.push(i % 2 ? c.reverse() : c);
  }
  if (pinned.length === nodes1.length) pinned.forEach(n => { [n.x, n.y] = pos[key(n)]; });   // all saved: nothing to compute
  else {
    let best = null;
    starts.forEach((st, i) => { const sc = run(st); if (!best || sc < best.sc) best = { sc, i }; });
    if (best.i !== starts.length - 1) run(starts[best.i]);
    nodes1.forEach(n => { delete n.fx; delete n.fy; });
    // mirror the picture (same shape, same crossings) so the NET.bottom discipline sits in the lower half
    const low = discs[idx[NET.bottom]];
    if (low && !pinned.length) {
      const cx = d3.mean(nodes1, n => n.x), cy = d3.mean(nodes1, n => n.y);
      if (low.y < cy) nodes1.forEach(n => { n.y = 2 * cy - n.y; });
    }
  }

  /* pass 2: secondary disciplines around the fixed picture */
  if (outer.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes1.forEach(n => { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, A = (x1 - x0) / 2 + NET.ringGap + 30, B = (y1 - y0) / 2 + NET.ringGap;
    // spread evenly around the picture, in the order of the directions of their papers
    outer.forEach(d => {
      const ps = papers.filter(p => p.sec.includes(d.id));
      d.want = Math.atan2((d3.mean(ps, p => p.y) - cy) / B, (d3.mean(ps, p => p.x) - cx) / A);
    });
    const ring = [...outer].sort((a, b) => a.want - b.want), n = ring.length, step = (2 * Math.PI) / n;
    let off = 0, bestOff = Infinity;                 // rotation that keeps each one closest to its papers
    for (let t = 0; t < 72; t++) {
      const o = (t / 72) * step;
      const cost = ring.reduce((c, d, i) => { let e = Math.abs(o + i * step - Math.PI - d.want) % (2 * Math.PI); return c + Math.min(e, 2 * Math.PI - e); }, 0);
      if (cost < bestOff) { bestOff = cost; off = o; }
    }
    ring.forEach((d, i) => { const a = off + i * step - Math.PI; d.x = cx + A * Math.cos(a); d.y = cy + B * Math.sin(a); });
    nodes1.forEach(n => { n.fx = n.x; n.fy = n.y; });
    outer.filter(d => pos[key(d)]).forEach(d => { [d.x, d.y] = pos[key(d)]; d.fx = d.x; d.fy = d.y; });   // saved ones stay put
    const nodes2 = [...nodes1, ...outer];
    const around2 = linksAround(nodes2, secLinks), aroundAll = linksAround(nodes2, links);
    const sim2 = d3.forceSimulation(nodes2)
      .force("link", d3.forceLink(secLinks).distance(0).strength(0.004))    // lean a little towards its papers
      .force("charge", d3.forceManyBody().strength(n => n.secondary ? -900 : 0))   // ...while staying spread out
      .force("collide", d3.forceCollide(n => n.kind === "hub" ? n.tw / 2 + 6 : n.r + 6).strength(0.9))
      .force("fan", fanForce(around2, n => n.secondary, 4, 2 * NET.fan))   // secondary names move freely
      .force("fanEnd", alpha => {     // a paper's link to a secondary name on top of another of its links: move the name
        for (const p of papers) {
          const ends = aroundAll.get(p);
          for (const S of ends) {
            if (!S.secondary) continue;
            for (const O of ends) {
              if (O === S) continue;
              const sx = S.x - p.x, sy = S.y - p.y, ox = O.x - p.x, oy = O.y - p.y;
              const ls = Math.hypot(sx, sy) || 1, lo = Math.hypot(ox, oy) || 1;
              const gap = Math.acos(Math.max(-1, Math.min(1, (sx * ox + sy * oy) / (ls * lo))));
              const apart = Math.min(ls, lo) * Math.sin(Math.min(gap, Math.PI / 2));
              if (gap > Math.PI / 2 || apart >= 2 * NET.fan) continue;
              const nx = -oy / lo, ny = ox / lo, side = nx * sx + ny * sy >= 0 ? 1 : -1;
              const f = (2 * NET.fan - apart) * 1.5 * alpha;
              S.vx += nx * side * f; S.vy += ny * side * f;
            }
          }
        }
      })
      .force("ring", alpha => {                       // stay on the outer ellipse
        for (const d of outer) {
          const a = Math.atan2((d.y - cy) / B, (d.x - cx) / A);
          d.vx += (cx + A * Math.cos(a) - d.x) * 0.7 * alpha;
          d.vy += (cy + B * Math.sin(a) - d.y) * 0.7 * alpha;
        }
      })
      .stop();
    sim2.randomSource(() => 0.5);
    for (let i = 0; i < 160; i++) sim2.tick();
    nodes2.forEach(n => { delete n.fx; delete n.fy; });
  }
  const check = { crossings: crossings(links), parallel: parallelLinks(linksAround([...discs, ...papers], links)) };   // for checking only

  placeLabels(papers);

  const L = { discs, papers, links, idx, check, key };
  fitBoxes(L);
  return L;
}

// picture bounds: L.box for the main network alone, L.boxAll with the secondary fields
function fitBoxes(L) {
  const bounds = withSecondary => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    L.discs.forEach(d => { if (withSecondary || !d.secondary) { grow(d.x - d.tw / 2, d.y - d.th / 2); grow(d.x + d.tw / 2, d.y + d.th / 2); } });
    L.papers.forEach(p => {
      grow(p.x - p.r, p.y - p.r); grow(p.x + p.r, p.y + p.r);
      if (p.showLabel) { grow(p.lx - p.lw / 2 * (p.la === "middle") - p.lw * (p.la === "end"), p.ly - 10); grow(p.lx + p.lw / 2 * (p.la === "middle") + p.lw * (p.la === "start"), p.ly + 4); }
    });
    const pad = 20, legend = 56;                   // room below for a legend on up to two lines
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad + legend };
  };
  L.box = bounds(false); L.boxAll = bounds(true);
}

// each paper label goes below, above, right or left of its point, wherever it overlaps least
// paper titles always sit centred just below their disk
function placeLabels(papers) {
  papers.filter(p => p.showLabel).forEach(p => Object.assign(p, { lx: p.x, ly: p.y + p.r + 14, la: "middle" }));
}

// number of crossing links: main links count fully, faint secondary ones a third
function crossings(links) {
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let n = 0;
  for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
    const A = links[i], B = links[j];
    if (A.source === B.source || A.target === B.target) continue;       // links sharing an end never cross
    const p1 = A.source, p2 = A.target, q1 = B.source, q2 = B.target;
    if (side(p1, p2, q1) * side(p1, p2, q2) < 0 && side(q1, q2, p1) * side(q1, q2, p2) < 0)
      n += (A.secondary ? 1 / 3 : 1) * (B.secondary ? 1 / 3 : 1);
  }
  return n;
}

// pairs of links leaving the same node that run on top of each other (ends less than 8 px apart)
function parallelLinks(around) {
  const out = [];
  for (const [c, ends] of around) for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const A = ends[i], B = ends[j];
    const a = Math.atan2(A.y - c.y, A.x - c.x), b = Math.atan2(B.y - c.y, B.x - c.x);
    let d = Math.abs(a - b); if (d > Math.PI) d = 2 * Math.PI - d;
    const apart = Math.min(Math.hypot(A.x - c.x, A.y - c.y), Math.hypot(B.x - c.x, B.y - c.y)) * Math.sin(Math.min(d, Math.PI / 2));
    if (d < Math.PI / 2 && apart < 8) out.push(`${c.id}: ${A.id} / ${B.id}`);
  }
  return out;
}

/* ---------------- drawing ---------------- */

const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const arcPath = (r0, r1, a0, a1) => {      // annular sector (r0 = 0: pie slice), angles from 12 o'clock
  const p = (r, a) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {     // full circle / ring
    const half = a0 + Math.PI;
    return arcPath(r0, r1, a0, half) + arcPath(r0, r1, half, a1);
  }
  return r0 > 0
    ? `M${p(r1, a0)}A${r1},${r1} 0 ${large},1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large},0 ${p(r0, a0)}Z`
    : `M0,0L${p(r1, a0)}A${r1},${r1} 0 ${large},1 ${p(r1, a1)}Z`;
};

// theme: {dark, ink, ink2, muted, surface, font}
function drawNetwork(svg, L, theme, { forExport = false, title = "", secondary = false } = {}) {
  svg.textContent = "";
  let box = secondary ? L.boxAll : L.box;
  if (title) box = { ...box, y: box.y - 36, h: box.h + 36 };   // a title line on top (PDF)
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.w} ${box.h}`);
  svg.setAttribute("font-family", theme.font);
  if (!forExport) svg.style.maxWidth = `calc(82vh * ${(box.w / box.h).toFixed(3)})`;   // never taller than ~82% of the screen
  const col = id => (DISC_COLORS[id] || FALLBACK_COLOR)[theme.dark ? 1 : 0];
  if (forExport) el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: theme.surface }, svg);

  if (title) { const t = el("text", { x: box.x + 20, y: box.y + 28, "font-size": 16, "font-weight": 700, fill: theme.ink }, svg); t.textContent = title; }

  // legend below the network: the three kinds of points, centred, on one or two lines
  // (inside the SVG so it is part of the PDF too)
  const items = [["published", "Published or submitted"], ["in progress", "In progress / in preparation"], ["paused", "Paused"]]
    .map(([st, label]) => ({ st, label, w: textWidth(label, 12.5) + 44 }));
  const rows = [[]];
  items.forEach(it => {
    const row = rows[rows.length - 1], used = row.reduce((s, x) => s + x.w, 0);
    if (row.length && used + it.w > box.w - 30) rows.push([it]); else row.push(it);
  });
  const lg = el("g", { class: "hm-legend" }, svg);
  rows.forEach((row, r) => {
    let lx = box.x + (box.w - row.reduce((s, x) => s + x.w, 0)) / 2;
    const ly = box.y + box.h - 20 - 24 * (rows.length - 1 - r);
    row.forEach(it => {
      const g = el("g", { transform: `translate(${(lx + 8).toFixed(1)},${ly.toFixed(1)})` }, lg);
      paperGlyph(g, { main: ["cb", "hum", "eco"], sec: [], r: 8, status: it.st }, theme, col, false);
      const t = el("text", { x: 14, y: 4.5, "font-size": 12.5, fill: theme.ink2 }, g);
      t.textContent = it.label;
      lx += it.w;
    });
  });

  // links
  const gl = el("g", { class: "hm-links" }, svg);
  L.links.filter(l => secondary || !l.secondary).forEach(l => el("line", {
    class: "hm-link", "data-paper": l.source.id, "data-disc": l.disc,
    x1: l.source.x.toFixed(1), y1: l.source.y.toFixed(1), x2: l.target.x.toFixed(1), y2: l.target.y.toFixed(1),
    stroke: col(l.disc), "stroke-width": l.secondary ? 1.2 : 1.8, "stroke-opacity": l.secondary ? 0.3 : 0.6,
  }, gl));

  // discipline hubs: tinted pills
  const gh = el("g", { class: "hm-hubs" }, svg);
  L.discs.filter(d => secondary || !d.secondary).forEach(d => {
    const g = el("g", { class: "hm-hub", "data-disc": d.id, transform: `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})` }, gh);
    if (!forExport) { g.setAttribute("tabindex", 0); g.setAttribute("role", "button"); g.setAttribute("aria-label", d.label); }
    // main disciplines: tinted pill; secondary ones: just their name, in their colour
    const pill = { x: -d.tw / 2, y: -d.th / 2, width: d.tw, height: d.th, rx: d.th / 2 };
    if (d.secondary) el("rect", { ...pill, fill: "transparent" }, g);           // hover area
    else {
      el("rect", { ...pill, fill: theme.surface }, g);
      el("rect", { ...pill, fill: col(d.id), "fill-opacity": theme.dark ? 0.26 : 0.15, stroke: col(d.id), "stroke-width": 1.5 }, g);
    }
    const txt = { y: 0.5, "text-anchor": "middle", "dominant-baseline": "middle",
      "font-size": d.fs, "font-weight": 600 };
    if (d.secondary) {                                // halo, then the name
      const h = el("text", { ...txt, fill: theme.surface, stroke: theme.surface, "stroke-width": 4, "stroke-linejoin": "round", "aria-hidden": "true" }, g);
      h.textContent = d.label;
    }
    const t = el("text", { ...txt, fill: d.secondary ? readable(col(d.id), theme) : theme.ink }, g);
    t.textContent = d.label;
  });

  // papers
  const gp = el("g", { class: "hm-papers" }, svg);
  L.papers.forEach(p => {
    const g = el("g", { class: "hm-paper", "data-id": p.id, transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` }, gp);
    if (!forExport) {
      g.setAttribute("tabindex", 0); g.setAttribute("role", "button"); g.setAttribute("aria-label", p.title);
      el("circle", { class: "hm-hit", r: p.r + 8, fill: "transparent" }, g);
    }
    paperGlyph(el("g", { class: "hm-dot" }, g), p, theme, col, secondary);
    if (!p.showLabel) return;
    const lab = { class: "hm-label", x: (p.lx - p.x).toFixed(1), y: (p.ly - p.y).toFixed(1), "text-anchor": p.la, "font-size": 12, "font-weight": p.bold ? 600 : 400 };
    const halo = el("text", { ...lab, fill: theme.surface, stroke: theme.surface, "stroke-width": 3.5, "stroke-linejoin": "round", "aria-hidden": "true" }, g);
    halo.textContent = p.label;
    const t = el("text", { ...lab, fill: p.status === "paused" ? theme.muted : theme.ink }, g);
    t.textContent = p.label;
  });
}

// a paper: a ring-shaped pie, main disciplines first then (if shown) secondary ones, paler, always
// in the papers.json order. Published / submitted: dark centre; in progress: open centre;
// paused: open centre and a grey ring.
function paperGlyph(g, p, theme, col, secondary) {
  const done = SUBMITTED.has(p.status), paused = p.status === "paused";
  const slices = [...p.main.map(d => [d, 1]), ...(secondary ? p.sec.map(d => [d, 0.4]) : [])];
  const r1 = p.r, r0 = p.r * 0.45, step = (2 * Math.PI) / Math.max(1, slices.length);
  (slices.length ? slices : [[null, 1]]).forEach(([d, op], i) => el("path", {
    d: arcPath(r0, r1, i * step, (i + 1) * step),
    fill: paused ? theme.muted : d ? col(d) : FALLBACK_COLOR[0], "fill-opacity": paused ? 0.25 + 0.35 * op : op,
    stroke: theme.surface, "stroke-width": slices.length > 1 ? 0.8 : 0,
  }, g));
  if (done) el("circle", { r: r0, fill: theme.ink }, g);
}

/* ---------------- page ---------------- */

function currentTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark" ||
    (root.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const cs = getComputedStyle(root);
  const v = n => cs.getPropertyValue(n).trim();
  return { dark, ink: v("--ink"), ink2: v("--muted"), muted: v("--muted"), surface: v("--surface"), font: getComputedStyle(document.body).fontFamily };
}

const LIGHT_EXPORT_THEME = {
  dark: false, ink: "#1b2420", ink2: "#4a524e", muted: "#8a918d", surface: "#ffffff", font: "Helvetica, Arial, sans-serif",
};

function tooltipHTML(p, L) {
  const imgs = (p.images || []).slice(0, 3).map(src => `<img src="${esc(src)}" alt="">`).join("");
  const chips = [...p.main, ...p.sec].map(t => `<span class="hm-chip"><i style="background:${(DISC_COLORS[t] || FALLBACK_COLOR)[0]}"></i>${esc(L.discs[L.idx[t]].label)}</span>`).join("");
  const done = SUBMITTED.has(p.status);
  return `
    ${imgs ? `<div class="hm-imgs n${Math.min(3, p.images.length)}">${imgs}</div>` : ""}
    <div class="hm-tt-body">
      <div class="hm-status ${done ? "done" : "wip"}">${esc(STATUS_TEXT[p.status] || p.status)} · ${esc(p.year)}</div>
      <h4>${md(p.title)}</h4>
      <div class="hm-auth">${md(p.authors || "")}</div>
      ${p.venue ? `<div class="hm-venue">${md(p.venue)}</div>` : ""}
      ${p.summary ? `<p>${md(p.summary)}</p>` : ""}
      <div class="hm-chips">${chips}</div>
      ${p.link ? `<a class="hm-link-out" href="${esc(p.link)}" target="_blank" rel="noopener">Read it ↗</a>` : ""}
    </div>`;
}

async function renderResearchNetwork(root) {
  const params = new URLSearchParams(location.search);
  let editing = params.has("edit");
  if (document.fonts) await Promise.all(["400 12px Inter", "600 12px Inter", `600 ${NET.fieldFont}px Inter`, `600 ${NET.fieldFont - 1}px Inter`].map(f => document.fonts.load(f).catch(() => null)));
  const [data, saved] = await Promise.all([
    loadJSON("content/papers.json"),
    loadJSON("content/network-layout.json").catch(() => null),
  ]);
  let L = computeNetwork(data, params.has("fresh") ? null : saved);

  root.innerHTML = `
    <div class="hm-controls">
      <label class="hm-toggle"><input type="checkbox" id="hm-sec" autocomplete="off"> Add secondary fields to the network?</label>
      ${editing ? `<label class="hm-toggle"><input type="checkbox" id="hm-edit" autocomplete="off"> Network edit mode</label>` : ""}
    </div>
    <div class="hm-stage">
      <div class="hm-scroll"><svg class="hm-svg" role="img" aria-label="Network of research papers and their disciplines"></svg></div>
      <div class="hm-tt" role="tooltip" hidden></div>
    </div>`;
  const svg = root.querySelector(".hm-svg"), stage = root.querySelector(".hm-stage"), tt = root.querySelector(".hm-tt");
  const secBox = root.querySelector("#hm-sec"), editBox = root.querySelector("#hm-edit");
  const view = { secondary: secBox.checked };   // a browser may restore the box ticked after a reload

  // highlight one paper (its links and disciplines) or one discipline (its links and papers)
  let locked = null;   // {type: 'paper'|'disc', id}
  const highlight = sel => {
    svg.classList.toggle("hm-focus", !!sel);
    if (!sel) { svg.querySelectorAll(".on").forEach(e => e.classList.remove("on")); return; }
    const p = sel.type === "paper" ? L.papers.find(x => x.id === sel.id) : null;
    const discOn = d => (p ? p.disc.includes(d) : d === sel.id);
    svg.querySelectorAll(".hm-hub").forEach(e => e.classList.toggle("on", discOn(e.dataset.disc)));
    svg.querySelectorAll(".hm-link").forEach(e => e.classList.toggle("on", p ? e.dataset.paper === p.id : e.dataset.disc === sel.id));
    svg.querySelectorAll(".hm-paper").forEach(e => {
      const q = L.papers.find(x => x.id === e.dataset.id);
      e.classList.toggle("on", p ? q === p : q.disc.includes(sel.id));
    });
  };
  const hideTip = () => { tt.hidden = true; };
  const clear = () => { if (!locked) { highlight(null); hideTip(); } };
  const showTip = (p, g) => {
    tt.innerHTML = tooltipHTML(p, L);
    tt.classList.toggle("wide", (p.images || []).length >= 2);   // more room for several pictures
    tt.hidden = false;
    const s = stage.getBoundingClientRect(), r = g.querySelector(".hm-dot").getBoundingClientRect();
    const cx = r.left + r.width / 2 - s.left, cy = r.top + r.height / 2 - s.top;
    const tw = tt.offsetWidth, th = tt.offsetHeight;
    let left = cx + 18; if (left + tw > s.width - 4) left = cx - 18 - tw; left = Math.max(4, left);
    let top = cy - th / 2; top = Math.max(4, Math.min(top, s.height - th - 4));
    if (s.width < 560) { left = 4; top = Math.min(cy + 18, s.height - th - 4); }   // phones: under the point
    tt.style.left = left + "px"; tt.style.top = top + "px";
  };

  function bind() {
    svg.querySelectorAll(".hm-paper").forEach(g => {
      const p = L.papers.find(x => x.id === g.dataset.id);
      const enter = () => { if (locked && locked.id !== p.id) return; highlight({ type: "paper", id: p.id }); if (!editing) showTip(p, g); };
      g.addEventListener("mouseenter", enter);
      g.addEventListener("focus", enter);
      g.addEventListener("mouseleave", clear);
      g.addEventListener("blur", clear);
      g.addEventListener("click", e => {
        e.stopPropagation();
        if (locked && locked.id === p.id) { locked = null; clear(); return; }
        locked = { type: "paper", id: p.id }; highlight(locked); showTip(p, g);
      });
    });
    svg.querySelectorAll(".hm-hub").forEach(g => {
      const sel = { type: "disc", id: g.dataset.disc };
      g.addEventListener("mouseenter", () => { if (!locked) highlight(sel); });
      g.addEventListener("focus", () => { if (!locked) highlight(sel); });
      g.addEventListener("mouseleave", clear);
      g.addEventListener("blur", clear);
      g.addEventListener("click", e => {
        e.stopPropagation(); hideTip();
        if (locked && locked.type === "disc" && locked.id === sel.id) { locked = null; highlight(null); return; }
        locked = sel; highlight(sel);
      });
    });
  }
  document.addEventListener("click", e => { if (!tt.contains(e.target)) { locked = null; highlight(null); hideTip(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { locked = null; highlight(null); hideTip(); } });

  const paint = () => {
    drawNetwork(svg, L, currentTheme(), { secondary: view.secondary });
    bind();
    svg.classList.toggle("hm-editing", editing);
    if (editing) enableDragging(svg, L, paint);
  };
  secBox.addEventListener("change", () => { view.secondary = secBox.checked; locked = null; hideTip(); paint(); });

  // private edit mode (?edit only): drag nodes, export their positions, or go back to the saved or
  // the computed layout
  if (editBox) {
    const editor = addEditor(root, () => L, fresh => {
      L = computeNetwork(data, fresh ? null : saved); locked = null; hideTip(); paint();
    });
    const setEditing = on => {
      editing = on; editBox.checked = on; editor.hidden = !on;
      locked = null; highlight(null); hideTip(); paint();
    };
    editBox.addEventListener("change", () => setEditing(editBox.checked));
    setEditing(true);
  } else paint();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);

  if (params.has("pdf")) addPdfExport(root, () => L, view);
}

/* ---------------- network edit mode ---------------- */

// drag papers and disciplines; their links and labels follow
function enableDragging(svg, L, repaint) {
  const lines = [...svg.querySelectorAll(".hm-link")];
  const move = (n, g) => {
    g.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    lines.forEach(ln => {
      if (n.kind === "paper" && ln.dataset.paper === n.id) { ln.setAttribute("x1", n.x.toFixed(1)); ln.setAttribute("y1", n.y.toFixed(1)); }
      if (n.kind === "hub" && ln.dataset.disc === n.id) { ln.setAttribute("x2", n.x.toFixed(1)); ln.setAttribute("y2", n.y.toFixed(1)); }
    });
  };
  const drag = d3.drag()
    .on("start", function () { this.classList.add("dragging"); })
    .on("drag", function (event) {
      const n = this.classList.contains("hm-hub") ? L.discs.find(d => d.id === this.dataset.disc) : L.papers.find(p => p.id === this.dataset.id);
      const [x, y] = d3.pointer(event, svg), dx = x - n.x, dy = y - n.y;
      n.x = x; n.y = y;
      if (n.kind === "paper") { n.lx += dx; n.ly += dy; }       // the label travels with its point
      move(n, this);
    })
    .on("end", function () { this.classList.remove("dragging"); fitBoxes(L); repaint(); });
  d3.select(svg).selectAll(".hm-paper, .hm-hub").call(drag);
}

function addEditor(root, getL, reset) {
  const bar = document.createElement("div");
  bar.className = "hm-editor"; bar.hidden = true;
  bar.innerHTML = `<span>Drag papers and disciplines (turn on secondary fields to move those too), then copy or download the positions.</span>
    <button class="btn" type="button" data-act="copy">Copy positions</button>
    <button class="btn" type="button" data-act="save">Download network-layout.json</button>
    <button class="btn" type="button" data-act="saved">Reset</button>
    <button class="btn" type="button" data-act="fresh">Computed layout</button>
    <span class="hm-editor-msg" aria-live="polite"></span>`;
  root.querySelector(".hm-controls").after(bar);
  const msg = bar.querySelector(".hm-editor-msg");
  // positions of every paper and discipline, secondary ones included
  const layout = () => {
    const L = getL(), positions = {};
    [...L.discs, ...L.papers].forEach(n => { positions[L.key(n)] = [Math.round(n.x), Math.round(n.y)]; });
    return JSON.stringify({ _help: "Positions of the papers and disciplines (secondary ones included) in the research network, made with research.html?edit. Anything not listed is placed automatically.", positions }, null, 1);
  };
  bar.addEventListener("click", async e => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === "copy") {
      try { await navigator.clipboard.writeText(layout()); msg.textContent = "Copied: paste it to Claude, or save it as content/network-layout.json."; }
      catch (err) { msg.textContent = "Copy failed: use Download instead."; }
    }
    if (act === "save") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([layout()], { type: "application/json" }));
      a.download = "network-layout.json"; a.click();
      msg.textContent = "Downloaded: put it in the content/ folder to make it the layout.";
    }
    if (act === "saved") { reset(false); msg.textContent = "Back to the site's layout."; }
    if (act === "fresh") { reset(true); msg.textContent = "Layout computed from scratch (ignores the saved positions)."; }
  });
  return bar;
}

/* ---------------- private PDF export (research.html?pdf) ---------------- */

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
  });
}

function addPdfExport(root, getL, view) {
  const btn = document.createElement("button");
  btn.className = "btn hm-export"; btn.type = "button"; btn.textContent = "Export PDF (current view)";
  root.querySelector(".hm-controls").prepend(btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Preparing…";
    try {
      if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
      if (!window.svg2pdf) await loadScript("https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.3/dist/svg2pdf.umd.min.js");
      const L = getL(), svg = document.createElementNS(SVGNS, "svg");
      svg.style.position = "absolute"; svg.style.left = "-99999px";
      document.body.appendChild(svg);
      drawNetwork(svg, L, LIGHT_EXPORT_THEME, { forExport: true, title: "Research network", secondary: view.secondary });
      const { w, h } = view.secondary ? L.boxAll : L.box;
      const doc = new window.jspdf.jsPDF({ orientation: w > h ? "landscape" : "portrait", unit: "pt", format: [w, h] });
      await doc.svg(svg, { x: 0, y: 0, width: w, height: h });
      doc.save(view.secondary ? "research-network-with-secondary.pdf" : "research-network.pdf");
      svg.remove();
    } catch (err) {
      console.error(err); alert("PDF export failed: " + err.message);
    } finally {
      btn.disabled = false; btn.textContent = "Export PDF (current view)";
    }
  });
}

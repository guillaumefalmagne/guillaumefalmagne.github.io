// Timeline: renders content/career.json.
// Priority steps ("priority": true) get a full card + a column of bubbles
// (supervisors, research questions). Other steps are small notes in the left
// column, placed next to the priority step that precedes them in the list.
// Dates sit in small labels on the vertical line, linked to their text by a short connector.
// Colours go gradually from green (top) to red (bottom), following each item's position.

// How card pictures are shown:
//   "background" = faded picture behind the card content
//   "banner"     = picture strip at the bottom of the card
const IMAGE_STYLE = "background";

const PERSON_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5" r="3"/><path d="M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z"/></svg>';

function fmtDates(s, e) {
  const y = d => String(d).slice(0, 4);
  return y(s) === y(e) ? y(s) : `${y(s)} – ${y(e)}`;
}

function supBubble(names, i = 0) {
  if (!names?.length) return "";
  return `<div class="bubble sup" style="--i:${i}"><span class="av">${PERSON_ICON}</span>
    <span>Supervisor${names.length > 1 ? "s" : ""}: <b>${names.map(esc).join(", ")}</b></span></div>`;
}

function logoChips(logos) {
  return (logos || []).map(src => `<span class="logo"><img src="${esc(src)}" alt="" loading="lazy"></span>`).join("");
}

// image: "path" or { "src": "path", "fit": "cover|contain|…", "position": "right center", "opacity": 0.9,
//                    "background": "#000" (colour filling the card around a "contain" picture) }
function cardImage(s) {
  if (!s.image) return { cls: "", style: "", banner: "" };
  const img = typeof s.image === "string" ? { src: s.image } : s.image;
  if (IMAGE_STYLE === "background") {
    // absolute URL: a relative url() inside a CSS variable would resolve from css/, not from the page
    const abs = new URL(img.src, document.baseURI).href;
    const style = [
      `--img:url('${esc(abs)}')`,
      img.fit ? `--img-fit:${img.fit}` : "",
      img.position ? `--img-pos:${img.position}` : "",
      img.opacity != null ? `--img-opacity:${img.opacity}` : "",
      img.background ? `--img-bg:${img.background}` : "",
    ].filter(Boolean).join(";");
    return { cls: " has-bg", style, banner: "" };
  }
  const contain = img.fit === "contain" ? " contain" : "";
  return { cls: "", style: "", banner: `<div class="tl-image${contain}" style="background-image:url('${esc(img.src)}')"></div>` };
}

function minorItem(s) {
  const link = s.link ? `<br><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.linkText || "Link")} ↗</a>` : "";
  return `
    <div class="tl-minor tl-colored">
      <span class="pill sm">${fmtDates(s.start, s.end)}</span>
      <span class="role">${md(s.role)}</span><br>
      ${(s.institutions || []).map(md).join(" · ")}${link}
      ${s.logos?.length ? `<div class="mlogos">${logoChips(s.logos)}</div>` : ""}
      ${supBubble(s.supervisors)}
    </div>`;
}

function priorityRow(s, minors) {
  let i = 0;
  const sup = s.supervisors?.length ? supBubble(s.supervisors, i++) : "";
  const qs = (s.questions || []).map(q => `<div class="bubble question" style="--i:${i++}">${md(q)}</div>`).join("");
  const tags = s.topics?.length ? `<div class="tags">${s.topics.map(t => `<span class="tag">${md(t)}</span>`).join("")}</div>` : "";
  const img = cardImage(s);
  return `
    <div class="tl-row tl-colored">
      <div class="tl-when"><span class="pill">${fmtDates(s.start, s.end)}</span></div>
      <article class="tl-card${img.cls}" style="${img.style}">
        <div class="tl-text">
          ${s.logos?.length ? `<div class="logos">${logoChips(s.logos)}</div>` : ""}
          <div class="tl-head">
            <h3>${md(s.role)}</h3>
            <div class="inst">${(s.institutions || []).map(md).join(" · ")}</div>
          </div>
          ${tags}
          ${s.notes ? `<div class="notes">${md(s.notes)}</div>` : ""}
          ${s.link ? `<a class="more" href="${esc(s.link)}">More about it →</a>` : ""}
        </div>
        ${img.banner}
      </article>
      <div class="tl-bubbles">${sup}${qs}</div>
      ${minors.length ? `<div class="tl-aside">${minors.map(minorItem).join("")}</div>` : ""}
    </div>`;
}

// Give every item a colour between green and red from the vertical position of its
// date label: the first item is fully green, the last one fully red. The line's
// gradient uses the same two positions (--g0, --g1), so line and items match.
function colourByPosition(el) {
  const box = el.getBoundingClientRect();
  if (!box.height) return;
  const items = [...el.querySelectorAll(".tl-colored")].map(item => {
    const pill = item.querySelector(":scope > .tl-when .pill, :scope > .pill");
    const r = (pill || item).getBoundingClientRect();
    return { item, y: r.top + r.height / 2 - box.top };
  });
  const y0 = Math.min(...items.map(i => i.y)), y1 = Math.max(...items.map(i => i.y));
  items.forEach(({ item, y }) => {
    const t = y1 > y0 ? Math.min(1, Math.max(0, (y - y0) / (y1 - y0))) : 0;
    item.style.setProperty("--p", (t * 100).toFixed(1) + "%");
  });
  el.style.setProperty("--g0", (y0 / box.height * 100).toFixed(1) + "%");
  el.style.setProperty("--g1", (y1 / box.height * 100).toFixed(1) + "%");
}

async function renderTimeline(el) {
  const steps = (await loadJSON("content/career.json")).filter(s => !s.hidden);

  // Group: each priority step + the secondary steps listed after it (until the next priority step).
  const groups = [];
  for (const s of steps) {
    if (s.priority || !groups.length) groups.push({ main: s, minors: [] });
    else groups[groups.length - 1].minors.push(s);
  }
  el.innerHTML = groups.map(g => priorityRow(g.main, g.minors)).join("");

  colourByPosition(el);
  new ResizeObserver(() => colourByPosition(el)).observe(el);

  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });
  el.querySelectorAll(".tl-when, .tl-card, .tl-bubbles, .tl-minor").forEach(n => io.observe(n));
}

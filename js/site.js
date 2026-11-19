// Shared header + footer, injected on every page.
const PAGES = [
  ["index.html", "Home"],
  ["coolnet.html", "COOLNET"],
  ["cv.html", "CV"],
  ["research.html", "Research"],
  ["teaching.html", "Teaching"],
  ["contact.html", "Contact"],
];

(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  const links = PAGES.map(([href, label]) =>
    `<li><a href="${href}"${href === here ? ' class="active"' : ""}>${label}</a></li>`).join("");

  document.body.insertAdjacentHTML("afterbegin", `
    <nav class="nav"><div class="wrap">
      <a class="brand" href="index.html">Guillaume Falmagne</a>
      <ul>${links}</ul>
    </div></nav>`);

  document.body.insertAdjacentHTML("beforeend", `
    <footer><div class="wrap">
      <span>© ${new Date().getFullYear()} Guillaume Falmagne</span>
      <span><a href="mailto:guillaume.falmagne@tcd.ie">guillaume.falmagne@tcd.ie</a> ·
        <a href="https://orcid.org/0000-0002-6762-3937">ORCID</a> ·
        <a href="https://www.linkedin.com/in/guillaume-falmagne-573a52a1/">LinkedIn</a></span>
    </div></footer>`);
})();

async function loadJSON(path) {
  let r;
  try { r = await fetch(path); }
  catch (e) { fileProtocolNotice(); throw e; }
  if (!r.ok) throw new Error(`Could not load ${path}`);
  return r.json();
}

// Opened as a file (file://), browsers refuse to load content/*.json: say how to view the site instead
function fileProtocolNotice() {
  if (location.protocol !== "file:" || document.getElementById("file-notice")) return;
  document.body.insertAdjacentHTML("afterbegin", `<div id="file-notice" class="draft-banner" style="font-size:.9rem;padding:10px">
    This page was opened as a file, so its content can't load. In the site folder run <code>python serve.py</code>,
    then open <a href="http://127.0.0.1:8000/${location.pathname.split("/").pop()}">http://127.0.0.1:8000</a>.</div>`);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Light markup for texts in content/*.json:
//   **bold**   *italic*   [link text](page.html or https://…)
function md(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

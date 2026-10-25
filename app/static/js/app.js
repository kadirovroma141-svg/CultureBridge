/* =====================================================================
   CultureBridge AI — frontend (talks to the Flask REST API)
   Modules: theme · progress (CQ passport) · globe · atlas · greetings ·
   gap radar · AI decoder · proxemics lab · voice tester · roleplay ·
   match game · quiz
   ===================================================================== */
(() => {
"use strict";

/* ---------------------------------------------------------------------
   Utilities
   --------------------------------------------------------------------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const NS = "http://www.w3.org/2000/svg";

const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

async function api(path, body) {
  const res = await fetch("/api" + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* Reference data, filled from /api/bootstrap */
let COUNTRIES = {}, CODES = [], DIMENSIONS = [], GREETINGS = [], MOODS = {}, ROLEPLAYS = [];
const totals = { quiz: 12, match: 10 };

function countryOptions(select, selected) {
  select.innerHTML = CODES.map((c) => `<option value="${c}" ${c === selected ? "selected" : ""}>${COUNTRIES[c].flag} ${COUNTRIES[c].name}</option>`).join("");
}

/* ---------------------------------------------------------------------
   Theme
   --------------------------------------------------------------------- */
const themeListeners = [];
function applyThemeIcon() { $("#themeBtn").textContent = document.documentElement.dataset.theme === "light" ? "☀" : "☾"; }
$("#themeBtn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("cb-theme", next); } catch (e) {}
  applyThemeIcon();
  themeListeners.forEach((f) => f());
});
applyThemeIcon();

/* ---------------------------------------------------------------------
   Progress → CQ Passport (Cultural Intelligence, Earley & Ang 2003)
   --------------------------------------------------------------------- */
const progress = Object.assign(
  { visited: [], quiz: 0, match: 0, roleplay: {}, decoder: 0, nonverbal: [] },
  store.get("cb-progress", {})
);
const PASSPORT = [
  { label: "Knowledge · Atlas", val: () => progress.visited.length / Math.max(1, CODES.length) },
  { label: "Awareness · Quiz", val: () => progress.quiz / totals.quiz },
  { label: "Recognition · Match", val: () => progress.match / totals.match },
  { label: "Empathy · Roleplay", val: () => { const v = Object.values(progress.roleplay); return v.length ? v.reduce((a, b) => a + b, 0) / (Math.max(1, ROLEPLAYS.length) * 100) : 0; } },
  { label: "Pragmatics · Decoder", val: () => Math.min(progress.decoder, 5) / 5 },
  { label: "Non-verbal · Labs", val: () => Math.min(progress.nonverbal.length, 3) / 3 }
];
function saveProgress(patch) {
  Object.assign(progress, patch || {});
  store.set("cb-progress", progress);
  renderPassport();
}
function markNonverbal(tag) {
  if (!progress.nonverbal.includes(tag)) saveProgress({ nonverbal: [...progress.nonverbal, tag] });
}
function renderPassport() {
  const vals = PASSPORT.map((p) => clamp(p.val(), 0, 1));
  $("#passportBars").innerHTML = PASSPORT.map((p, i) => `<div class="pbar">${p.label}<div><i style="width:${Math.round(vals[i] * 100)}%"></i></div></div>`).join("");
  $("#cqScore").textContent = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100);
}

/* ---------------------------------------------------------------------
   Scroll reveal, nav highlight, count-up stats
   --------------------------------------------------------------------- */
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealObs.unobserve(e.target); } });
}, { threshold: 0.08 });
$$(".reveal").forEach((el) => revealObs.observe(el));

const navLinks = $$("#navLinks a");
const navSections = $$("main section[id]");
let navRaf = 0;
function syncNav() {
  navRaf = 0;
  const line = innerHeight * 0.4;
  let current = "";
  navSections.forEach((s) => { if (s.getBoundingClientRect().top <= line) current = s.id; });
  navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + current));
}
window.addEventListener("scroll", () => { if (!navRaf) navRaf = requestAnimationFrame(syncNav); }, { passive: true });
syncNav();

function countUp(el, target) {
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 1000);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------------------------------------------------------------
   Geography (shared by globe and atlas)
   --------------------------------------------------------------------- */
const geoOK = typeof d3 !== "undefined" && typeof topojson !== "undefined" && window.WORLD_TOPO;
const WORLD = geoOK ? topojson.feature(WORLD_TOPO, WORLD_TOPO.objects.countries).features.filter((f) => f.id !== "010") : null;
const ISO_TO_CODE = {};

/* ---------------------------------------------------------------------
   Hero globe (canvas, orthographic projection)
   --------------------------------------------------------------------- */
function initGlobe() {
  const canvas = $("#globe");
  if (!geoOK) { canvas.parentElement.insertAdjacentHTML("beforeend", '<div class="map-fallback">🌍</div>'); return; }
  const ctx = canvas.getContext("2d");
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
  const path = d3.geoPath(projection, ctx);
  const graticule = d3.geoGraticule10();
  const hot = WORLD.filter((f) => ISO_TO_CODE[f.id]);
  const origin = COUNTRIES.KZ ? COUNTRIES.KZ.coords : [71.43, 51.13];
  const routes = CODES.filter((c) => c !== "KZ").map((c) => ({ alumni: !!COUNTRIES[c].alumni, line: { type: "LineString", coordinates: [origin, COUNTRIES[c].coords] } }));
  let rot = [-40, -28, 0], dragging = false, visible = true, colors = {}, w = 0, h = 0, dash = 0;

  function readColors() {
    colors = { land: css("--land"), stroke: css("--land-stroke"), a1: css("--accent"), a2: css("--accent-2"), a3: css("--accent-3"), bg: css("--bg-2"), border: css("--border") };
  }
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    projection.translate([w / 2, h / 2 - 8]).scale(Math.min(w, h) / 2 * 0.86);
  }
  function draw() {
    projection.rotate(rot);
    ctx.clearRect(0, 0, w, h);
    const [cx, cy] = projection.translate(), r = projection.scale();
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 1.05);
    g.addColorStop(0, colors.bg); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = colors.a1; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); path(graticule); ctx.strokeStyle = colors.border; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); WORLD.forEach((f) => path(f)); ctx.fillStyle = colors.land; ctx.fill(); ctx.strokeStyle = colors.stroke; ctx.lineWidth = 0.4; ctx.stroke();
    hot.forEach((f) => { ctx.beginPath(); path(f); ctx.fillStyle = COUNTRIES[ISO_TO_CODE[f.id]].alumni ? colors.a1 : colors.a2; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1; });
    ctx.setLineDash([4, 5]); ctx.lineDashOffset = -dash;
    routes.forEach((rt) => { ctx.beginPath(); path(rt.line); ctx.strokeStyle = rt.alumni ? colors.a3 : colors.a2; ctx.lineWidth = rt.alumni ? 1.8 : 1; ctx.globalAlpha = rt.alumni ? 0.95 : 0.5; ctx.stroke(); });
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const centre = [-rot[0], -rot[1]];
    CODES.forEach((c) => {
      const co = COUNTRIES[c].coords;
      if (d3.geoDistance(co, centre) > Math.PI / 2) return;
      const [x, y] = projection(co);
      ctx.beginPath(); ctx.arc(x, y, c === "KZ" ? 4.5 : 3, 0, Math.PI * 2); ctx.fillStyle = c === "KZ" ? colors.a3 : "#fff"; ctx.fill();
      if (c === "KZ") { ctx.beginPath(); ctx.arc(x, y, 6 + (dash % 20) / 2, 0, Math.PI * 2); ctx.strokeStyle = colors.a3; ctx.globalAlpha = 1 - (dash % 20) / 20; ctx.stroke(); ctx.globalAlpha = 1; }
    });
  }
  function tick() {
    if (visible) {
      if (!dragging) rot[0] += 0.12;
      dash += 0.4;
      draw();
    }
    requestAnimationFrame(tick);
  }
  d3.select(canvas).call(d3.drag()
    .on("start", () => { dragging = true; canvas.style.cursor = "grabbing"; })
    .on("drag", (ev) => { const k = 75 / projection.scale(); rot[0] += ev.dx * k; rot[1] = clamp(rot[1] - ev.dy * k, -60, 60); })
    .on("end", () => { dragging = false; canvas.style.cursor = "grab"; }));
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  readColors(); resize();
  window.addEventListener("resize", resize);
  themeListeners.push(readColors);
  tick();
}

/* ---------------------------------------------------------------------
   01 · Atlas — SVG world map + country card
   --------------------------------------------------------------------- */
let radar; // set by initRadar, used by the atlas "compare" button
function initAtlas() {
  const svg = $("#worldMap"), tip = $("#mapTip"), wrap = $("#mapWrap");
  const W = 960, H = 500;
  let projection = null;

  if (!geoOK) {
    wrap.innerHTML = '<div class="map-fallback">Map library unavailable — use the country buttons below.</div>';
  } else {
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: "FeatureCollection", features: WORLD });
    const path = d3.geoPath(projection);
    const s = d3.select(svg);
    s.append("g").selectAll("path").data(WORLD).join("path")
      .attr("d", path)
      .attr("class", (f) => { const c = ISO_TO_CODE[f.id]; return c ? `land hot ${COUNTRIES[c].alumni ? "alumni" : "base"}` : "land"; })
      .attr("data-code", (f) => ISO_TO_CODE[f.id] || null)
      .on("mousemove", (ev, f) => {
        const c = ISO_TO_CODE[f.id];
        const r = wrap.getBoundingClientRect();
        tip.style.left = ev.clientX - r.left + "px";
        tip.style.top = ev.clientY - r.top + "px";
        tip.textContent = c ? `${COUNTRIES[c].flag} ${COUNTRIES[c].name} — click to explore` : (f.properties.name || "");
        tip.style.opacity = 1;
      })
      .on("mouseleave", () => { tip.style.opacity = 0; })
      .on("click", (ev, f) => { const c = ISO_TO_CODE[f.id]; if (c) select(c); });
    if (COUNTRIES.KZ) {
      const o = projection(COUNTRIES.KZ.coords);
      const g = s.append("g");
      CODES.filter((c) => c !== "KZ").forEach((c) => {
        const p = projection(COUNTRIES[c].coords);
        const mx = (o[0] + p[0]) / 2, my = Math.min(o[1], p[1]) - Math.abs(o[0] - p[0]) * 0.18;
        g.append("path").attr("class", "route").attr("d", `M${o[0]},${o[1]} Q${mx},${my} ${p[0]},${p[1]}`);
      });
    }
    s.append("circle").attr("class", "ping").attr("r", 8).attr("id", "mapPing");
  }

  $("#countryChips").innerHTML = CODES.map((c) => `<button class="chip" data-code="${c}">${COUNTRIES[c].flag} ${COUNTRIES[c].name}</button>`).join("");
  $("#countryChips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) select(b.dataset.code); });

  function select(code, silent) {
    $$("#worldMap .hot").forEach((p) => p.classList.toggle("selected", p.dataset.code === code));
    $$("#countryChips .chip").forEach((b) => b.classList.toggle("active", b.dataset.code === code));
    if (projection) {
      const [x, y] = projection(COUNTRIES[code].coords);
      d3.select("#mapPing").attr("cx", x).attr("cy", y);
    }
    renderCard(code);
    if (!silent && !progress.visited.includes(code)) saveProgress({ visited: [...progress.visited, code] });
  }

  function renderCard(code) {
    const c = COUNTRIES[code];
    const card = $("#countryCard");
    card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
    const al = c.alumni;
    card.innerHTML = `
      <div class="cc-head"><span class="cc-flag">${c.flag}</span><div><h3>${esc(c.name)}</h3>
        <span class="tag">${esc(c.context)}</span>${al ? '<span class="tag alumni">✦ NIS alumni data</span>' : '<span class="tag">Exercise base</span>'}</div></div>
      <p class="cc-mentality">${esc(c.mentality)}</p>
      <div class="etq">${c.etiquette.map(([t, d], i) => `<details ${i === 0 ? "open" : ""}><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`).join("")}</div>
      ${al ? `<div class="voices"><h4>🎓 Voices of NIS Alumni</h4>
        ${al.voices.map((v) => `<div class="voice-q">“${esc(v.text)}”<small>NIS graduate · ${esc(v.uni)}</small></div>`).join("")}
        ${al.universities.length ? `<h4>Universities in our survey</h4><div class="uni-list">${al.universities.map((u) => `<span class="tag">${esc(u)}</span>`).join("")}</div>` : ""}
        <p class="muted" style="font-size:.75rem;margin-top:10px">Quotes are condensed from anonymous survey responses.</p></div>`
      : `<p class="muted" style="font-size:.85rem">No alumni from our survey study here yet — profile based on the exercise base and published research.</p>`}
      <div class="match-actions"><button class="btn ghost" data-go="radar">Compare with Kazakhstan →</button></div>`;
    card.querySelector("[data-go]").addEventListener("click", () => { radar.set("KZ", code === "KZ" ? "DE" : code); document.getElementById("radar").scrollIntoView(); });
  }

  select(COUNTRIES.IT ? "IT" : CODES[0], true);
}

/* ---------------------------------------------------------------------
   02 · Greetings of the World
   --------------------------------------------------------------------- */
function initGreetings() {
  $("#greetCount").textContent = GREETINGS.length;
  const half = Math.ceil(GREETINGS.length / 2);
  const rows = [GREETINGS.slice(0, half), GREETINGS.slice(half)];
  const card = (g, i) => `
    <div class="gcard" data-i="${i}" tabindex="0" aria-label="${esc(g.lang)} greeting">
      <div class="gcard-inner">
        <div class="gface front">
          <div><div class="gword" lang="${esc(g.code)}">${esc(g.word)}</div><div class="groman">${esc(g.roman)}</div></div>
          <div class="gmeta"><span>${esc(g.lang)}</span><button class="speak" data-i="${i}" aria-label="Pronounce">🔊</button></div>
        </div>
        <div class="gface back">
          <div class="gesture">${esc(g.gesture)}</div><b>${esc(g.gestureName)}</b><small>${esc(g.note)}</small>
          <button class="speak" data-i="${i}" aria-label="Pronounce" style="margin-top:6px">🔊</button>
        </div>
      </div>
    </div>`;
  rows.forEach((row, r) => {
    const offset = r === 0 ? 0 : half;
    const html = row.map((g, i) => card(g, i + offset)).join("");
    $("#marquee" + (r + 1)).innerHTML = html + html; // duplicated for a seamless loop
  });

  let voices = [];
  const loadVoices = () => { voices = "speechSynthesis" in window ? speechSynthesis.getVoices() : []; };
  loadVoices();
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = loadVoices;

  function speak(g) {
    if (!("speechSynthesis" in window)) { toast("Speech synthesis is not supported in this browser."); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(g.word);
    u.lang = g.code; u.rate = 0.85;
    const prefix = g.code.split("-")[0];
    const v = voices.find((v) => v.lang === g.code) || voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (v) u.voice = v; else toast(`No ${g.lang} voice installed — your browser may use a default voice.`);
    speechSynthesis.speak(u);
    markNonverbal("greetings");
  }

  $("#greetings").addEventListener("click", (e) => {
    const sp = e.target.closest(".speak");
    if (sp) { e.stopPropagation(); speak(GREETINGS[+sp.dataset.i]); return; }
    const c = e.target.closest(".gcard");
    if (c) c.classList.toggle("flipped");
  });
}

/* ---------------------------------------------------------------------
   03 · 6D Cultural Gap Radar (Chart.js + /api/radar)
   --------------------------------------------------------------------- */
function initRadar() {
  const fromSel = $("#radarFrom"), toSel = $("#radarTo");
  const alpha = (c, a) => `color-mix(in srgb, ${c} ${a}%, transparent)`;
  let chart = null, reqId = 0;

  function themeColors() {
    return { from: css("--accent-2"), to: css("--accent-3"), grid: css("--border"), text: css("--muted"), warn: css("--warn") };
  }

  function draw(r) {
    const c = themeColors();
    const labels = r.dimensions.map((d) => d.short);
    const gapIdx = new Set(r.top_gaps.map((g) => g.index));
    const ds = (side, color) => ({
      label: `${r[side].flag} ${r[side].name}`,
      data: r[side].values,
      borderColor: color,
      backgroundColor: alpha(color, 22),
      borderWidth: 2,
      pointBackgroundColor: r[side].values.map((_, i) => gapIdx.has(i) ? c.warn : color),
      pointBorderColor: color,
      pointRadius: r[side].values.map((_, i) => gapIdx.has(i) ? 6 : 4),
      pointHoverRadius: 8
    });
    const data = { labels, datasets: [ds("from", c.from), ds("to", c.to)] };
    if (chart) { chart.data = data; chart.update(); return; }
    Chart.defaults.font.family = '"Twemoji Country Flags", Inter, system-ui, sans-serif';
    chart = new Chart($("#radarChart"), {
      type: "radar",
      data,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 900, easing: "easeOutCubic" },
        scales: {
          r: {
            min: 0, max: 100, ticks: { stepSize: 25, display: false },
            grid: { color: c.grid }, angleLines: { color: c.grid },
            pointLabels: { color: c.text, font: { size: 12, weight: "600" } }
          }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: c.text, padding: 16, boxWidth: 14, boxHeight: 14,
              generateLabels: (ch) => ch.data.datasets.map((d, i) => ({ text: d.label, fillStyle: d.borderColor, strokeStyle: d.borderColor, fontColor: c.text, datasetIndex: i, hidden: !ch.isDatasetVisible(i) }))
            }
          },
          tooltip: { callbacks: { title: (items) => DIMENSIONS[items[0].dataIndex].label } }
        }
      }
    });
  }

  async function update() {
    const id = ++reqId;
    try {
      const r = await api(`/radar?from=${fromSel.value}&to=${toSel.value}`);
      if (id !== reqId) return;
      draw(r);
      renderShock(r);
    } catch (e) { toast("Radar: " + e.message); }
  }

  function renderShock(r) {
    const panel = $("#shockPanel");
    const A = r.from, B = r.to;
    if (A.code === B.code) {
      panel.innerHTML = `<h3>🧭 Same culture</h3><p class="muted">Choose two different countries to calculate the cultural distance.</p>`;
      return;
    }
    const idx = r.distance_index;
    const color = { low: "var(--good)", mid: "var(--warn)", high: "var(--bad)" }[r.level];
    const dip = 8 + idx * 0.5; // depth of Oberg U-curve
    const curve = `M5,20 C40,8 60,8 85,${20 + dip * 0.5} S130,${20 + dip} 160,${20 + dip * 0.7} S230,30 275,16`;
    const items = r.top_gaps.map((g) => `<div class="gap-item">
        <header><span>${esc(g.label)}<span class="sev ${g.severity}">${{ high: "High", mid: "Medium", low: "Low" }[g.severity]}</span></span><span>Δ ${g.abs}</span></header>
        <div class="gap-desc">${esc(B.name)}: <b>${esc(g.pole.toLowerCase())}</b> (${g.to} vs ${g.from} in ${esc(A.name)})</div>
        ${g.advice.map((a) => `<label class="check"><input type="checkbox"><span>${esc(a)}</span></label>`).join("")}
      </div>`).join("");
    panel.innerHTML = `
      <h3>⚠️ Cultural Shock Warning</h3>
      <div class="distance">
        <div class="distance-ring" style="--p:${idx};--c:${color}"><b>${idx}</b></div>
        <div><b style="color:${color}">${esc(r.level_label)}</b><div class="muted" style="font-size:.88rem">Cultural Distance Index ${A.flag} → ${B.flag} (0–100), RMS of six dimension gaps.</div></div>
      </div>
      <svg viewBox="0 0 280 96" style="width:100%;max-width:420px;height:auto;display:block;margin:0 auto 6px" aria-label="Predicted adaptation curve">
        <line x1="5" y1="20" x2="275" y2="20" stroke="var(--border)" stroke-dasharray="3 4"/>
        <path d="${curve}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        <text x="5" y="93" font-size="9" fill="var(--muted)">Honeymoon</text>
        <text x="122" y="93" font-size="9" fill="var(--muted)">Crisis</text>
        <text x="228" y="93" font-size="9" fill="var(--muted)">Adaptation</text>
      </svg>
      <p class="muted" style="font-size:.8rem">Oberg’s U-curve: dip depth scales with the distance index.</p>
      ${items ? `<h3 style="margin-top:14px">✅ Personal adaptation checklist</h3>${items}` : `<p>These cultures are very close on all six dimensions — expect a smooth start!</p>`}`;
  }

  countryOptions(fromSel, "KZ");
  countryOptions(toSel, "DE");
  fromSel.addEventListener("change", update);
  toSel.addEventListener("change", update);
  $("#radarSwap").addEventListener("click", () => { const f = fromSel.value; fromSel.value = toSel.value; toSel.value = f; update(); });
  themeListeners.push(() => { if (chart) { chart.destroy(); chart = null; update(); } });
  update();
  return { set(f, t) { fromSel.value = f; toSel.value = t; update(); } };
}

/* ---------------------------------------------------------------------
   04 · AI Pragmatic Translator (server: LLM → DB cache → expert engine)
   --------------------------------------------------------------------- */
function initDecoder(presets, aiInfo) {
  const input = $("#decInput"), sel = $("#decCountry"), out = $("#decOut"), runBtn = $("#decRun");
  countryOptions(sel, "JP");
  $("#decPresets").innerHTML = presets.map((p) => `<button class="chip">${esc(p)}</button>`).join("");
  $("#decPresets").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { input.value = b.textContent; run(); } });
  runBtn.addEventListener("click", run);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
  sel.addEventListener("change", () => { if (input.value.trim()) run(); });

  const live = aiInfo.provider !== "none";
  const providerName = { gemini: "Google Gemini", openai: "OpenAI" }[aiInfo.provider];
  $("#engineBadge").innerHTML = live
    ? `<span class="dot"></span> Server AI: ${providerName} (${esc(aiInfo.model)}) · offline cache enabled`
    : `<span class="dot" style="background:var(--accent-2)"></span> Server expert engine (no API key configured) · cached analyses`;
  $("#aiPill").textContent = live ? providerName : "Expert engine";

  const SOURCES = {
    live: ["⚡ Live AI", "Generated now and saved to the database cache"],
    cache: ["💾 AI cache", "Served instantly from the database (works offline)"],
    "expert-cache": ["📚 Expert cache", "Pre-computed expert analysis from the seed data"],
    engine: ["🧠 Expert engine", "Rule-based pragmatic engine on the server"]
  };

  let busy = false;
  async function run() {
    const text = input.value.trim();
    if (!text) { toast("Type a phrase first."); input.focus(); return; }
    if (busy) return;
    busy = true; runBtn.disabled = true;
    out.innerHTML = `<div class="empty"><div><span class="spinner"></span><p class="muted" style="margin-top:10px">${live ? `Asking ${providerName}…` : "Analysing…"}</p></div></div>`;
    try {
      const r = await api("/decode", { text, country: sel.value });
      render(r, sel.value);
      saveProgress({ decoder: progress.decoder + 1 });
    } catch (e) {
      out.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
    } finally {
      busy = false; runBtn.disabled = false;
    }
  }

  function render(r, code) {
    const c = COUNTRIES[code];
    const lvl = [["Low risk", "var(--good)"], ["Caution", "var(--warn)"], ["High conflict risk", "var(--bad)"]][r.level];
    const deg = -90 + r.risk * 1.8;
    const src = SOURCES[r.source] || SOURCES.engine;
    out.innerHTML = `
      <div class="gauge-wrap">
        <div class="gauge"><svg viewBox="0 0 200 118" aria-label="Politeness and conflict risk meter">
          <defs><linearGradient id="gGrad" x1="0" x2="1"><stop offset="0" stop-color="var(--good)"/><stop offset=".5" stop-color="var(--warn)"/><stop offset="1" stop-color="var(--bad)"/></linearGradient></defs>
          <path class="track" d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke-width="16" stroke-linecap="round"/>
          <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke="url(#gGrad)" stroke-width="16" stroke-linecap="round" pathLength="100" stroke-dasharray="${r.risk} 100"/>
          <g class="needle" style="transform:rotate(-90deg)"><line x1="100" y1="100" x2="100" y2="34" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/></g>
          <circle cx="100" cy="100" r="7" fill="var(--text)"/>
        </svg></div>
        <div><div class="gauge-val" id="gaugeVal">0%</div><div class="gauge-lbl" style="color:${lvl[1]}">${lvl[0]}</div>
          <div class="muted" style="font-size:.82rem">Politeness &amp; Conflict Risk for ${c.flag} ${esc(c.name)}</div>
          <span class="src-badge" title="${esc(src[1])}">${src[0]}</span></div>
      </div>
      <div>${r.tags.map((t) => `<span class="ftag">${esc(t)}</span>`).join("")}${r.softeners ? `<span class="ftag soft">${r.softeners} softener${r.softeners > 1 ? "s" : ""} detected</span>` : ""}</div>
      <div class="dec-block" style="margin-top:10px"><h4>👂 How a local hears it</h4><p>${esc(r.heard)}</p></div>
      <div class="dec-block adapted"><h4>✨ Culturally adapted for ${esc(c.name)} <button class="copy" id="copyBtn">Copy</button></h4><p id="adaptedText" class="typing"></p></div>
      ${r.notes.length ? `<div class="dec-block"><h4>🔬 Why</h4>${r.notes.map((n) => `<p style="font-size:.88rem;margin-bottom:4px">• ${esc(n)}</p>`).join("")}</div>` : ""}`;
    requestAnimationFrame(() => { const n = out.querySelector(".needle"); if (n) n.style.transform = `rotate(${deg}deg)`; });
    const gv = $("#gaugeVal"); let v = 0;
    const iv = setInterval(() => { v = Math.min(r.risk, v + Math.max(1, Math.round(r.risk / 25))); gv.textContent = v + "%"; if (v >= r.risk) clearInterval(iv); }, 30);
    const at = $("#adaptedText"); let i = 0;
    const tw = setInterval(() => { at.textContent = r.adapted.slice(0, ++i); if (i >= r.adapted.length) { clearInterval(tw); at.classList.remove("typing"); } }, 14);
    $("#copyBtn").addEventListener("click", () => {
      (navigator.clipboard ? navigator.clipboard.writeText(r.adapted) : Promise.reject()).then(() => toast("Copied!"), () => toast("Copy not available here."));
    });
  }
}

/* ---------------------------------------------------------------------
   05 · Proxemics Lab
   --------------------------------------------------------------------- */
function initProxemics(voice) {
  const svg = $("#proxSvg"), range = $("#proxRange"), sel = $("#proxCountry");
  const SCALE = 2.6, MIDX = 300, GROUND = 225;
  countryOptions(sel, "IT");

  svg.innerHTML = `
    <defs>
      <radialGradient id="auraGrad"><stop offset="0" stop-opacity=".55" stop-color="currentColor"/><stop offset="1" stop-opacity="0" stop-color="currentColor"/></radialGradient>
    </defs>
    <line x1="20" y1="${GROUND}" x2="580" y2="${GROUND}" stroke="var(--border)" stroke-width="2"/>
    <circle id="pxBubble" cy="${GROUND - 70}" fill="none" stroke="var(--muted)" stroke-dasharray="5 6" opacity=".55"/>
    <g id="pxMe" class="avatar-g">
      <circle cx="0" cy="${GROUND - 128}" r="22" fill="var(--accent-2)"/>
      <path d="M-26,${GROUND} L-20,${GROUND - 98} Q0,${GROUND - 110} 20,${GROUND - 98} L26,${GROUND} Z" fill="var(--accent-2)" opacity=".85"/>
      <circle cx="6" cy="${GROUND - 132}" r="2.6" fill="var(--bg)"/><circle cx="14" cy="${GROUND - 132}" r="2.6" fill="var(--bg)"/>
      <path d="M4,${GROUND - 120} Q10,${GROUND - 115} 16,${GROUND - 120}" stroke="var(--bg)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <text x="0" y="${GROUND + 22}" text-anchor="middle" font-size="13" fill="var(--muted)">You</text>
    </g>
    <g id="pxThem" class="avatar-g">
      <g style="color:var(--good)" id="pxAuraWrap"><ellipse id="pxAura" class="aura" cx="0" cy="${GROUND - 80}" rx="70" ry="110" fill="url(#auraGrad)"/></g>
      <g id="pxBody">
        <circle cx="0" cy="${GROUND - 128}" r="22" fill="var(--accent-3)"/>
        <path d="M-26,${GROUND} L-20,${GROUND - 98} Q0,${GROUND - 110} 20,${GROUND - 98} L26,${GROUND} Z" fill="var(--accent-3)" opacity=".85"/>
        <circle cx="-14" cy="${GROUND - 132}" r="2.6" fill="var(--bg)"/><circle cx="-6" cy="${GROUND - 132}" r="2.6" fill="var(--bg)"/>
        <path id="pxBrowL" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/>
        <path id="pxBrowR" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/>
        <path id="pxMouth" stroke="var(--bg)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <text id="pxFlag" x="0" y="${GROUND - 160}" text-anchor="middle" font-size="22"></text>
      </g>
      <text id="pxEmo" x="28" y="${GROUND - 112}" font-size="22"></text>
      <text x="0" y="${GROUND + 22}" text-anchor="middle" font-size="13" fill="var(--muted)" id="pxName"></text>
    </g>
    <line id="pxDist" y1="${GROUND + 34}" y2="${GROUND + 34}" stroke="var(--accent)" stroke-width="2"/>
    <text id="pxDistLbl" y="${GROUND + 30}" text-anchor="middle" font-size="12" fill="var(--accent)" font-weight="600"></text>`;

  function face(state) {
    const y = GROUND - 128;
    const mouths = {
      happy: `M-16,${y + 8} Q-10,${y + 14} -4,${y + 8}`,
      tense: `M-16,${y + 10} L-4,${y + 10}`,
      bad: `M-16,${y + 13} Q-10,${y + 6} -4,${y + 13}`,
      cold: `M-15,${y + 10} Q-10,${y + 11} -5,${y + 10}`
    };
    const brows = {
      happy: [`M-17,${y - 10} L-11,${y - 11}`, `M-9,${y - 11} L-3,${y - 10}`],
      tense: [`M-17,${y - 10} L-11,${y - 9}`, `M-9,${y - 9} L-3,${y - 10}`],
      bad: [`M-17,${y - 12} L-11,${y - 8}`, `M-9,${y - 8} L-3,${y - 12}`],
      cold: [`M-17,${y - 10} L-11,${y - 10}`, `M-9,${y - 10} L-3,${y - 10}`]
    };
    $("#pxMouth").setAttribute("d", mouths[state]);
    $("#pxBrowL").setAttribute("d", brows[state][0]);
    $("#pxBrowR").setAttribute("d", brows[state][1]);
  }

  const hallZone = (cm) => cm < 45 ? "intimate distance" : cm < 120 ? "personal distance" : "social distance";

  function update() {
    const cm = +range.value, code = sel.value, c = COUNTRIES[code], comfort = c.proxemics;
    const px = cm * SCALE;
    const ratio = cm / comfort;
    let state, color, verdict, step = 0;
    if (ratio < 0.6) { state = "bad"; color = "var(--bad)"; step = 14; verdict = `🚫 <b>Boundary violation.</b> At ${cm} cm you are in the ${hallZone(cm)} zone — far inside the comfort bubble of a person from ${esc(c.name)} (≈${comfort} cm). They lean back and want to step away.`; }
    else if (ratio < 0.88) { state = "tense"; color = "var(--warn)"; step = 6; verdict = `😬 <b>Tension.</b> ${cm} cm is a little too close for ${esc(c.name)}. Your partner feels uneasy — take half a step back.`; }
    else if (ratio <= 1.6) { state = "happy"; color = "var(--good)"; verdict = `✅ <b>Comfortable.</b> ${cm} cm fits the norm in ${esc(c.name)} (≈${comfort} cm, ${hallZone(comfort)}). Conversation flows naturally.`; }
    else { state = "cold"; color = "var(--accent-2)"; verdict = `🧊 <b>Too distant.</b> For someone from ${esc(c.name)}, ${cm} cm feels formal or cold${c.dims.contact > 60 ? " — in this contact culture distance signals disinterest" : ""}. Step a little closer.`; }

    const meX = MIDX - px / 2, themX = MIDX + px / 2;
    $("#pxMe").setAttribute("transform", `translate(${meX},0)`);
    $("#pxThem").setAttribute("transform", `translate(${themX},0)`);
    $("#pxBody").setAttribute("transform", `rotate(${step} 0 ${GROUND})`);
    $("#pxAuraWrap").style.color = color;
    $("#pxAura").setAttribute("opacity", state === "happy" ? 0.7 : 1);
    const bub = $("#pxBubble");
    bub.setAttribute("cx", themX); bub.setAttribute("r", comfort * SCALE * 0.62);
    bub.setAttribute("stroke", color);
    $("#pxFlag").textContent = c.flag;
    $("#pxName").textContent = c.name;
    $("#pxEmo").textContent = { happy: "😊", tense: "😬", bad: "😣", cold: "😐" }[state];
    $("#pxDist").setAttribute("x1", meX + 24); $("#pxDist").setAttribute("x2", themX - 24);
    $("#pxDistLbl").setAttribute("x", MIDX); $("#pxDistLbl").textContent = cm + " cm";
    $("#proxCm").textContent = cm;
    face(state);
    const v = $("#proxVerdict");
    v.innerHTML = verdict;
    v.style.borderColor = color;
    voice.setCountry(code);
  }

  range.addEventListener("input", () => { update(); markNonverbal("proxemics"); });
  sel.addEventListener("change", update);
  update();
}

/* ---------------------------------------------------------------------
   05b · Voice Tone Tester (Web Audio API, local only)
   --------------------------------------------------------------------- */
function initVoice() {
  const canvas = $("#voiceCanvas"), ctx2 = canvas.getContext("2d"), btn = $("#voiceBtn");
  let code = "IT", audio = null, analyser = null, stream = null, raf = 0;
  let smooth = 0, speechLevels = [], onsets = [], prevEnv = 0, armed = true, speakingMs = 0, lastT = 0, lastVerdict = 0;
  const SILENCE = 22;

  function setCountry(c) {
    code = c;
    const [lo, hi] = COUNTRIES[c].voice;
    const band = $("#voiceBand");
    band.style.left = lo + "%"; band.style.width = (hi - lo) + "%";
    band.title = `Typical range in ${COUNTRIES[c].name}`;
  }

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr; canvas.height = 120 * dpr;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Microphone needs HTTPS or localhost and a supported browser."); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { toast("Microphone access was denied or unavailable."); return; }
    audio = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    audio.createMediaStreamSource(stream).connect(analyser);
    btn.textContent = "Stop microphone";
    speechLevels = []; onsets = []; speakingMs = 0; lastT = performance.now();
    sizeCanvas();
    markNonverbal("voice");
    loop();
  }

  function stop() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audio) audio.close();
    stream = audio = analyser = null;
    btn.textContent = "Start microphone";
  }

  function loop() {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const db = 20 * Math.log10(rms + 1e-8);            // dBFS
    const level = clamp((db + 60) / 60 * 100, 0, 100);   // relative 0–100 scale
    smooth = smooth * 0.8 + level * 0.2;
    const now = performance.now(), dt = now - lastT; lastT = now;

    // syllable-like onset detection on the energy envelope
    if (level > SILENCE) {
      speakingMs += dt;
      speechLevels.push(level);
      if (speechLevels.length > 400) speechLevels.shift();
      if (armed && level > prevEnv + 4 && level > SILENCE + 8) { onsets.push(now); armed = false; }
    }
    if (level < prevEnv - 6 || level < SILENCE) armed = true;
    prevEnv = prevEnv * 0.6 + level * 0.4;
    onsets = onsets.filter((t) => now - t < 6000);

    const w = canvas.clientWidth, h = 120;
    ctx2.clearRect(0, 0, w, h);
    const grad = ctx2.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, css("--accent-2")); grad.addColorStop(1, css("--accent"));
    ctx2.strokeStyle = grad; ctx2.lineWidth = 2; ctx2.beginPath();
    const stepN = Math.ceil(buf.length / w);
    for (let x = 0; x < w; x++) {
      const v = buf[x * stepN] || 0;
      const y = h / 2 + v * h * 1.6;
      x ? ctx2.lineTo(x, y) : ctx2.moveTo(x, y);
    }
    ctx2.stroke();

    $("#voiceFill").style.width = smooth + "%";
    $("#voiceLevel").textContent = Math.round(smooth) + " / 100";

    if (now - lastVerdict > 600 && speechLevels.length > 30) {
      lastVerdict = now;
      const avg = speechLevels.reduce((a, b) => a + b, 0) / speechLevels.length;
      const pace = onsets.length / Math.min(6, Math.max(1, speakingMs / 1000));
      $("#voicePace").textContent = pace.toFixed(1);
      const [lo, hi] = COUNTRIES[code].voice, c = COUNTRIES[code];
      let msg;
      if (avg > hi) msg = `🔊 Your speaking level (${Math.round(avg)}) is <b>louder</b> than typical in ${esc(c.name)} (${lo}–${hi}). ${c.dims.express < 40 ? "Here loud speech can feel aggressive — lower your voice." : "Tone it down slightly in formal settings."}`;
      else if (avg < lo) msg = `🔈 Your level (${Math.round(avg)}) is <b>quieter</b> than typical in ${esc(c.name)} (${lo}–${hi}). ${c.dims.express > 70 ? "In this expressive culture you may seem shy or uninterested — speak up with energy!" : "Speak a little louder to sound confident."}`;
      else msg = `✅ Your loudness (${Math.round(avg)}) fits the norm in ${esc(c.name)} (${lo}–${hi}).`;
      msg += pace > 6 ? " Your pace is fast — slow down for non-native listeners." : pace > 0 && pace < 2.5 ? " Your pace is slow and clear." : "";
      $("#voiceVerdict").innerHTML = msg;
    }
    raf = requestAnimationFrame(loop);
  }

  btn.addEventListener("click", () => (stream ? stop() : start()));
  window.addEventListener("resize", () => { if (stream) sizeCanvas(); });
  return { setCountry };
}

/* ---------------------------------------------------------------------
   06 · Roleplay Simulator
   --------------------------------------------------------------------- */
function initRoleplay() {
  const chat = $("#rpChat"), opts = $("#rpOptions");
  let sc = null, step = 0, trust = 50, busy = false, run = 0;
  if (!ROLEPLAYS.length) { chat.innerHTML = '<div class="msg sys">No scenarios yet — add one in the admin panel.</div>'; return; }

  $("#rpTabs").innerHTML = ROLEPLAYS.map((r, i) => `<button class="chip ${i === 0 ? "active" : ""}" data-i="${i}">${COUNTRIES[r.country] ? COUNTRIES[r.country].flag : ""} ${esc(r.title)}</button>`).join("");
  $("#rpTabs").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    $$("#rpTabs .chip").forEach((c) => c.classList.toggle("active", c === b));
    start(ROLEPLAYS[+b.dataset.i]);
  });

  function setTrust(v, mood) {
    trust = clamp(v, 0, 100);
    const fill = $("#rpTrust");
    fill.style.width = trust + "%";
    fill.style.background = `linear-gradient(90deg, hsl(${trust * 1.2 - 20},80%,55%), hsl(${trust * 1.2},75%,50%))`;
    $("#rpTrustVal").textContent = Math.round(trust) + "%";
    if (mood && MOODS[mood]) {
      const m = $("#rpMood");
      m.textContent = MOODS[mood].emoji; m.title = MOODS[mood].label;
      m.classList.remove("bump"); void m.offsetWidth; m.classList.add("bump");
    }
  }

  function add(cls, html) {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.innerHTML = html;
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }

  function start(s) {
    sc = s; step = 0; busy = false; run++;
    chat.innerHTML = ""; opts.innerHTML = "";
    $("#rpAvatar").textContent = s.avatar;
    $("#rpName").textContent = s.npc;
    $("#rpRole").textContent = s.npcRole + (COUNTRIES[s.country] ? " · " + COUNTRIES[s.country].flag : "");
    setTrust(s.start, "neutral");
    add("sys", "🎬 " + esc(s.intro));
    npcTurn();
  }

  function npcTurn() {
    const st = sc.steps[step], myRun = run;
    add("npc typing", "…");
    setTimeout(() => {
      if (myRun !== run) return; // scenario switched meanwhile
      chat.lastChild.remove();
      add("npc", `<b>${esc(sc.npc)}:</b> ${esc(st.npc)}`);
      opts.innerHTML = shuffle(st.options.map((o, i) => ({ o, i }))).map(({ o, i }) => `<button class="rp-opt" data-i="${i}">${esc(o.text)}</button>`).join("");
    }, 700);
  }

  opts.addEventListener("click", (e) => {
    const b = e.target.closest(".rp-opt"); if (!b || busy) return;
    busy = true;
    const o = sc.steps[step].options[+b.dataset.i], myRun = run;
    opts.innerHTML = "";
    add("me", esc(o.text));
    setTimeout(() => {
      if (myRun !== run) return;
      setTrust(trust + o.delta, o.mood);
      add("fb " + (o.delta >= 0 ? "plus" : "minus"), `<b style="color:${o.delta >= 0 ? "var(--good)" : "var(--bad)"}">${o.delta >= 0 ? "+" : ""}${o.delta}%</b>${esc(o.feedback)}`);
      step++;
      busy = false;
      if (step < sc.steps.length) setTimeout(npcTurn, 600);
      else setTimeout(finish, 700);
    }, 450);
  });

  function finish() {
    const t = Math.round(trust);
    const r = t >= 80 ? ["🤝", "Trusted friend", "You read the cultural code perfectly."] : t >= 60 ? ["🙂", "Good relationship", "Solid result — a couple of moves could be even more culturally tuned."] : t >= 40 ? ["😐", "Neutral acquaintance", "Some cultural signals were missed. Review the feedback and try again."] : ["💔", "Trust broken", "Several replies clashed with local norms. Try again using the explanations."];
    const best = Math.max(progress.roleplay[sc.id] || 0, t);
    saveProgress({ roleplay: Object.assign({}, progress.roleplay, { [sc.id]: best }) });
    api(`/scenarios/${encodeURIComponent(sc.id)}/result`, { trust: t }).catch(() => {});
    opts.innerHTML = `<div class="rp-end"><div class="big">${r[0]}</div><h3>${r[1]} · ${t}% trust</h3><p class="muted">${r[2]}</p><button class="btn primary" id="rpAgain">Play again</button></div>`;
    $("#rpAgain").addEventListener("click", () => start(sc));
  }

  start(ROLEPLAYS[0]);
}

/* ---------------------------------------------------------------------
   07 · Match the Cultural Customs (drag & drop + tap, checked on server)
   --------------------------------------------------------------------- */
function initMatch() {
  const pool = $("#matchPool"), slots = $("#matchSlots");
  let picked = null, checked = false;

  const cardHTML = (m) => `<div class="mcard" draggable="true" data-id="${esc(m.slug)}"><span class="mi">${esc(m.icon)}</span>${esc(m.custom)}</div>`;

  async function reset() {
    checked = false; picked = null;
    $("#matchResult").hidden = true;
    slots.classList.remove("armed");
    try {
      const d = await api("/match");
      totals.match = d.customs.length;
      pool.innerHTML = d.customs.map(cardHTML).join("");
      slots.innerHTML = d.situations.map((s) => `<div class="slot" data-sid="${s.id}"><p>${esc(s.text)}</p><div class="drop"></div></div>`).join("");
    } catch (e) { pool.innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`; }
  }

  function place(card, target) {
    if (checked) clearMarks();
    if (target === pool) { pool.appendChild(card); return; }
    const existing = target.querySelector(".mcard");
    if (existing && existing !== card) {
      const from = card.parentElement;
      (from && from.classList.contains("drop") ? from : pool).appendChild(existing); // swap
    }
    target.appendChild(card);
  }
  function clearMarks() { checked = false; $$(".slot", slots).forEach((s) => s.classList.remove("right", "wrong")); }
  function unpick() { if (picked) picked.classList.remove("picked"); picked = null; slots.classList.remove("armed"); }

  // native drag & drop (desktop)
  document.addEventListener("dragstart", (e) => {
    const c = e.target.closest && e.target.closest(".mcard"); if (!c) return;
    e.dataTransfer.setData("text/plain", c.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    c.classList.add("dragging");
  });
  document.addEventListener("dragend", (e) => { const c = e.target.closest && e.target.closest(".mcard"); if (c) c.classList.remove("dragging"); $$(".drop.over").forEach((d) => d.classList.remove("over")); });
  [slots, pool].forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      const d = e.target.closest(".drop") || (zone === pool ? pool : null);
      if (!d) return;
      e.preventDefault();
      $$(".drop.over").forEach((x) => x !== d && x.classList.remove("over"));
      if (d !== pool) d.classList.add("over");
    });
    zone.addEventListener("drop", (e) => {
      const d = e.target.closest(".drop") || (zone === pool ? pool : null);
      if (!d) return;
      e.preventDefault();
      d.classList.remove("over");
      const card = $(`.mcard[data-id="${CSS.escape(e.dataTransfer.getData("text/plain"))}"]`);
      if (card) place(card, d);
      unpick();
    });
  });

  // tap-to-place (touch & keyboard-friendly)
  document.getElementById("match").addEventListener("click", (e) => {
    const card = e.target.closest(".mcard");
    if (card) {
      if (picked === card) { unpick(); return; }
      unpick();
      picked = card; card.classList.add("picked"); slots.classList.add("armed");
      return;
    }
    const drop = e.target.closest(".drop") || (e.target.closest(".slot") && e.target.closest(".slot").querySelector(".drop"));
    if (drop && picked) { place(picked, drop); unpick(); return; }
    if (e.target.closest("#matchPool") && picked) { place(picked, pool); unpick(); }
  });

  $("#matchCheck").addEventListener("click", async () => {
    const all = $$(".slot", slots);
    const pairs = {};
    all.forEach((s) => { const c = s.querySelector(".mcard"); if (c) pairs[s.dataset.sid] = c.dataset.id; });
    const filled = Object.keys(pairs).length;
    if (filled < all.length && !confirm(`Only ${filled} of ${all.length} situations are matched. Check anyway?`)) return;
    let r;
    try { r = await api("/match/check", { pairs }); } catch (e) { toast(e.message); return; }
    all.forEach((s) => {
      const ok = !!r.results[s.dataset.sid];
      s.classList.toggle("right", ok);
      s.classList.toggle("wrong", !ok);
    });
    checked = true;
    if (r.score > progress.match) saveProgress({ match: r.score });
    const res = $("#matchResult");
    res.hidden = false;
    res.innerHTML = `
      <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="score-big">${r.score}/${r.total}</span>
        <div><b>${r.score === r.total ? "Perfect cultural radar! 🎉" : r.score >= r.total * 0.7 ? "Great job — just a few mix-ups." : "Keep exploring — read the explanations below."}</b><div class="muted">Scientific explanation of each tradition:</div></div>
      </div>
      <div class="explain-grid">${r.explanations.map((m) => `<div class="dec-block"><h4>${m.correct ? "✅" : "❌"} ${esc(m.icon)} ${esc(m.custom)} → ${m.flag} ${esc(m.country)}</h4><p>${esc(m.explain)}</p></div>`).join("")}</div>`;
    if (r.score === r.total) confetti();
    res.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("#matchReset").addEventListener("click", reset);
  reset();
}

/* ---------------------------------------------------------------------
   08 · Cultural Awareness Quiz (answers verified on the server)
   --------------------------------------------------------------------- */
function initQuiz() {
  const box = $("#quizCard");
  let questions = [], i = 0, score = 0, results = [], answers = {}, busy = false;

  async function startQuiz() {
    box.innerHTML = `<div class="empty" style="display:grid;place-items:center;min-height:200px"><span class="spinner"></span></div>`;
    try { questions = await api("/quiz"); } catch (e) { box.innerHTML = `<p>⚠️ ${esc(e.message)}</p>`; return; }
    totals.quiz = questions.length || 1;
    i = 0; score = 0; results = []; answers = {};
    if (!questions.length) { box.innerHTML = "<p>No quiz cases yet — add some in the admin panel.</p>"; return; }
    render();
  }

  const progressBar = () => `<div class="q-progress">${questions.map((_, k) => `<i class="${k < results.length ? (results[k] ? "ok" : "no") : k === i ? "cur" : ""}"></i>`).join("")}</div>`;

  function render() {
    const q = questions[i];
    box.innerHTML = `${progressBar()}
      <div class="q-meta"><span>${esc(q.flag)} ${esc(q.topic)}</span><span>Question ${i + 1} / ${questions.length} · Score ${score}</span></div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="q-opts">${q.options.map((o, n) => `<button class="q-opt" data-id="${o.id}"><b>${"ABCDEF"[n]}</b><span>${esc(o.text)}</span></button>`).join("")}</div>
      <div id="qExplain"></div>`;
  }

  box.addEventListener("click", async (e) => {
    const b = e.target.closest(".q-opt");
    if (b && !b.disabled && !busy) {
      busy = true;
      const q = questions[i], optionId = +b.dataset.id;
      $$(".q-opt", box).forEach((o) => { o.disabled = true; });
      let r;
      try { r = await api(`/quiz/${q.id}/answer`, { option_id: optionId }); }
      catch (err) { toast(err.message); $$(".q-opt", box).forEach((o) => { o.disabled = false; }); busy = false; return; }
      busy = false;
      answers[q.id] = optionId;
      if (r.correct) score++;
      results.push(r.correct);
      $$(".q-opt", box).forEach((o) => { if (+o.dataset.id === r.correct_option_id) o.classList.add("correct"); });
      if (!r.correct) b.classList.add("incorrect");
      box.querySelector(".q-progress").outerHTML = progressBar();
      box.querySelector(".q-meta span:last-child").textContent = `Question ${i + 1} / ${questions.length} · Score ${score}`;
      $("#qExplain").innerHTML = `<div class="q-explain"><div class="dec-block"><h4>${r.correct ? "✅ Correct!" : "❌ Not quite"} — Explanation</h4><p>${esc(r.explanation)}</p></div>
        <div class="q-next"><button class="btn primary" id="qNext">${i < questions.length - 1 ? "Next Question →" : "See my result 🏁"}</button></div></div>`;
      return;
    }
    if (e.target.closest("#qNext")) { i++; i < questions.length ? render() : finish(); return; }
    if (e.target.closest("#qRestart")) startQuiz();
  });

  async function finish() {
    let r;
    try { r = await api("/quiz/finish", { answers }); } catch (e) { toast(e.message); return; }
    if (r.score > progress.quiz) saveProgress({ quiz: r.score });
    const badge = r.badge || { icon: "🎓", title: "Cultural Awareness", text: "" };
    box.innerHTML = `${progressBar()}
      <div class="badge">
        <div class="badge-medal"><span>${esc(badge.icon)}</span></div>
        <div class="muted">You scored</div>
        <div class="score-big">${r.score} / ${r.total}</div>
        <h3 class="grad" style="font-size:1.6rem">${esc(badge.title)}</h3>
        <p class="muted">${esc(badge.text)}</p>
        <div class="explain-grid" style="text-align:left">${r.review.map((q) => `<div class="dec-block"><h4>${q.correct ? "✅" : "❌"} ${esc(q.flag)} ${esc(q.topic)}</h4><p>${esc(q.answer)}</p></div>`).join("")}</div>
        <div class="match-actions" style="justify-content:center"><button class="btn primary" id="qRestart">Try again</button></div>
      </div>`;
    if (r.score >= Math.round(r.total * 10 / 12)) confetti();
  }

  startQuiz();
}

/* ---------------------------------------------------------------------
   Confetti
   --------------------------------------------------------------------- */
function confetti() {
  const colors = [css("--accent"), css("--accent-2"), css("--accent-3"), css("--warn"), css("--good")];
  for (let k = 0; k < 90; k++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[k % colors.length];
    c.style.animationDuration = 2 + Math.random() * 2.5 + "s";
    c.style.animationDelay = Math.random() * 0.6 + "s";
    c.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 5500);
  }
}

/* ---------------------------------------------------------------------
   Boot: load reference data from the API, then start every module
   --------------------------------------------------------------------- */
async function boot() {
  let data, scenarios;
  try {
    [data, scenarios] = await Promise.all([api("/bootstrap"), api("/scenarios"),
      document.fonts ? document.fonts.load('16px "Twemoji Country Flags"', "🇰🇿").catch(() => {}) : null]);
  } catch (e) {
    $("#loader").innerHTML = `⚠️ Could not reach the server: ${esc(e.message)}`;
    return;
  }
  COUNTRIES = data.countries;
  CODES = Object.keys(COUNTRIES);
  DIMENSIONS = data.dimensions;
  GREETINGS = data.greetings;
  MOODS = data.moods;
  ROLEPLAYS = scenarios;
  CODES.forEach((c) => { ISO_TO_CODE[COUNTRIES[c].iso] = c; });

  const unis = CODES.reduce((n, c) => n + (COUNTRIES[c].alumni ? COUNTRIES[c].alumni.universities.length : 0), 0);
  const s = data.stats;
  countUp($('[data-count="countries"]'), CODES.length);
  countUp($('[data-count="universities"]'), unis);
  countUp($('[data-count="attempts"]'), s.quiz.count + s.match.count + s.roleplay.count);
  $("#refs").innerHTML = data.references.map((r) => `<li>${esc(r)}</li>`).join("");

  initGlobe();
  initAtlas();
  initGreetings();
  radar = initRadar();
  initDecoder(data.presets, data.ai);
  initProxemics(initVoice());
  initRoleplay();
  initMatch();
  initQuiz();
  renderPassport();
  $("#loader").remove();
}

boot();
})();

/* =====================================================================
   CultureBridge AI — frontend (talks to the Flask REST API)
   Modules: theme · progress (CQ passport) · globe · atlas · greetings ·
   gap radar · AI decoder · proxemics lab · voice tester · roleplay ·
   3D cultural sandbox ·
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
  if (!t) return;
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
function applyThemeIcon() { const btn = $("#themeBtn"); if (btn) btn.textContent = document.documentElement.dataset.theme === "light" ? "☀" : "☾"; }
const _themeBtn = $("#themeBtn");
if (_themeBtn) _themeBtn.addEventListener("click", () => {
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
  const bars = $("#passportBars"); if (!bars) return;
  const vals = PASSPORT.map((p) => clamp(p.val(), 0, 1));
  bars.innerHTML = PASSPORT.map((p, i) => `<div class="pbar">${p.label}<div><i style="width:${Math.round(vals[i] * 100)}%"></i></div></div>`).join("");
  const sc = $("#cqScore"); if (sc) sc.textContent = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100);
}

/* ---------------------------------------------------------------------
   Scroll reveal, nav highlight, count-up stats
   --------------------------------------------------------------------- */
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealObs.unobserve(e.target); } });
}, { threshold: 0.08 });
$$(".reveal").forEach((el) => revealObs.observe(el));

/* ---------------------------------------------------------------------
   Navigation: Mega-Dropdowns, Mobile Drawer, Quick Search & Auth
   --------------------------------------------------------------------- */
function initNavigation() {
  // 1. Dropdown interactions
  const dropdowns = $$("[data-dropdown]");
  dropdowns.forEach((dd) => {
    const btn = dd.querySelector("button");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dd.classList.contains("is-open");
      dropdowns.forEach((other) => {
        if (other !== dd) {
          other.classList.remove("is-open");
          const b = other.querySelector("button");
          if (b) b.setAttribute("aria-expanded", "false");
        }
      });
      dd.classList.toggle("is-open", !isOpen);
      btn.setAttribute("aria-expanded", !isOpen ? "true" : "false");
    });
  });

  // Close dropdowns on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-dropdown]")) {
      dropdowns.forEach((dd) => {
        dd.classList.remove("is-open");
        const b = dd.querySelector("button");
        if (b) b.setAttribute("aria-expanded", "false");
      });
    }
  });

  // 2. Mobile Drawer
  const mobileMenuBtn = $("#mobileMenuBtn");
  const mobileDrawer = $("#mobileDrawer");
  const mobileBackdrop = $("#mobileDrawerBackdrop");
  const mobileCloseBtn = $("#mobileCloseBtn");

  function openMobileDrawer() {
    if (!mobileDrawer) return;
    mobileDrawer.classList.add("is-open");
    if (mobileBackdrop) mobileBackdrop.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function closeMobileDrawer() {
    if (!mobileDrawer) return;
    mobileDrawer.classList.remove("is-open");
    if (mobileBackdrop) mobileBackdrop.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  if (mobileMenuBtn) mobileMenuBtn.addEventListener("click", openMobileDrawer);
  if (mobileCloseBtn) mobileCloseBtn.addEventListener("click", closeMobileDrawer);
  if (mobileBackdrop) mobileBackdrop.addEventListener("click", closeMobileDrawer);

  if (mobileDrawer) {
    mobileDrawer.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMobileDrawer);
    });
  }

  // 3. Quick Search Modal (Command Palette)
  const searchModal = $("#searchModal");
  const searchInput = $("#siteSearchInput");
  const searchList = $("#searchQuickList");
  const openSearchBtn = $("#openSearchBtn");
  const mobileOpenSearchBtn = $("#mobileOpenSearchBtn");
  const searchEscBtn = $("#searchEscBtn");

  const SEARCH_ITEMS = [
    { title: "Guided Country Tracks", desc: "Systematic 5-stage intercultural preparation", icon: "🎓", url: "/learn", badge: "Core" },
    { title: "World Atlas & NIS Alumni", desc: "Interactive 3D globe and student stories abroad", icon: "🌍", url: "/atlas", badge: "Explore" },
    { title: "Greetings of the World", desc: "20 cultures with words, gestures and speech audio", icon: "👋", url: "/greetings", badge: "Explore" },
    { title: "6D Cultural Gap Radar", desc: "Hofstede & Meyer cultural distance calculator", icon: "📡", url: "/radar", badge: "Explore" },
    { title: "AI Pragmatic Subtext Decoder", desc: "How locals really hear your words + polite phrases", icon: "🧠", url: "/decoder", badge: "AI Tool" },
    { title: "Proxemics & Voice Lab", desc: "3D personal space bubble & mic pitch tuner", icon: "📏", url: "/proxemics", badge: "AI Tool" },
    { title: "Roleplay Simulation", desc: "Conversational dilemmas with real-time trust meter", icon: "🎭", url: "/roleplay", badge: "AI Tool" },
    { title: "Match Cultural Customs", desc: "Drag & drop challenge: match customs to situations", icon: "🧩", url: "/match", badge: "Practice" },
    { title: "Cultural Awareness Quiz", desc: "12 real-life case questions + CQ certificate", icon: "🏆", url: "/quiz", badge: "Practice" },
    { title: "Live Community Stats", desc: "Global benchmark, mistakes & database stats", icon: "📊", url: "/stats", badge: "Practice" },
    { title: "Methodology & Framework", desc: "Hofstede, Hall, Meyer & NIS survey science", icon: "📚", url: "/about", badge: "Resource" },
    { title: "REST API Reference", desc: "Complete OpenAPI specification & endpoints", icon: "🔌", url: "/docs", badge: "Resource" },
    // Countries
    { title: "United States Track", desc: "Low-context, individualistic, egalitarian culture", icon: "🇺🇸", url: "/learn?country=US", badge: "Country" },
    { title: "Germany Track", desc: "Direct feedback, task-based trust, linear-time", icon: "🇩🇪", url: "/learn?country=DE", badge: "Country" },
    { title: "Italy Track", desc: "Expressive greetings, relationship-first trust", icon: "🇮🇹", url: "/learn?country=IT", badge: "Country" },
    { title: "South Korea Track", desc: "High hierarchy, indirect communication, nunchi", icon: "🇰🇷", url: "/learn?country=KR", badge: "Country" },
    { title: "Japan Track", desc: "Omotenashi, high context, consensus decision-making", icon: "🇯🇵", url: "/learn?country=JP", badge: "Country" },
    { title: "United Kingdom Track", desc: "Understatement, polite hedging, indirect critique", icon: "🇬🇧", url: "/learn?country=GB", badge: "Country" },
    { title: "China Track", desc: "Guanxi, face-saving, top-down hierarchy", icon: "🇨🇳", url: "/learn?country=CN", badge: "Country" },
    { title: "Turkey Track", desc: "Warm hospitality, polychronic time, relational", icon: "🇹🇷", url: "/learn?country=TR", badge: "Country" },
    { title: "Kazakhstan Benchmark", desc: "High hospitality, family collectivism, respect for elders", icon: "🇰🇿", url: "/learn?country=KZ", badge: "Country" },
  ];

  let selectedSearchIndex = 0;

  function renderSearchResults(query = "") {
    if (!searchList) return;
    const q = query.trim().toLowerCase();
    const filtered = q
      ? SEARCH_ITEMS.filter((item) =>
          item.title.toLowerCase().includes(q) ||
          item.desc.toLowerCase().includes(q) ||
          item.badge.toLowerCase().includes(q)
        )
      : SEARCH_ITEMS.slice(0, 8);

    if (!filtered.length) {
      searchList.innerHTML = `<div class="search-empty muted" style="padding: 16px; text-align: center;">No matching modules or countries found for "<b>${esc(query)}</b>"</div>`;
      return;
    }

    selectedSearchIndex = Math.min(selectedSearchIndex, filtered.length - 1);
    if (selectedSearchIndex < 0) selectedSearchIndex = 0;

    searchList.innerHTML = filtered.map((item, idx) => `
      <a href="${item.url}" class="search-item ${idx === selectedSearchIndex ? 'selected' : ''}" data-index="${idx}">
        <span class="search-item-icon">${item.icon}</span>
        <div class="search-item-info">
          <div class="search-item-name">${item.title}</div>
          <div class="search-item-desc">${item.desc}</div>
        </div>
        <span class="search-item-badge">${item.badge}</span>
      </a>
    `).join("");
  }

  function openSearchModal() {
    if (!searchModal) return;
    searchModal.classList.add("is-open");
    closeMobileDrawer();
    selectedSearchIndex = 0;
    renderSearchResults("");
    if (searchInput) {
      searchInput.value = "";
      setTimeout(() => searchInput.focus(), 60);
    }
  }

  function closeSearchModal() {
    if (!searchModal) return;
    searchModal.classList.remove("is-open");
  }

  if (openSearchBtn) openSearchBtn.addEventListener("click", openSearchModal);
  if (mobileOpenSearchBtn) mobileOpenSearchBtn.addEventListener("click", openSearchModal);
  if (searchEscBtn) searchEscBtn.addEventListener("click", closeSearchModal);

  if (searchModal) {
    searchModal.addEventListener("click", (e) => {
      if (e.target === searchModal) closeSearchModal();
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      selectedSearchIndex = 0;
      renderSearchResults(e.target.value);
    });

    searchInput.addEventListener("keydown", (e) => {
      const items = $$(".search-item", searchList);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length) {
          selectedSearchIndex = (selectedSearchIndex + 1) % items.length;
          items.forEach((it, idx) => it.classList.toggle("selected", idx === selectedSearchIndex));
          items[selectedSearchIndex].scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length) {
          selectedSearchIndex = (selectedSearchIndex - 1 + items.length) % items.length;
          items.forEach((it, idx) => it.classList.toggle("selected", idx === selectedSearchIndex));
          items[selectedSearchIndex].scrollIntoView({ block: "nearest" });
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = $(".search-item.selected", searchList) || $(".search-item", searchList);
        if (selected) {
          const href = selected.getAttribute("href");
          if (href) window.location.href = href;
        }
      } else if (e.key === "Escape") {
        closeSearchModal();
      }
    });
  }

  // Global Keyboard Shortcuts (Cmd+K / Ctrl+K / Escape)
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (searchModal && searchModal.classList.contains("is-open")) {
        closeSearchModal();
      } else {
        openSearchModal();
      }
    } else if (e.key === "Escape") {
      closeSearchModal();
      closeMobileDrawer();
      dropdowns.forEach((dd) => dd.classList.remove("is-open"));
    }
  });

  // 4. Logout Handlers
  async function performLogout() {
    try {
      await api("/auth/logout", {});
      toast("Successfully signed out");
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      window.location.href = "/auth";
    }
  }

  const navLogoutBtn = $("#navLogout");
  const mobileNavLogoutBtn = $("#mobileNavLogout");
  if (navLogoutBtn) navLogoutBtn.addEventListener("click", performLogout);
  if (mobileNavLogoutBtn) mobileNavLogoutBtn.addEventListener("click", performLogout);
}
initNavigation();

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
    card.querySelector("[data-go]").addEventListener("click", () => {
      if (typeof radar !== "undefined" && radar && document.getElementById("radar")) {
        radar.set("KZ", code === "KZ" ? "DE" : code);
        document.getElementById("radar").scrollIntoView({ behavior: "smooth" });
      } else {
        window.location.href = `/radar?from=KZ&to=${encodeURIComponent(code === "KZ" ? "DE" : code)}`;
      }
    });
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

  const greetWrap = $("#greetings") || $("#marquee1")?.closest(".section") || document.body;
  if (greetWrap) {
    greetWrap.addEventListener("click", (e) => {
      const sp = e.target.closest(".speak");
      if (sp) { e.stopPropagation(); speak(GREETINGS[+sp.dataset.i]); return; }
      const c = e.target.closest(".gcard");
      if (c) c.classList.toggle("flipped");
    });
  }
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

  const urlParams = new URLSearchParams(window.location.search);
  const qFrom = urlParams.get("from");
  const qTo = urlParams.get("to");
  countryOptions(fromSel, qFrom && COUNTRIES[qFrom] ? qFrom : "KZ");
  countryOptions(toSel, qTo && COUNTRIES[qTo] ? qTo : "DE");
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
      <div class="dec-block adapted"><h4>✨ Culturally adapted for ${esc(c.name)} <button class="copy" data-copy="${esc(r.adapted)}" id="copyBtn">Copy</button></h4><p id="adaptedText" class="typing"></p></div>
      ${r.variants && r.variants.en && r.variants.en[1] && r.variants.en[1] !== r.adapted ? `<div class="dec-block"><h4>Alternative English register <button class="copy" data-copy="${esc(r.variants.en[1])}">Copy</button></h4><p>${esc(r.variants.en[1])}</p></div>` : ""}
      ${r.variants && r.variants.local && r.variants.local.text ? `<div class="dec-block"><h4>🗣 ${esc(r.variants.local.language || c.name)} <button class="copy" data-copy="${esc(r.variants.local.text)}">Copy</button></h4><p style="font-weight:500">${esc(r.variants.local.text)}</p></div>` : ""}
      ${r.notes && r.notes.length ? `<div class="dec-block"><h4>🔬 Why</h4>${r.notes.map((n) => `<p style="font-size:.88rem;margin-bottom:4px">• ${esc(n)}</p>`).join("")}</div>` : ""}`;
    requestAnimationFrame(() => { const n = out.querySelector(".needle"); if (n) n.style.transform = `rotate(${deg}deg)`; });
    const gv = $("#gaugeVal"); let v = 0;
    const iv = setInterval(() => { v = Math.min(r.risk, v + Math.max(1, Math.round(r.risk / 25))); gv.textContent = v + "%"; if (v >= r.risk) clearInterval(iv); }, 30);
    const at = $("#adaptedText"); let i = 0;
    const tw = setInterval(() => { at.textContent = r.adapted.slice(0, ++i); if (i >= r.adapted.length) { clearInterval(tw); at.classList.remove("typing"); } }, 14);
    out.querySelectorAll(".copy").forEach((b) => {
      b.addEventListener("click", () => {
        const textToCopy = b.dataset.copy || r.adapted;
        (navigator.clipboard ? navigator.clipboard.writeText(textToCopy) : Promise.reject()).then(() => toast("Copied!"), () => toast("Copy not available here."));
      });
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
  const canvas = $("#voiceCanvas"), btn = $("#voiceBtn");
  if (!canvas || !btn) return { setCountry: () => {} };
  const ctx2 = canvas.getContext("2d");
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
   06b · 3D AI Cultural Sandbox — any nation × any situation, embodied NPC
   (3D engine: static/js/sandbox3d.js · brain: POST /api/roleplay/interact)
   --------------------------------------------------------------------- */
const ACTION_TEXT = {
  bow: "🙇 bows", handshake: "🤝 offers a handshake", hug: "🫂 goes in for a hug", give_two_hands: "🤲 gives it with both hands",
  give_one_hand: "✋ hands it over with one hand", give_clock: "🎁 gives a clock", accept_tea: "🍵 accepts the tea / food",
  refuse_food_bluntly: "🙅 refuses the food", step_too_close: "🚶 steps very close", step_optimal: "📏 keeps a comfortable distance",
  eye_contact_intense: "👀 holds direct eye contact", modest_gaze: "😌 lowers the gaze modestly"
};
const ANIM_TEXT = {
  idle_breathing: "😮‍💨 idle · breathing", bow_respect: "🙇 bow of respect", handshake_reach: "🤝 reaches for a handshake",
  two_hands_present: "🤲 presents with both hands", expressive_gestures: "🙌 expressive gestures",
  step_back_uncomfortable: "🙅 steps back · arms crossed", warm_welcome_tea: "🍵 warm welcome · offers tea",
  nod_approval: "👍 nods in approval", offended_look_away: "😤 offended · looks away"
};

async function initSandbox() {
  const canvas = $("#sbCanvas"), chat = $("#sbChat"), loading = $("#sbLoading");
  const distInput = $("#sbDist");

  $("#rpModes").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    $$("#rpModes .chip").forEach((c) => { c.classList.toggle("active", c === b); c.setAttribute("aria-selected", String(c === b)); });
    $("#sandboxMode").hidden = b.dataset.mode !== "sandbox";
    $("#classicMode").hidden = b.dataset.mode !== "classic";
    if (b.dataset.mode !== "sandbox") stopSpeech();
  });

  let matrix;
  try { matrix = await api("/roleplay/sandbox"); }
  catch (e) { loading.textContent = "⚠️ " + e.message; return; }
  const SIT = Object.fromEntries(matrix.situations.map((s) => [s.id, s]));
  const qs = new URLSearchParams(location.search);
  const S = {
    code: CODES.includes((qs.get("country") || "").toUpperCase()) ? qs.get("country").toUpperCase() : (CODES.includes("JP") ? "JP" : CODES[0]),
    situation: SIT[qs.get("situation")] ? qs.get("situation") : "academic_dispute",
    custom: "", trust: 50, turn: 0, history: [], busy: false, run: 0, distance: 120,
    retreated: false, lastClose: 0, persona: null, speakTimer: 0, subTimer: 0
  };
  $("#sbComboCount").textContent = CODES.length * matrix.situations.length;

  let stage = null;
  if (window.CBSandbox3D) {
    try {
      stage = new CBSandbox3D.Stage(canvas, {
        onWheel: (d) => setDistance(S.distance + d, true),
        onAnim: (n) => { $("#sbAnimTag").textContent = "🎬 " + (ANIM_TEXT[n] || n); }
      });
      loading.remove();
    } catch (e) { loading.textContent = "WebGL is not available here — you can still talk to the character."; }
  } else loading.textContent = "3D engine failed to load — you can still talk to the character.";

  // ---- selectors -----------------------------------------------------
  $("#sbNations").innerHTML = CODES.map((c) => `<button class="sb-nation" role="radio" data-code="${c}" title="${esc(COUNTRIES[c].name)}"><span>${COUNTRIES[c].flag}</span><small>${esc(COUNTRIES[c].name)}</small></button>`).join("");
  $("#sbSituations").innerHTML = matrix.situations.map((s) => `<button class="sb-sit" role="radio" data-sit="${s.id}"><span class="sb-sit-icon">${s.icon}</span><b>${esc(s.title)}</b><small>${esc(s.role)}</small></button>`).join("");
  $("#sbNations").addEventListener("click", (e) => { const b = e.target.closest(".sb-nation"); if (b && b.dataset.code !== S.code) { S.code = b.dataset.code; start(); } });
  $("#sbSituations").addEventListener("click", (e) => { const b = e.target.closest(".sb-sit"); if (b && b.dataset.sit !== S.situation) { S.situation = b.dataset.sit; start(); } });
  $("#sbCustomForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#sbCustom").value.trim();
    if (!v) { toast("Describe the situation in one line first"); return; }
    S.custom = v; start();
  });

  function markSelection() {
    $$("#sbNations .sb-nation").forEach((b) => { const on = b.dataset.code === S.code; b.classList.toggle("active", on); b.setAttribute("aria-checked", String(on)); });
    $$("#sbSituations .sb-sit").forEach((b) => { const on = b.dataset.sit === S.situation; b.classList.toggle("active", on); b.setAttribute("aria-checked", String(on)); });
    $("#sbCustomForm").hidden = S.situation !== "custom_sandbox";
  }

  // ---- UI helpers ----------------------------------------------------
  function add(cls, html) {
    const d = document.createElement("div");
    d.className = "msg " + cls; d.innerHTML = html;
    chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
    return d;
  }
  function setTrust(v, mood) {
    S.trust = clamp(v, 0, 100);
    const fill = $("#sbTrust");
    fill.style.width = S.trust + "%";
    fill.style.background = `linear-gradient(90deg, hsl(${S.trust * 1.2 - 20},80%,55%), hsl(${S.trust * 1.2},75%,50%))`;
    $("#sbTrustVal").textContent = Math.round(S.trust) + "%";
    if (mood && MOODS[mood]) {
      const m = $("#sbMood");
      m.textContent = MOODS[mood].emoji; m.title = MOODS[mood].label;
      m.classList.remove("bump"); void m.offsetWidth; m.classList.add("bump");
    }
  }
  function setBusy(on) {
    S.busy = on;
    $("#sbSend").disabled = on;
    $("#sbGestures").classList.toggle("busy", on);
  }
  function subtitle(text) {
    const el = $("#sbSubtitle");
    el.textContent = text; el.classList.toggle("show", !!text);
    clearTimeout(S.subTimer);
    if (text) S.subTimer = setTimeout(() => el.classList.remove("show"), clamp(text.length * 70, 3500, 12000));
  }

  function renderProfile() {
    const c = COUNTRIES[S.code];
    $("#sbProfileName").textContent = `${c.flag} ${c.name}`;
    $("#sbDims").innerHTML = DIMENSIONS.map((d) => {
      const v = c.dims[d.key];
      return `<div class="sb-dim"><span title="${esc(d.low)} ↔ ${esc(d.high)}">${esc(d.label)}</span><div><i style="width:${v}%"></i></div><b>${v}</b></div>`;
    }).join("");
    $("#sbFacts").innerHTML = `<span>🧭 ${esc(c.context)}</span><span>📏 ${c.proxemics} cm comfort</span>` +
      `<span>🔊 voice ${c.voice[0]}–${c.voice[1]}</span><span>🍲 hospitality ×${c.hospitality != null ? c.hospitality : "—"}</span>` +
      `<p class="muted">${esc(c.mentality)}</p>`;
  }

  // Hall's zones as a top-down radar in the HUD (character in the centre, you below it)
  function renderRadar() {
    const c = COUNTRIES[S.code], k = 85 / 300, comfort = c.proxemics, thr = comfort * 0.75;
    const ring = (cm, cls) => `<circle r="${Math.min(cm, 300) * k}" class="${cls}"/>`;
    const y = Math.min(S.distance, 300) * k;
    const inside = S.distance < thr;
    $("#sbRadar").innerHTML = `<circle r="${thr * k}" class="rz-danger ${inside ? "on" : ""}"/>` + ring(45, "rz-int") + ring(120, "rz-pers") +
      ring(300, "rz-soc") + ring(comfort, "rz-comfort") + `<circle r="5" class="rz-npc"/>` +
      `<circle cy="${y}" r="6" class="rz-me ${inside ? "bad" : ""}"/><text y="-88" class="rz-txt">Hall zones</text>`;
    $("#sbDistVal").textContent = Math.round(S.distance) + " cm";
    $("#sbZone").textContent = S.distance < 45 ? "intimate" : S.distance < 120 ? "personal" : S.distance < 360 ? "social" : "public";
    $("#sbZone").classList.toggle("bad", inside);
  }

  // ---- distance & proxemics -----------------------------------------
  function setDistance(v, user) {
    S.distance = clamp(Math.round(v), 30, 300);
    distInput.value = S.distance;
    if (stage) stage.setDistance(S.distance);
    renderRadar();
    if (!user) return;
    const c = COUNTRIES[S.code], thr = c.proxemics * 0.75;
    if (S.distance < thr) {
      // instant body reaction, then ask the AI for the words (throttled)
      const before = S.distance;
      if (stage && stage.anim.name !== "step_back_uncomfortable") {
        stage.play("step_back_uncomfortable"); stage.setEmotion("annoyed");
        const moved = stage.stepBack(c.proxemics - before + 10);
        S.retreated = true;
        S.distance = clamp(S.distance + moved, 30, 300); distInput.value = S.distance; stage.setDistance(S.distance); renderRadar();
      }
      if (!S.busy && Date.now() - S.lastClose > 2500 && S.history.length) {
        S.lastClose = Date.now();
        send({ action: "step_too_close", distance: before });
      }
    } else if (stage && stage.anim.name === "step_back_uncomfortable" && S.distance >= c.proxemics && !S.busy) {
      stage.play("idle_breathing"); stage.setEmotion("neutral");
    }
  }
  distInput.addEventListener("input", () => setDistance(+distInput.value, true));
  $("#sbBack").addEventListener("click", () => setDistance(S.distance + 15, true));
  $("#sbCloser").addEventListener("click", () => setDistance(S.distance - 15, true));
  document.addEventListener("keydown", (e) => {
    if ($("#sandboxMode").hidden || e.target.closest("input, textarea, select") || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === "w") setDistance(S.distance - 10, true);
    if (k === "s") setDistance(S.distance + 10, true);
  });

  // ---- voice: speech synthesis with the nation's accent + lip-sync ---
  let voices = [];
  const loadVoices = () => { voices = "speechSynthesis" in window ? speechSynthesis.getVoices() : []; };
  loadVoices();
  if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", loadVoices);
  function pickVoice(lang) {
    const norm = (l) => String(l).replace("_", "-").toLowerCase();
    return voices.find((v) => norm(v.lang) === norm(lang)) || voices.find((v) => norm(v.lang).startsWith(norm(lang).split("-")[0])) || null;
  }
  function fakeTalk(text) {
    if (!stage) return;
    stage.setSpeaking(true);
    clearTimeout(S.speakTimer);
    S.speakTimer = setTimeout(() => stage.setSpeaking(false), clamp(text.length * 55, 800, 9000));
  }
  function stopSpeech() {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    clearTimeout(S.speakTimer);
    if (stage) stage.setSpeaking(false);
  }
  function speak(text, voice) {
    const said = text.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();   // stage directions are acted, not spoken
    if (!said) return;
    const mode = $("#sbVoice").value;
    if (mode === "off" || !("speechSynthesis" in window)) { fakeTalk(said); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(said);
    const lang = mode === "local" ? voice.lang : "en-US";
    u.lang = lang;
    const v = pickVoice(lang); if (v) u.voice = v;
    const p = S.persona || {};
    u.rate = voice.rate || 1;
    u.volume = clamp((voice.volume || 0.7) + 0.25, 0.4, 1);
    u.pitch = (p.gender === "f" ? 1.15 : 0.85) - (p.age === "elder" ? 0.1 : 0);
    let started = false;
    u.onstart = () => { started = true; if (stage) stage.setSpeaking(true); };
    u.onboundary = () => { if (stage) stage.pulseMouth(); };
    u.onend = u.onerror = () => { clearTimeout(S.speakTimer); if (stage) stage.setSpeaking(false); };
    speechSynthesis.speak(u);
    setTimeout(() => { if (!started) fakeTalk(said); }, 800);   // no voices installed → still animate the mouth
  }
  $("#sbVoice").addEventListener("change", () => { if ($("#sbVoice").value === "off") stopSpeech(); });

  // ---- microphone: speech recognition → user message ----------------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#sbMic");
  if (!SR) { mic.disabled = true; mic.title = "Speech recognition is not supported in this browser"; }
  else {
    let rec = null;
    mic.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = "en-US"; rec.interimResults = true; rec.maxAlternatives = 1;
      mic.classList.add("live");
      rec.onresult = (ev) => {
        const r = ev.results[ev.results.length - 1];
        $("#sbInput").value = r[0].transcript;
        if (r.isFinal) { const text = r[0].transcript.trim(); $("#sbInput").value = ""; if (text) send({ message: text }); }
      };
      rec.onerror = (ev) => { if (ev.error === "not-allowed") toast("Microphone access was denied."); };
      rec.onend = () => { rec = null; mic.classList.remove("live"); };
      rec.start();
    });
  }

  // ---- the conversation loop ----------------------------------------
  function personaFor() {
    const sit = SIT[S.situation];
    const p = (matrix.personas[S.code] || {})[sit.kind] || { name: "Local", gender: "m", age: "adult" };
    return Object.assign({}, p, { kind: sit.kind, role: sit.role, flag: COUNTRIES[S.code].flag });
  }
  function poster(c) {
    const g = GREETINGS.find((x) => x.code === c.lang);
    return { flag: c.flag, word: g ? g.word : "Welcome", roman: g ? g.roman : "", title: c.name };
  }

  function start() {
    S.run++;
    stopSpeech();
    markSelection();
    const c = COUNTRIES[S.code], sit = SIT[S.situation];
    S.trust = 50; S.turn = 0; S.history = []; S.retreated = false; setBusy(false);
    S.persona = personaFor();
    $("#sbFlag").textContent = c.flag;
    $("#sbName").textContent = S.persona.name;
    $("#sbRole").textContent = `${sit.role} · ${c.name}`;
    $("#sbSitTitle").textContent = `${sit.icon} ${sit.title}`;
    $("#sbSitBrief").textContent = S.situation === "custom_sandbox" && S.custom ? `“${S.custom}” — ${sit.brief}` : sit.brief;
    $("#sbHints").innerHTML = "";
    chat.innerHTML = ""; subtitle("");
    setTrust(50, "neutral");
    renderProfile();
    if (stage) {
      stage.setScene({ code: S.code, persona: S.persona, situation: S.situation, comfortCm: c.proxemics, poster: poster(c) });
      stage.gestureAmp = c.dims.express / 100; stage.gestureFreq = 0.6 + c.dims.express / 100 * 1.8;
      stage.yaw = 0;
    }
    setDistance(clamp(Math.round(c.proxemics * 1.25 / 5) * 5, 70, 300), false);
    try { history.replaceState(null, "", `?country=${S.code}&situation=${S.situation}`); } catch (e) { /* file:// or sandboxed */ }
    if (S.situation === "custom_sandbox" && !S.custom) {
      add("sys", "✨ Describe your own situation above (one line) and press <b>Play it</b>.");
      $("#sbCustom").focus();
      return;
    }
    add("sys", `🎬 ${esc(sit.title)} · ${c.flag} ${esc(c.name)} — ${esc(S.persona.name)}, ${esc(sit.role.toLowerCase())}`);
    send({ opening: true });
  }

  async function send({ message = "", action = "none", opening = false, distance = null } = {}) {
    if (S.busy && !opening) { toast("Wait for the character to answer…"); return; }
    if (S.situation === "custom_sandbox" && !S.custom) { toast("Describe your custom situation first"); return; }
    const run = S.run;
    setBusy(true);
    const did = action !== "none" ? ACTION_TEXT[action] : "";
    if (!opening) add("me", [message ? esc(message) : "", did ? `<i class="sb-act">${esc(did)}</i>` : ""].filter(Boolean).join(" "));
    const typing = add("npc typing", "…");
    const body = {
      country: S.code, situation: S.situation, custom_context: S.situation === "custom_sandbox" ? S.custom : null,
      user_message: message, user_action: action, distance_cm: Math.round(clamp(distance != null ? distance : S.distance, 20, 400)),
      trust: Math.round(S.trust), turn: opening ? 0 : S.turn + 1, history: S.history.slice(-10)
    };
    let r;
    try { r = await api("/roleplay/interact", body); }
    catch (e) {
      if (run !== S.run) return;
      typing.remove(); add("sys", "⚠️ " + esc(e.message)); setBusy(false); S.retreated = false;
      return;
    }
    if (run !== S.run) return;   // nation / situation switched meanwhile
    typing.remove();
    if (!opening) {
      S.turn++;
      S.history.push({ role: "user", text: [message, did ? `(${did})` : ""].filter(Boolean).join(" ").slice(0, 500) });
    }
    S.history.push({ role: "npc", text: r.npc_reply.slice(0, 500) });
    S.history = S.history.slice(-12);
    react(r, opening);
    setBusy(false);
  }

  function react(r, opening) {
    setTrust(r.trust_score, r.mood);
    add("npc", `<b>${esc(r.npc.name)}:</b> ${esc(r.npc_reply)}`);
    if (opening) {
      $("#sbHints").innerHTML = (r.hints || []).map((h) => `<li>${esc(h)}</li>`).join("");
    } else {
      const d = r.delta;
      const sig = (r.signals || []).map((s) => `<span class="ftag ${s.effect >= 0 ? "soft" : ""}">${s.effect >= 0 ? "+" : ""}${s.effect} ${esc(s.label)}</span>`).join("");
      add("fb " + (d >= 0 ? "plus" : "minus"), `<b style="color:${d >= 0 ? "var(--good)" : "var(--bad)"}">${d >= 0 ? "+" : ""}${d}%</b>${esc(r.feedback)}<div class="sb-signals">${sig}</div>`);
    }
    if (stage) {
      stage.gestureAmp = r.body.gesture_amp; stage.gestureFreq = r.body.gesture_freq;
      stage.setEmotion(r.emotion); stage.setGaze(r.gaze);
      if (r.animation === "step_back_uncomfortable" && !S.retreated) {
        const moved = stage.stepBack(r.body.step_back_cm || 25);
        setDistance(S.distance + moved, false);
      }
      S.retreated = false;
      stage.play(r.animation, r.body);
    }
    subtitle(r.npc_reply);
    speak(r.npc_reply, r.voice);
    const src = r.source === "live" ? `⚡ live AI · ${esc(r.provider)} ${esc(r.model)}` : "🧠 offline culture engine";
    $("#sbSource").innerHTML = src;
    if (S.trust < 35 && !opening) add("sys", "💔 Trust is critically low — the character is withdrawing. Try an apology or a culturally fitting gesture.");
  }

  $("#sbSay").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#sbInput").value.trim();
    if (!text) return;
    $("#sbInput").value = "";
    send({ message: text });
  });
  $("#sbGestures").addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    send({ action: b.dataset.action, message: $("#sbInput").value.trim() });
    $("#sbInput").value = "";
  });
  $('.sb-distance [data-action="step_optimal"]').addEventListener("click", () => {
    setDistance(COUNTRIES[S.code].proxemics, false);
    if (stage) stage.resetPosition();
    send({ action: "step_optimal" });
  });
  $("#sbRestart").addEventListener("click", start);
  $("#sbFinish").addEventListener("click", async () => {
    if (!S.turn) { toast("Talk to the character first"); return; }
    const t = Math.round(S.trust), key = `${S.code}:${S.situation}`;
    const sandbox = Object.assign({}, progress.sandbox || {});
    sandbox[key] = Math.max(sandbox[key] || 0, t);
    saveProgress({ sandbox });
    api("/roleplay/sandbox/result", { country: S.code, situation: S.situation, trust: t, turns: S.turn }).catch(() => {});
    const r = t >= 80 ? ["🤝", "Trusted friend"] : t >= 60 ? ["🙂", "Good relationship"] : t >= 40 ? ["😐", "Neutral acquaintance"] : ["💔", "Trust broken"];
    add("sys", `<div class="rp-end"><div class="big">${r[0]}</div><h3>${r[1]} · ${t}% trust</h3><p class="muted">${S.turn} turns with ${esc(S.persona.name)} (${COUNTRIES[S.code].flag}). Try the same situation with another nation to feel the cultural gap.</p></div>`);
  });

  start();
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
  const matchWrap = document.getElementById("match") || pool.closest(".section") || document.body;
  matchWrap.addEventListener("click", (e) => {
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
    const certUrl = r.certificate && r.certificate.url ? r.certificate.url : null;
    box.innerHTML = `${progressBar()}
      <div class="badge">
        <div class="badge-medal"><span>${esc(badge.icon)}</span></div>
        <div class="muted">You scored</div>
        <div class="score-big">${r.score} / ${r.total}</div>
        <h3 class="grad" style="font-size:1.6rem">${esc(badge.title)}</h3>
        <p class="muted">${esc(badge.text)}</p>
        ${certUrl ? `<div style="margin:16px 0"><a href="${certUrl}" target="_blank" class="btn primary">🎓 View &amp; Print Your Certificate →</a></div>` : ""}
        <div class="explain-grid" style="text-align:left">${r.review.map((q) => `<div class="dec-block"><h4>${q.correct ? "✅" : "❌"} ${esc(q.flag)} ${esc(q.topic)}</h4><p>${esc(q.answer)}</p></div>`).join("")}</div>
        <div class="match-actions" style="justify-content:center"><button class="btn ghost" id="qRestart">Try again</button></div>
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
   Stats page
   --------------------------------------------------------------------- */
function initStats() {
  const statUsers = $("#statUsers"); if (!statUsers) return;
  api("/stats").then((s) => {
    if (!s) return;
    statUsers.textContent = s.total_users || "—";
    const attempts = $("#statAttempts"); if (attempts) attempts.textContent = s.total_attempts || "—";
    const avg = $("#statAvg"); if (avg) avg.textContent = s.avg_score ? Math.round(s.avg_score) + "%" : "—";
    const experts = $("#statExperts"); if (experts) experts.textContent = s.expert_count || "—";
    // Level bars
    const total = Math.max(1, (s.level_distribution?.expert || 0) + (s.level_distribution?.learner || 0) + (s.level_distribution?.beginner || 0));
    const pcts = {
      expert: ((s.level_distribution?.expert || 0) / total * 100).toFixed(0),
      learner: ((s.level_distribution?.learner || 0) / total * 100).toFixed(0),
      beginner: ((s.level_distribution?.beginner || 0) / total * 100).toFixed(0)
    };
    for (const level of ["expert", "learner", "beginner"]) {
      const bar = $(`#bar${level.charAt(0).toUpperCase() + level.slice(1)}`);
      const pct = $(`#pct${level.charAt(0).toUpperCase() + level.slice(1)}`);
      if (bar) bar.style.width = pcts[level] + "%";
      if (pct) pct.textContent = pcts[level] + "%";
    }
    // Hardest questions
    const box = $("#hardestQuestions");
    if (box && s.hardest_questions) {
      box.innerHTML = s.hardest_questions.map((q) =>
        `<div class="hardest-item"><span class="q-text">${esc(q.topic || q.text || "Question")}</span><span class="miss-rate">${q.miss_rate || q.error_rate || 0}% errors</span></div>`
      ).join("");
    }
    // Activity chart
    const actCanvas = $("#activityChart");
    if (actCanvas && s.activity_timeline && typeof Chart !== "undefined") {
      new Chart(actCanvas, {
        type: "line",
        data: {
          labels: s.activity_timeline.map((d) => d.date || d.day),
          datasets: [{
            label: "Attempts",
            data: s.activity_timeline.map((d) => d.count),
            borderColor: css("--accent"),
            backgroundColor: "rgba(139,108,255,0.1)",
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: css("--border") }, ticks: { color: css("--muted") } },
            y: { beginAtZero: true, grid: { color: css("--border") }, ticks: { color: css("--muted") } }
          }
        }
      });
    }
  }).catch(() => {});
}

/* ---------------------------------------------------------------------
   Proxemics bar chart (per-country comfort distance)
   --------------------------------------------------------------------- */
function initProxBars() {
  const box = $("#proxBars"); if (!box) return;
  const distances = CODES.map((c) => ({
    name: COUNTRIES[c].name,
    flag: COUNTRIES[c].flag,
    dist: COUNTRIES[c].proxemics || 80
  })).sort((a, b) => a.dist - b.dist);
  const maxDist = Math.max(...distances.map((d) => d.dist), 120);
  box.innerHTML = distances.map((d) =>
    `<div class="bar-row"><span>${d.flag} ${esc(d.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(d.dist / maxDist * 100)}%">${d.dist}</div></div><span class="muted">${d.dist}cm</span></div>`
  ).join("");
}

/* ---------------------------------------------------------------------
   3D particle background (Three.js) — floating particles on home page
   --------------------------------------------------------------------- */
function init3DBackground() {
  const container = $("#three-bg"); if (!container || typeof THREE === "undefined") return;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 1, 1000);
  camera.position.z = 300;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const COUNT = 200;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const palette = [
    new THREE.Color(css("--accent") || "#8b6cff"),
    new THREE.Color(css("--accent-2") || "#22d3ee"),
    new THREE.Color(css("--accent-3") || "#f472b6")
  ];
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 800;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 800;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 500;
    const c = palette[i % 3];
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 3, vertexColors: true, transparent: true, opacity: 0.5, sizeAttenuation: true });
  const points = new THREE.Points(geom, mat);
  scene.add(points);

  // Connecting lines between nearby particles
  const lineMat = new THREE.LineBasicMaterial({ color: css("--accent") || "#8b6cff", transparent: true, opacity: 0.06 });
  const lineGeom = new THREE.BufferGeometry();
  const linePositions = [];
  for (let i = 0; i < COUNT; i++) {
    for (let j = i + 1; j < COUNT; j++) {
      const dx = positions[i*3] - positions[j*3], dy = positions[i*3+1] - positions[j*3+1], dz = positions[i*3+2] - positions[j*3+2];
      if (dx*dx + dy*dy + dz*dz < 12000) {
        linePositions.push(positions[i*3], positions[i*3+1], positions[i*3+2], positions[j*3], positions[j*3+1], positions[j*3+2]);
      }
    }
  }
  lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  scene.add(new THREE.LineSegments(lineGeom, lineMat));

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);
  function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
  window.addEventListener("resize", resize);

  function animate() {
    requestAnimationFrame(animate);
    if (!visible) return;
    points.rotation.x += 0.0003;
    points.rotation.y += 0.0005;
    renderer.render(scene, camera);
  }
  animate();
}

/* ---------------------------------------------------------------------
   Learning Accounts & Auth
   --------------------------------------------------------------------- */
function initAuth() {
  const tabLogin = $("#tabLoginBtn"), tabReg = $("#tabRegisterBtn");
  const formLogin = $("#loginForm"), formReg = $("#registerForm");
  const loginMsg = $("#loginMsg"), regMsg = $("#regMsg");
  const logoutBtn = $("#profileLogoutBtn");

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api("/auth/logout");
      window.location.reload();
    });
  }

  if (tabLogin && tabReg) {
    tabLogin.addEventListener("click", () => {
      tabLogin.classList.add("active"); tabReg.classList.remove("active");
      formLogin.hidden = false; formReg.hidden = true;
    });
    tabReg.addEventListener("click", () => {
      tabReg.classList.add("active"); tabLogin.classList.remove("active");
      formReg.hidden = false; formLogin.hidden = true;
    });
  }

  if (formLogin) {
    formLogin.addEventListener("submit", async (e) => {
      e.preventDefault();
      loginMsg.className = "auth-msg"; loginMsg.textContent = "Signing in…";
      try {
        await api("/auth/login", {
          username: $("#loginUsername").value.trim(),
          password: $("#loginPassword").value
        });
        loginMsg.className = "auth-msg ok"; loginMsg.textContent = "Success! Redirecting to your learning tracks…";
        setTimeout(() => { window.location.href = "/learn"; }, 600);
      } catch (err) {
        loginMsg.className = "auth-msg error"; loginMsg.textContent = err.message;
      }
    });
  }

  if (formReg) {
    formReg.addEventListener("submit", async (e) => {
      e.preventDefault();
      regMsg.className = "auth-msg"; regMsg.textContent = "Creating account…";
      try {
        await api("/auth/register", {
          username: $("#regUsername").value.trim(),
          full_name: $("#regFullName").value.trim(),
          target_country: $("#regCountry").value,
          password: $("#regPassword").value
        });
        regMsg.className = "auth-msg ok"; regMsg.textContent = "Account created! Loading your tracks…";
        setTimeout(() => { window.location.href = "/learn"; }, 600);
      } catch (err) {
        regMsg.className = "auth-msg error"; regMsg.textContent = err.message;
      }
    });
  }
}

/* ---------------------------------------------------------------------
   Systematic Country Learning Tracks
   --------------------------------------------------------------------- */
function initTracks() {
  const roadmapEl = $("#roadmapList"); if (!roadmapEl) return;
  const sel = $("#trackCountrySelect");
  const tracksGrid = $("#allTracksGrid");
  let activeCode = new URLSearchParams(window.location.search).get("country") || "DE";

  async function loadTrack(code) {
    activeCode = code;
    try {
      const data = await api(`/tracks/${code}`);
      renderTrackHero(data);
      renderRoadmap(data);
    } catch (err) {
      roadmapEl.innerHTML = `<div class="empty">⚠️ ${esc(err.message)}</div>`;
    }
  }

  function renderTrackHero(data) {
    const c = data.country, p = data.progress;
    $("#curFlag").textContent = c.flag;
    $("#curContext").textContent = `${c.context} · ${c.name}`;
    $("#curTitle").textContent = `Kazakhstan ➔ ${c.name} Adaptation Track`;
    $("#progressSummary").textContent = `${p.completedCount} of ${p.totalSteps} lessons completed`;
    $("#progressPct").textContent = `${p.percent}%`;
    $("#progressBar").style.width = `${p.percent}%`;
    if (sel) sel.value = c.code;
  }

  function renderRoadmap(data) {
    const steps = data.curriculum, c = data.country, p = data.progress;
    roadmapEl.innerHTML = steps.map((s) => {
      const badgeText = s.isCompleted ? "✅ Completed" : s.isCurrent ? "⏳ In Progress" : "🔒 Locked";
      const badgeClass = s.isCompleted ? "status-completed" : s.isCurrent ? "status-current" : "status-locked";

      return `
        <div class="roadmap-card ${s.isCompleted ? 'completed' : ''} ${s.isUnlocked ? 'unlocked' : 'locked'}">
          <div class="roadmap-top">
            <div class="roadmap-title-row">
              <span class="roadmap-step-num">${s.isCompleted ? '✓' : s.number}</span>
              <div>
                <h4>${s.icon} ${esc(s.title)}</h4>
                <span class="muted" style="font-size:.8rem">Stage ${s.number} of 5</span>
              </div>
            </div>
            <span class="roadmap-status-badge ${badgeClass}">${badgeText}</span>
          </div>

          <p class="roadmap-desc">${esc(s.objective)}</p>
          <div class="roadmap-theory"><b>Theoretical Foundation:</b> ${esc(s.theory)}</div>

          <ul class="roadmap-tasks">
            ${s.tasks.map((t) => `<li>${esc(t)}</li>`).join("")}
          </ul>

          <div class="roadmap-actions">
            ${s.isUnlocked ? `
              <button class="btn primary small btn-step-action" data-step="${s.id}">
                ${s.isCompleted ? 'Review Lesson ↺' : 'Complete Stage ✦'}
              </button>
            ` : `<button class="btn ghost small" disabled>Complete Stage ${s.number - 1} First 🔒</button>`}
            ${s.id === 'exam' && p.certificateToken ? `
              <a href="/certificate/${p.certificateToken}" target="_blank" class="btn ghost small">🎓 View Certificate</a>
            ` : ''}
          </div>
        </div>
      `;
    }).join("");

    $$(".btn-step-action", roadmapEl).forEach((b) => {
      b.addEventListener("click", async () => {
        const stepId = b.dataset.step;
        b.disabled = true; b.textContent = "Recording progress…";
        try {
          const res = await api(`/tracks/${activeCode}/step/${stepId}/complete`, { step_id: stepId, score: 95 });
          toast(`Stage completed! ${res.cqLevel ? `CQ Level: ${res.cqLevel}` : ''}`);
          confetti();
          loadTrack(activeCode);
          loadAllTracks();
        } catch (e) {
          toast(e.message);
          b.disabled = false;
          b.textContent = "Complete Stage ✦";
        }
      });
    });
  }

  async function loadAllTracks() {
    try {
      const all = await api("/tracks");
      if (sel) {
        sel.innerHTML = all.map((t) => `<option value="${t.code}" ${t.code === activeCode ? 'selected' : ''}>${t.flag} ${esc(t.name)} (${t.percent}%)</option>`).join("");
      }
      if (tracksGrid) {
        tracksGrid.innerHTML = all.map((t) => `
          <div class="card track-card ${t.code === activeCode ? 'active-track' : ''}" data-code="${t.code}">
            <div class="track-card-top">
              <span class="track-card-flag">${t.flag}</span>
              <div>
                <h4>${esc(t.name)}</h4>
                <p>${esc(t.context)}</p>
              </div>
            </div>
            <div class="track-card-progress">
              <span>${t.completedCount}/${t.totalSteps} lessons</span>
              <b>${t.percent}%</b>
            </div>
            <div class="track-progress-track" style="margin-top:6px;height:6px">
              <div class="track-progress-bar" style="width:${t.percent}%"></div>
            </div>
          </div>
        `).join("");

        $$(".track-card", tracksGrid).forEach((card) => {
          card.addEventListener("click", () => {
            loadTrack(card.dataset.code);
            const target = $("#trackHero");
            if (target) window.scrollTo({ top: target.offsetTop - 80, behavior: "smooth" });
          });
        });
      }
    } catch (e) {}
  }

  if (sel) {
    sel.addEventListener("change", () => loadTrack(sel.value));
  }

  loadTrack(activeCode);
  loadAllTracks();
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
    const loader = $("#loader");
    if (loader) loader.innerHTML = `⚠️ Could not reach the server: ${esc(e.message)}`;
    return;
  }
  COUNTRIES = data.countries;
  CODES = Object.keys(COUNTRIES);
  DIMENSIONS = data.dimensions;
  GREETINGS = data.greetings;
  MOODS = data.moods;
  ROLEPLAYS = scenarios;
  CODES.forEach((c) => { ISO_TO_CODE[COUNTRIES[c].iso] = c; });

  // Home page stat counters (only exist on home page)
  const cntCountries = $('[data-count="countries"]');
  if (cntCountries) {
    const unis = CODES.reduce((n, c) => n + (COUNTRIES[c].alumni ? COUNTRIES[c].alumni.universities.length : 0), 0);
    const s = data.stats;
    countUp(cntCountries, CODES.length);
    const cntUni = $('[data-count="universities"]'); if (cntUni) countUp(cntUni, unis);
    const cntAtt = $('[data-count="attempts"]'); if (cntAtt) countUp(cntAtt, s.quiz.count + s.match.count + s.roleplay.count);
  }
  // References footer (if on page)
  const refsEl = $("#refs");
  if (refsEl && data.references) refsEl.innerHTML = data.references.map((r) => `<li>${esc(r)}</li>`).join("");

  // Conditionally init each module (guard on DOM presence)
  if ($("#globe")) initGlobe();
  if ($("#worldMap")) initAtlas();
  if ($("#marquee1")) initGreetings();
  if ($("#radarChart")) radar = initRadar();
  if ($("#decInput")) initDecoder(data.presets, data.ai);
  if ($("#proxSvg")) { initProxemics(initVoice()); initProxBars(); }
  if ($("#rpChat")) initRoleplay();
  if ($("#sbCanvas")) initSandbox();
  if ($("#matchPool")) initMatch();
  if ($("#quizCard")) initQuiz();
  if ($("#passportBars")) renderPassport();
  if ($("#statUsers")) initStats();
  if ($("#three-bg")) init3DBackground();
  if ($("#loginForm") || $("#profileLogoutBtn")) initAuth();
  if ($("#roadmapList")) initTracks();

  const navLogout = $("#navLogout");
  if (navLogout) navLogout.addEventListener("click", () => api("/auth/logout").then(() => window.location.reload()));


  // Story form (atlas page)
  const storyForm = $("#storyForm");
  if (storyForm) {
    const sel = $("#storyCountry");
    if (sel) countryOptions(sel, "IT");
    storyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = {
        country: ($("#storyCountry") || {}).value || "KZ",
        quote: ($("#storyText") || {}).value || "",
        university: ($("#storyUni") || {}).value || "",
        student_name: ($("#storyName") || {}).value || ""
      };
      if (!body.quote.trim()) { toast("Please write your story first"); return; }
      try { await api("/alumni/add", body); toast("Thank you! Your story has been submitted for moderation."); storyForm.reset(); }
      catch (err) { toast(err.message); }
    });
  }

  const loader = $("#loader");
  if (loader) loader.remove();
}

boot();
})();

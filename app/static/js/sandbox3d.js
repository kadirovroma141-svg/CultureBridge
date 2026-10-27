/* =====================================================================
   CultureBridge AI — 3D Cultural Sandbox engine (Three.js r149, no build step)
   Procedural humanoid with a joint hierarchy, facial expressions, gaze,
   lip-sync and 9 AI-selected animations, national rooms & props, Hall's
   proxemic rings on the floor. Exposes window.CBSandbox3D = { Stage, LOOKS }.
   The UI / API side lives in app.js (initSandbox).
   ===================================================================== */
(() => {
"use strict";
if (typeof THREE === "undefined") return;

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------------------------------------------------------------------
   National looks: clothing palette, skin/hair, room colours, decor theme
   --------------------------------------------------------------------- */
const LOOKS = {
  KZ: { skin: "#d9a77c", hair: "#1b1410", top: "#1f5fae", bottom: "#2b2f3a", accent: "#f2c230", wall: "#eadfca", floor: "#7a4a2e", rug: ["#9b1c1c", "#f2c230"], scarf: "#f4f1ea", low: false },
  IT: { skin: "#e8b994", hair: "#3b2416", top: "#2e7d4f", bottom: "#3a3a46", accent: "#c8102e", wall: "#ecd3b4", floor: "#b5683a", cloth: ["#c8102e", "#ffffff"], low: false },
  HU: { skin: "#efc6a4", hair: "#6b4226", top: "#4a7352", bottom: "#33343d", accent: "#cd2a3e", wall: "#efe6d8", floor: "#9c6b43", cloth: ["#ffffff", "#f1e8da"], low: false },
  CA: { skin: "#f1c8a8", hair: "#8a5a2b", top: "#b3202a", bottom: "#2f3e55", accent: "#ffffff", wall: "#dde5e8", floor: "#a77b52", plaid: true, low: false },
  US: { skin: "#d7a07a", hair: "#c69a52", top: "#3c3b6e", bottom: "#3b4a63", accent: "#b22234", wall: "#e3e7ee", floor: "#8e6e53", low: false },
  CN: { skin: "#eec8a0", hair: "#111111", top: "#a3141c", bottom: "#24252c", accent: "#f6c744", wall: "#f3e7d6", floor: "#6b3a2a", low: false },
  JP: { skin: "#f0cfae", hair: "#151515", top: "#2b3a55", bottom: "#23252b", accent: "#ffffff", wall: "#f3ecdc", floor: "#c9b27c", shoji: true, low: true },
  KR: { skin: "#f0cfae", hair: "#1a1a1a", top: "#eef0f3", bottom: "#1f3b70", accent: "#c60c30", wall: "#f2ece0", floor: "#b08d5c", low: true },
  GB: { skin: "#f3cfb3", hair: "#9a5530", top: "#55623f", bottom: "#2f2f37", accent: "#012169", wall: "#d8cfbf", floor: "#5b3a29", low: false },
  DE: { skin: "#f1c7a5", hair: "#c9a46a", top: "#3a3f47", bottom: "#2a2d33", accent: "#dd0000", wall: "#e6e6e2", floor: "#8f8f88", low: false },
  TR: { skin: "#dcab83", hair: "#2a1a12", top: "#8a1c2b", bottom: "#2d2b33", accent: "#e30a17", wall: "#efe1cf", floor: "#8b4b2e", rug: ["#8a1c2b", "#1d4e89"], scarf: "#2c5f8a", low: false },
};
const DEFAULT_LOOK = LOOKS.US;

/* ---------------------------------------------------------------------
   Small helpers
   --------------------------------------------------------------------- */
const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.75, metalness: 0 }, o || {}));
function mesh(geo, m, x, y, z, parent) {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x || 0, y || 0, z || 0);
  me.castShadow = true; me.receiveShadow = true;
  if (parent) parent.add(me);
  return me;
}
function G(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x || 0, y || 0, z || 0);
  if (parent) parent.add(g);
  return g;
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}
const checker = (a, b, n) => canvasTex(128, 128, (g, w) => {
  const s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * s, j * s, s, s); }
});
const ornament = (a, b) => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  g.strokeStyle = b; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
  g.lineWidth = 6;
  for (let i = 0; i < 4; i++) {          // ram's-horn style motif (qoshqar müiz)
    g.save(); g.translate(w / 2, h / 2); g.rotate(i * PI / 2);
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(30, -10, 60, -60, 30, -80); g.bezierCurveTo(10, -90, 0, -70, 14, -60); g.stroke();
    g.restore();
  }
  g.fillStyle = b; g.beginPath(); g.arc(w / 2, h / 2, 14, 0, PI * 2); g.fill();
});

/* ---------------------------------------------------------------------
   Procedural humanoid
   --------------------------------------------------------------------- */
function badgeTexture(flag, name, role) {
  return canvasTex(512, 220, (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#7c3aed"; g.fillRect(0, 0, w, 34);
    g.fillStyle = "#fff"; g.font = "bold 22px Inter, sans-serif"; g.fillText("CULTUREBRIDGE · LOCAL", 16, 24);
    g.font = '86px "Twemoji Country Flags", "Segoe UI Emoji", sans-serif'; g.fillText(flag, 14, 150);
    g.fillStyle = "#0f172a"; g.font = "bold 40px Inter, sans-serif";
    g.fillText(name.length > 18 ? name.slice(0, 17) + "…" : name, 130, 110);
    g.fillStyle = "#475569"; g.font = "26px Inter, sans-serif";
    g.fillText(role.length > 28 ? role.slice(0, 27) + "…" : role, 130, 160);
  });
}

function buildHuman(look, persona, code) {
  const f = persona.gender === "f", elder = persona.age === "elder", young = persona.age === "young";
  const formal = persona.kind === "formal";
  const skinM = mat(look.skin, { roughness: 0.55 }), topM = mat(look.top), botM = mat(look.bottom);
  const hairM = mat(elder ? "#cfcac3" : look.hair, { roughness: 0.9 }), shoeM = mat("#1d1d22");
  const accM = mat(look.accent === "#ffffff" ? "#8b1e2d" : look.accent);   // a white accent would vanish on a shirt
  const darkM = mat("#1a1010", { roughness: 0.4 }), whiteM = mat("#fbfbfb", { roughness: 0.3 });
  const lipM = mat(f ? "#b24a52" : "#9a5a4e");
  const J = { eyes: [], brows: [] };
  const root = G(); J.root = root;
  const hips = G(root, 0, 0.92, 0); J.hips = hips;

  [1, -1].forEach((s) => {
    const hip = G(hips, 0.092 * s, 0, 0);
    mesh(new THREE.CapsuleGeometry(0.068, 0.36, 4, 10), botM, 0, -0.22, 0, hip);
    const knee = G(hip, 0, -0.44, 0);
    mesh(new THREE.CapsuleGeometry(0.056, 0.33, 4, 10), botM, 0, -0.2, 0, knee);
    mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoeM, 0, -0.445, 0.05, knee);
    J[s > 0 ? "lHip" : "rHip"] = hip; J[s > 0 ? "lKnee" : "rKnee"] = knee;
  });
  if (f && (elder || persona.kind === "host")) {         // long skirt / dress
    mesh(new THREE.CylinderGeometry(0.17, 0.27, 0.66, 20, 1, true), botM, 0, -0.3, 0, hips).material.side = THREE.DoubleSide;
  }

  const spine = G(hips, 0, 0.02, 0); J.spine = spine;
  mesh(new THREE.CylinderGeometry(0.15, 0.145, 0.16, 16), botM, 0, 0.04, 0, spine).scale.z = 0.72;
  const chest = G(spine, 0, 0.12, 0); J.chest = chest;
  const torso = mesh(new THREE.CapsuleGeometry(f ? 0.148 : 0.162, 0.26, 6, 18), topM, 0, 0.19, 0, chest);
  torso.scale.z = 0.68;
  if (formal && !f) {                                    // tie
    mesh(new THREE.BoxGeometry(0.035, 0.22, 0.01), accM, 0, 0.28, 0.112, chest).rotation.x = -0.12;
    mesh(new THREE.BoxGeometry(0.1, 0.04, 0.02), whiteM, 0, 0.42, 0.08, chest);
  } else if (formal) {                                   // scarf
    mesh(new THREE.TorusGeometry(0.085, 0.022, 8, 20), accM, 0, 0.45, 0.02, chest).rotation.x = PI / 2.3;
  } else if (look.plaid) {
    torso.material = new THREE.MeshStandardMaterial({ map: checker("#b3202a", "#3a1a1a", 8), roughness: 0.85 });
  } else {                                               // national-colour stripe
    mesh(new THREE.BoxGeometry(0.3, 0.035, 0.01), accM, 0, 0.3, 0.107, chest);
  }
  const sw = f ? 0.19 : 0.212;

  // name badge (flag · name · role)
  const badge = mesh(new THREE.PlaneGeometry(0.13, 0.056), new THREE.MeshBasicMaterial({ map: badgeTexture(persona.flag || "", persona.name, persona.role) }), 0.075, 0.33, 0.112, chest);
  badge.castShadow = false;
  J.badge = badge;

  // arms
  [1, -1].forEach((s) => {
    const sh = G(chest, sw * s, 0.42, 0);
    mesh(new THREE.SphereGeometry(0.056, 14, 10), topM, 0, -0.01, 0, sh);
    mesh(new THREE.CapsuleGeometry(0.044, 0.21, 4, 10), topM, 0, -0.15, 0, sh);
    const el = G(sh, 0, -0.29, 0);
    mesh(new THREE.CapsuleGeometry(0.039, 0.18, 4, 10), formal ? topM : skinM, 0, -0.12, 0, el);
    const hand = G(el, 0, -0.26, 0);
    mesh(new THREE.SphereGeometry(0.046, 12, 10), skinM, 0, -0.025, 0, hand).scale.set(0.8, 1.2, 0.55);
    mesh(new THREE.CapsuleGeometry(0.013, 0.03, 3, 6), skinM, -0.03 * s, -0.01, 0.02, hand).rotation.z = 0.6 * s;
    J[s > 0 ? "lSh" : "rSh"] = sh; J[s > 0 ? "lEl" : "rEl"] = el; J[s > 0 ? "lHand" : "rHand"] = hand;
  });

  // neck + head
  mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 12), skinM, 0, 0.5, 0, chest);
  const head = G(chest, 0, 0.54, 0); J.head = head;
  const face = G(head, 0, 0.095, 0);
  mesh(new THREE.SphereGeometry(0.115, 28, 22), skinM, 0, 0, 0, face).scale.set(0.9, 1.08, 0.98);
  mesh(new THREE.SphereGeometry(0.03, 10, 8), skinM, 0.104, -0.005, -0.005, face).scale.set(0.4, 0.75, 0.55);
  mesh(new THREE.SphereGeometry(0.03, 10, 8), skinM, -0.104, -0.005, -0.005, face).scale.set(0.4, 0.75, 0.55);
  const nose = mesh(new THREE.ConeGeometry(0.016, 0.042, 10), skinM, 0, -0.012, 0.112, face);
  nose.rotation.x = PI / 2;

  const irisM = mat(look.hair === "#151515" || look.hair === "#111111" || look.hair === "#1a1a1a" ? "#2b1a10" : "#3d5a74", { roughness: 0.3 });
  [1, -1].forEach((s) => {
    const eg = G(face, 0.041 * s, 0.018, 0.091);
    mesh(new THREE.SphereGeometry(0.024, 16, 12), whiteM, 0, 0, 0, eg).scale.z = 0.62;
    const pupil = G(eg, 0, 0, 0.013);
    mesh(new THREE.SphereGeometry(0.0135, 14, 10), irisM, 0, 0, 0, pupil).scale.z = 0.45;
    mesh(new THREE.SphereGeometry(0.007, 10, 8), darkM, 0, 0, 0.005, pupil);
    const brow = mesh(new THREE.BoxGeometry(0.048, 0.01, 0.012), mat(elder ? "#9d968e" : look.hair), 0.043 * s, 0.062, 0.1, face);
    J.eyes.push({ g: eg, pupil, s }); J.brows.push({ m: brow, s, y: 0.062 });
    const blush = mesh(new THREE.SphereGeometry(0.02, 10, 8), new THREE.MeshBasicMaterial({ color: "#ff6b81", transparent: true, opacity: 0, depthWrite: false }), 0.058 * s, -0.03, 0.086, face);
    blush.castShadow = false;
    (J.blush = J.blush || []).push(blush);
  });

  const mouth = G(face, 0, -0.055, 0.1);
  const smile = mesh(new THREE.TorusGeometry(0.025, 0.0045, 6, 22, PI), lipM, 0, 0, 0, mouth);
  smile.rotation.z = PI;
  const jaw = mesh(new THREE.SphereGeometry(0.02, 14, 10), darkM, 0, -0.004, -0.004, mouth);
  jaw.scale.set(1, 0.05, 0.4);
  J.smile = smile; J.jaw = jaw;

  if (formal && persona.age !== "young") {                // glasses
    const gm = mat("#2b2b2b", { metalness: 0.4, roughness: 0.4 });
    [1, -1].forEach((s) => mesh(new THREE.TorusGeometry(0.027, 0.003, 6, 20), gm, 0.042 * s, 0.018, 0.112, face));
    mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), gm, 0, 0.022, 0.114, face);
  }

  // hair / headscarf
  const scarfed = f && elder && look.scarf;
  if (scarfed) {
    const hood = mesh(new THREE.SphereGeometry(0.138, 26, 18, 0, PI * 2, 0, PI * 0.68), mat(look.scarf, { roughness: 0.95 }), 0, 0.012, -0.01, face);
    hood.rotation.x = -0.62; hood.scale.set(0.95, 1.1, 1);
    mesh(new THREE.CylinderGeometry(0.075, 0.15, 0.14, 20, 1, true), mat(look.scarf, { roughness: 0.95, side: THREE.DoubleSide }), 0, -0.13, -0.02, face);
  } else {
    const cap = mesh(new THREE.SphereGeometry(0.121, 26, 16, 0, PI * 2, 0, PI * 0.5), hairM, 0, 0.008, -0.012, face);
    cap.rotation.x = -0.62; cap.scale.set(0.94, 1.1, 1.02);
    mesh(new THREE.SphereGeometry(0.119, 22, 14, PI, PI, PI * 0.3, PI * 0.42), hairM, 0, 0.0, -0.02, face).scale.set(0.95, 1.08, 1);
    if (f && !elder) mesh(new THREE.BoxGeometry(0.21, young ? 0.3 : 0.22, 0.07), hairM, 0, -0.07, -0.075, face);
    if (f && elder) mesh(new THREE.SphereGeometry(0.05, 14, 10), hairM, 0, 0.07, -0.1, face);
  }

  // props held during animations
  const gift = G(chest, 0, 0.2, 0.36);
  mesh(new THREE.BoxGeometry(0.16, 0.1, 0.12), mat(look.accent === "#ffffff" ? "#c8102e" : look.accent), 0, 0, 0, gift);
  mesh(new THREE.BoxGeometry(0.165, 0.02, 0.125), mat("#f6d365"), 0, 0.03, 0, gift);
  gift.visible = false; J.gift = gift;
  const cup = G(J.rHand, 0, -0.075, 0.035);
  if (code === "TR") {
    mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.07, 12), mat("#c0392b", { transparent: true, opacity: 0.85 }), 0, 0, 0, cup);
  } else {
    mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.045, 14), mat(code === "KZ" ? "#f4f4f4" : "#e9e2d0"), 0, 0, 0, cup);
    mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 18), mat("#1f5fae"), 0, 0.018, 0, cup).rotation.x = PI / 2;
  }
  cup.visible = false; J.cup = cup;

  // aura ring on the floor (green on approval, red when offended)
  const aura = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 56), new THREE.MeshBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  aura.rotation.x = -PI / 2; aura.position.y = 0.012;
  root.add(aura); J.aura = aura;

  root.scale.setScalar(f ? 0.94 : 1);
  root.traverse((o) => { if (o.isMesh && o !== aura && o !== badge) o.castShadow = true; });
  return J;
}

/* ---------------------------------------------------------------------
   Room, national decor and situation props
   --------------------------------------------------------------------- */
function teapot(color, x, y, z, parent) {
  const g = G(parent, x, y, z), m = mat(color, { roughness: 0.35 });
  mesh(new THREE.SphereGeometry(0.075, 18, 14), m, 0, 0.06, 0, g).scale.y = 0.8;
  const sp = mesh(new THREE.CylinderGeometry(0.01, 0.018, 0.09, 8), m, 0.085, 0.08, 0, g); sp.rotation.z = -0.9;
  mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 14), m, -0.075, 0.07, 0, g);
  mesh(new THREE.SphereGeometry(0.02, 10, 8), m, 0, 0.125, 0, g);
  return g;
}
function cups(n, color, band, x, y, z, parent) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    const c = mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.045, 14), mat(color, { roughness: 0.3 }), x + Math.cos(a) * 0.16, y + 0.023, z + Math.sin(a) * 0.12, parent);
    if (band) mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 18), mat(band), 0, 0.016, 0, c).rotation.x = PI / 2;
  }
}
function plate(color, x, y, z, parent, r) { return mesh(new THREE.CylinderGeometry(r || 0.12, (r || 0.12) * 0.8, 0.02, 24), mat(color, { roughness: 0.3 }), x, y + 0.01, z, parent); }
function posterTexture(flag, word, roman, title) {
  return canvasTex(512, 640, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "#1e1b4b"); grd.addColorStop(1, "#0e7490");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.textAlign = "center"; g.fillStyle = "#fff";
    g.font = '170px "Twemoji Country Flags", "Segoe UI Emoji", sans-serif'; g.fillText(flag, w / 2, 230);
    g.font = "bold 64px Inter, sans-serif"; g.fillText(word, w / 2, 380, w - 40);
    g.font = "36px Inter, sans-serif"; g.fillStyle = "#c7d2fe"; g.fillText(roman, w / 2, 440, w - 40);
    g.font = "bold 30px Inter, sans-serif"; g.fillStyle = "#fde68a"; g.fillText(title, w / 2, 560, w - 40);
  });
}
function wallClock(parent, x, y, z) {
  const g = G(parent, x, y, z);
  const face = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 36), mat("#fafafa"), 0, 0, 0, g); face.rotation.x = PI / 2;
  mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 36), mat("#222"), 0, 0, 0.01, g);
  const hh = mesh(new THREE.BoxGeometry(0.02, 0.12, 0.01), mat("#111"), 0, 0, 0.03, g);   // 10:15 → "you are 15 min late"
  hh.geometry.translate(0, 0.06, 0); hh.rotation.z = -(10.25 / 12) * PI * 2;
  const mh = mesh(new THREE.BoxGeometry(0.012, 0.18, 0.01), mat("#c00"), 0, 0, 0.035, g);
  mh.geometry.translate(0, 0.09, 0); mh.rotation.z = -(15 / 60) * PI * 2;
  return g;
}
function silhouette(parent, x, z, color) {
  const g = G(parent, x, 0, z), m = mat(color, { roughness: 0.9 });
  mesh(new THREE.CapsuleGeometry(0.17, 0.75, 4, 12), m, 0, 0.75, 0, g).scale.z = 0.7;
  mesh(new THREE.SphereGeometry(0.11, 14, 12), m, 0, 1.46, 0, g);
  return g;
}

function buildRoom(look, code, situation, poster) {
  const room = new THREE.Group();
  const street = situation === "public_etiquette";
  const floorMat = street ? mat("#5d6168", { roughness: 0.95 }) :
    look.shoji ? new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#c9b27c"; g.fillRect(0, 0, w, h); g.strokeStyle = "#5b4a2a"; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h / 2 - 2); g.strokeRect(2, h / 2, w - 4, h / 2 - 2); }, [6, 6]), roughness: 0.9 }) :
    mat(look.floor, { roughness: 0.85 });
  const floor = mesh(new THREE.PlaneGeometry(14, 14), floorMat, 0, 0, 0, room);
  floor.rotation.x = -PI / 2; floor.castShadow = false;

  const wallMat = street ? new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#8d99ab"; g.fillRect(0, 0, w, h); g.fillStyle = "#c9d6e8";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(14 + i * 62, 14 + j * 62, 40, 44);
  }, [3, 1]), roughness: 0.9 }) :
    look.shoji ? new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#f6f0e1"; g.fillRect(0, 0, w, h); g.strokeStyle = "#6b5233"; g.lineWidth = 5;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); }
      for (let j = 0; j <= 6; j++) { g.beginPath(); g.moveTo(0, j * h / 6); g.lineTo(w, j * h / 6); g.stroke(); }
    }, [4, 1]), roughness: 0.9 }) : mat(look.wall, { roughness: 0.95 });
  const back = mesh(new THREE.PlaneGeometry(14, 4.2), wallMat, 0, 2.1, -3.2, room); back.castShadow = false;
  [-1, 1].forEach((s) => {
    const side = mesh(new THREE.PlaneGeometry(9, 4.2), street ? mat("#7d8796") : mat(look.wall, { roughness: 0.95 }), 3.6 * s, 2.1, 1.2, room);
    side.rotation.y = -s * PI / 2; side.castShadow = false;
  });
  if (!street) {
    mesh(new THREE.BoxGeometry(14, 0.12, 0.04), mat("#3b2a1c"), 0, 0.06, -3.18, room);
    const win = mesh(new THREE.PlaneGeometry(1.3, 1.1), new THREE.MeshBasicMaterial({ color: "#bfe3ff" }), -1.8, 1.9, -3.18, room);
    win.castShadow = false;
    mesh(new THREE.BoxGeometry(1.4, 0.05, 0.06), mat("#ffffff"), -1.8, 1.32, -3.15, room);
  }
  if (poster) {
    const p = mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshBasicMaterial({ map: poster }), 1.15, 1.95, -3.17, room);
    p.castShadow = false;
  }
  if (look.rug && !street) {
    const rug = mesh(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshStandardMaterial({ map: ornament(look.rug[0], look.rug[1]), roughness: 1 }), 0, 0.006, -0.9, room);
    rug.rotation.x = -PI / 2; rug.castShadow = false;
  }

  if (street) {
    const pole = mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 10), mat("#cfd4da", { metalness: 0.6, roughness: 0.3 }), 1.4, 1.2, -1.2, room);
    const sign = mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = "#1d4ed8"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.font = "bold 46px Inter, sans-serif"; g.textAlign = "center"; g.fillText("BUS", w / 2, 60); g.font = "28px Inter"; g.fillText("🚌", w / 2, 104);
    }) }), 0, 1.0, 0.04, pole);
    sign.castShadow = false;
    mesh(new THREE.BoxGeometry(1.4, 0.06, 0.45), mat("#6b4f3a"), -1.9, 0.45, -1.8, room);
    ["#4b5563", "#6b7280", "#374151", "#52525b"].forEach((c, i) => silhouette(room, -0.55 + i * 0.15, -1.1 - i * 0.65, c));
    return room;
  }

  // table with national food & tableware
  const low = look.low;
  const th = low ? 0.36 : 0.76;
  const table = G(room, 1.25, 0, -0.45);
  table.rotation.y = -0.25;
  const round = code === "CN";
  const topGeo = round ? new THREE.CylinderGeometry(0.55, 0.55, 0.05, 32) : new THREE.BoxGeometry(1.1, 0.05, 0.75);
  const clothMap = look.cloth ? checker(look.cloth[0], look.cloth[1], 8) : look.rug ? ornament(look.rug[0], look.rug[1]) : null;
  mesh(topGeo, clothMap ? new THREE.MeshStandardMaterial({ map: clothMap, roughness: 0.9 }) : mat(low ? "#5a3820" : "#7b5233", { roughness: 0.6 }), 0, th, 0, table);
  const legM = mat("#4a2e1a");
  (round ? [[0, 0]] : [[-0.48, -0.32], [0.48, -0.32], [-0.48, 0.32], [0.48, 0.32]]).forEach(([x, z]) =>
    mesh(new THREE.CylinderGeometry(round ? 0.08 : 0.03, round ? 0.12 : 0.03, th, 10), legM, x, th / 2, z, table));
  if (low) [[-0.2, 0.62], [0.35, 0.6]].forEach(([x, z]) => mesh(new THREE.BoxGeometry(0.42, 0.07, 0.42), mat(code === "JP" ? "#7c2d3a" : "#2f5d8a"), x, 0.035, z, table));
  const y = th + 0.025;
  switch (code) {
    case "KZ":
      teapot("#f4f4f4", -0.3, y, 0, table); cups(3, "#f4f4f4", "#1f5fae", 0.15, y, 0.05, table);
      plate("#e9e2d0", 0.25, y, -0.18, table, 0.14);
      for (let i = 0; i < 9; i++) mesh(new THREE.SphereGeometry(0.028, 10, 8), mat("#c98a3a"), 0.25 + Math.cos(i) * 0.07, y + 0.035, -0.18 + Math.sin(i) * 0.06, table);
      break;
    case "TR":
      teapot("#c7c7c7", -0.32, y + 0.12, 0, table); teapot("#c7c7c7", -0.32, y, 0, table).scale.setScalar(1.3);
      for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.07, 12), mat("#b03a2e", { transparent: true, opacity: 0.85 }), 0.05 + i * 0.12, y + 0.035, 0.1, table);
      mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 20), mat("#c98a3a"), 0.3, y + 0.02, -0.15, table).rotation.x = PI / 2;
      break;
    case "IT":
      plate("#ffffff", -0.15, y, 0.05, table);
      mesh(new THREE.TorusKnotGeometry(0.045, 0.012, 48, 6), mat("#f1c40f"), -0.15, y + 0.04, 0.05, table);
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 14), mat("#1e5631", { roughness: 0.2 }), 0.3, y + 0.12, -0.15, table);
      mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.08, 10), mat("#1e5631"), 0.3, y + 0.28, -0.15, table);
      mesh(new THREE.CapsuleGeometry(0.04, 0.18, 4, 10), mat("#d4a050"), 0.2, y + 0.04, 0.2, table).rotation.z = PI / 2;
      break;
    case "HU":
      plate("#ffffff", -0.1, y, 0, table, 0.13);
      mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.02, 20), mat("#b8341b"), -0.1, y + 0.03, 0, table);
      for (let i = 0; i < 4; i++) mesh(new THREE.ConeGeometry(0.025, 0.12, 10), mat("#c0392b"), 0.25 + i * 0.05, y + 0.06, -0.2, table).rotation.z = 0.3;
      break;
    case "CN":
      teapot("#8a5a2b", 0, y, 0, table); cups(4, "#f5f0e6", "#2b6cb0", 0, y, 0, table);
      { const lantern = G(room, -1.4, 2.5, -1.6);
        mesh(new THREE.SphereGeometry(0.22, 18, 14), mat("#d0021b", { emissive: "#7a0010", emissiveIntensity: 0.6 }), 0, 0, 0, lantern).scale.y = 0.85;
        mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), mat("#f6c744"), 0, 0.2, 0, lantern);
        mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), mat("#f6c744"), 0, -0.2, 0, lantern); }
      break;
    case "JP":
      cups(2, "#8b6f47", null, 0, y, 0, table); teapot("#3b3b3b", -0.25, y, -0.05, table);
      { const bonsai = G(room, -2.4, 0, -2.6);
        mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.18, 16), mat("#3d2b1f"), 0, 0.09, 0, bonsai);
        mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.4, 8), mat("#5b3a29"), 0, 0.38, 0, bonsai).rotation.z = 0.3;
        [[0, 0.62, 0], [0.15, 0.55, 0.05], [-0.12, 0.66, -0.04]].forEach(([x, yy, z]) => mesh(new THREE.SphereGeometry(0.14, 12, 10), mat("#3f7d3a"), x, yy, z, bonsai)); }
      break;
    case "KR":
      ["#c0392b", "#27ae60", "#f39c12", "#8e44ad", "#d35400", "#16a085"].forEach((c, i) => {
        plate("#f5f5f5", -0.35 + (i % 3) * 0.3, y, -0.12 + Math.floor(i / 3) * 0.25, table, 0.07);
        mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(c), -0.35 + (i % 3) * 0.3, y + 0.025, -0.12 + Math.floor(i / 3) * 0.25, table).scale.y = 0.5;
      });
      break;
    case "GB":
      teapot("#f2f2f2", -0.2, y, 0, table); cups(2, "#ffffff", "#012169", 0.18, y, 0.05, table);
      ["#7b1e1e", "#1e3a5f", "#2e5d34"].forEach((c, i) => mesh(new THREE.BoxGeometry(0.22, 0.04, 0.15), mat(c), 0.3, y + 0.02 + i * 0.04, -0.2, table));
      break;
    case "DE":
    case "CA":
    case "US":
    default:
      mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 14), mat(code === "US" ? "#ffffff" : "#3a3a3a"), -0.3, y + 0.05, 0.1, table);
      if (code === "US") mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), mat("#d9c3a0"), 0.15, y + 0.025, -0.05, table);
      if (code === "CA") mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.18, 12), mat("#b5651d", { transparent: true, opacity: 0.85 }), 0.3, y + 0.09, -0.15, table);
      break;
  }

  // situation props
  if (["academic_dispute", "team_criticism", "lateness_crisis"].includes(situation)) {
    const lap = G(table, 0.05, y, 0.2);
    mesh(new THREE.BoxGeometry(0.34, 0.015, 0.24), mat("#9aa3ad", { metalness: 0.5, roughness: 0.3 }), 0, 0.008, 0, lap);
    const scr = mesh(new THREE.BoxGeometry(0.34, 0.22, 0.012), mat("#9aa3ad", { metalness: 0.5, roughness: 0.3 }), 0, 0.11, -0.12, lap);
    scr.rotation.x = -0.25;
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(0.21, 0.004, 0.29), mat("#fdfdfd"), -0.35, y + 0.003 + i * 0.005, 0.15 + i * 0.01, table).rotation.y = i * 0.08;
  }
  if (situation === "team_criticism") {
    const board = mesh(new THREE.BoxGeometry(1.6, 1.0, 0.04), mat("#fdfdfd", { roughness: 0.3 }), -0.2, 1.75, -3.12, room);
    ["#fde047", "#86efac", "#f9a8d4", "#93c5fd", "#fde047"].forEach((c, i) => mesh(new THREE.BoxGeometry(0.16, 0.16, 0.01), mat(c), -0.6 + i * 0.22, 0.1 * (i % 2), 0.03, board));
  }
  if (situation === "lateness_crisis" || code === "DE") wallClock(room, -0.4, 2.45, -3.15);
  if (situation === "gift_ceremony") {
    const vase = mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 14), mat("#5b8def", { roughness: 0.2 }), -0.35, y + 0.11, -0.2, table);
    ["#f43f5e", "#facc15", "#f43f5e", "#ffffff"].forEach((c, i) => mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(c), Math.cos(i * 1.6) * 0.05, 0.18 + (i % 2) * 0.04, Math.sin(i * 1.6) * 0.05, vase));
  }
  if (situation === "first_contact") {
    mesh(new THREE.BoxGeometry(1.0, 0.4, 2.0), mat("#e2e8f0"), -2.6, 0.2, -1.8, room);
    mesh(new THREE.BoxGeometry(0.9, 0.12, 0.4), mat("#ffffff"), -2.6, 0.46, -2.5, room);
    const suit = mesh(new THREE.BoxGeometry(0.45, 0.62, 0.22), mat("#7c3aed", { roughness: 0.4 }), -1.3, 0.31, 0.4, room);
    suit.rotation.y = 0.4;
  }
  return room;
}

/* Hall's proxemic zones on the floor around the character */
function buildRings(comfortCm) {
  const g = new THREE.Group();
  const flat = (inner, outer, color, opacity) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -PI / 2; m.position.y = 0.008; g.add(m); return m;
  };
  const c = comfortCm / 100, t = c * 0.75;
  g.userData.danger = flat(0.01, t, "#ef4444", 0.12);         // closer than 0.75 × comfort → invasive
  flat(t - 0.012, t + 0.012, "#ef4444", 0.75);
  g.userData.comfort = flat(c - 0.018, c + 0.018, "#22c55e", 0.9);
  flat(0.45 - 0.006, 0.45 + 0.006, "#f97316", 0.5);          // intimate 45 cm
  flat(1.2 - 0.006, 1.2 + 0.006, "#38bdf8", 0.45);           // personal 120 cm
  flat(3.6 - 0.01, 3.6 + 0.01, "#a78bfa", 0.3);              // social 360 cm
  return g;
}

/* ---------------------------------------------------------------------
   Animation library: each returns a target pose for elapsed time `e`
   --------------------------------------------------------------------- */
const CAM_BACK = 0.75;   // metres behind the player's eyes
const REST = { rootY: 0, spineX: 0.02, spineY: 0, spineZ: 0, headX: 0, headY: 0, headZ: 0,
  lShX: 0.04, lShZ: 0.07, lElX: -0.16, lElZ: 0, rShX: 0.04, rShZ: -0.07, rElX: -0.16, rElZ: 0 };
const EMO = {
  neutral:     { brow: 0, browY: 0, smile: 0.2, jaw: 0, blush: 0 },
  joy:         { brow: 0.12, browY: 0.004, smile: 0.95, jaw: 0.12, blush: 0.12 },
  surprise:    { brow: 0.2, browY: 0.012, smile: 0, jaw: 0.55, blush: 0 },
  annoyed:     { brow: -0.5, browY: -0.003, smile: -0.3, jaw: 0, blush: 0 },
  anger:       { brow: -0.85, browY: -0.006, smile: -0.75, jaw: 0.06, blush: 0.2 },
  embarrassed: { brow: 0.45, browY: 0.002, smile: 0.25, jaw: 0, blush: 0.75 },
  sad:         { brow: 0.7, browY: 0, smile: -0.55, jaw: 0, blush: 0 },
};
const ANIMS = {
  idle_breathing: { dur: 0, hold: true, pose: () => ({}) },
  bow_respect: { dur: 2.6, pose: (e, p) => {
    const d = (p.bow_deg || 15) * PI / 180;
    return { spineX: d, headX: 0.12, lShX: -d * 0.85, rShX: -d * 0.85, lShZ: -0.02, rShZ: 0.02, lElX: -0.25, rElX: -0.25 };
  } },
  handshake_reach: { dur: 2.8, pose: (e) => {
    const pump = e > 0.7 && e < 2.0 ? Math.sin((e - 0.7) * 11) * 0.07 : 0;
    return { spineX: 0.06, rShX: -1.05 + pump, rShZ: 0.05, rElX: -0.35, headX: 0.04 };
  } },
  two_hands_present: { dur: 3.2, prop: "gift", pose: () =>
    ({ spineX: 0.2, headX: 0.1, lShX: -0.95, rShX: -0.95, lShZ: -0.16, rShZ: 0.16, lElX: -0.55, rElX: -0.55 }) },
  expressive_gestures: { dur: 3.4, pose: (e, p) => {
    const a = Math.max(0.35, p.gesture_amp || 0.6), f = (p.gesture_freq || 1.5) * PI * 2;
    return { lShX: -0.55 + Math.sin(e * f) * 0.45 * a, rShX: -0.55 + Math.sin(e * f + 1.7) * 0.45 * a,
      lShZ: 0.25 + 0.3 * a * (0.5 + 0.5 * Math.sin(e * f * 0.7)), rShZ: -0.25 - 0.3 * a * (0.5 + 0.5 * Math.sin(e * f * 0.7 + 1)),
      lElX: -1.25 + Math.sin(e * f * 1.3) * 0.4 * a, rElX: -1.25 + Math.sin(e * f * 1.3 + 2) * 0.4 * a,
      headZ: Math.sin(e * f * 0.5) * 0.12 * a, spineY: Math.sin(e * f * 0.4) * 0.12 * a };
  } },
  step_back_uncomfortable: { dur: 0, hold: true, pose: (e) => {
    const stop = e < 0.9 ? 1 - smooth(0.6, 0.9, e) : 0;      // "stop" palm first, then crossed arms
    return { spineX: -0.06, headX: -0.06, headY: 0.08,
      rShX: lerp(-0.4, -1.3, stop), rShZ: lerp(-0.12, -0.05, stop), rElX: lerp(-1.55, -0.25, stop), rElZ: lerp(1.25, 0, stop),
      lShX: -0.4, lShZ: 0.12, lElX: -1.6, lElZ: -1.2 };
  } },
  warm_welcome_tea: { dur: 3.6, prop: "cup", pose: (e) => {
    const k = smooth(1.0, 1.6, e);
    return { spineX: 0.06 + 0.06 * k, headX: 0.05, rShX: lerp(-0.65, -0.95, k), rShZ: lerp(-0.75, -0.08, k), rElX: lerp(-0.3, -0.7, k),
      lShX: -0.2, lShZ: 0.2, lElX: -0.5 };
  } },
  nod_approval: { dur: 2.2, aura: "#22c55e", pose: (e) => ({ headX: Math.max(0, Math.sin(e * PI * 2 * 1.4)) * 0.22, spineX: 0.04 }) },
  offended_look_away: { dur: 0, hold: true, aura: "#ef4444", pose: () =>
    ({ rootY: 0.6, headY: 0.4, headX: 0.12, spineX: -0.02, lShX: -0.35, lShZ: 0.12, lElX: -1.5, lElZ: -1.1, rShX: -0.35, rShZ: -0.12, rElX: -1.55, rElZ: 1.2 }) },
};

/* ---------------------------------------------------------------------
   Stage: renderer + scene + character + camera that follows the distance
   --------------------------------------------------------------------- */
class Stage {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts || {};
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0d1226");
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 40);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a3b2a, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(2.5, 4.5, 3.5); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 14 });
    this.scene.add(sun);
    this.fill = new THREE.PointLight(0xffe2b8, 0.35, 8); this.fill.position.set(-1.5, 2.4, 1.5); this.scene.add(this.fill);

    this.base = new THREE.Group();          // character + rings (moves when the character steps back)
    this.scene.add(this.base);
    this.pose = Object.assign({}, REST, { brow: 0, browY: 0, smile: 0.2, jaw: 0, blush: 0 });
    this.anim = { name: "idle_breathing", t0: 0, p: {} };
    this.emotion = "neutral"; this.gaze = "direct";
    this.speaking = false; this.mouthPulse = 0;
    this.distance = 120; this.zoff = 0; this.zoffTarget = 0; this.yaw = 0;
    this.blinkAt = 2; this.glanceAt = 3; this.glance = 0;
    this.auraColor = new THREE.Color("#22c55e"); this.auraLevel = 0;
    this.clock = new THREE.Clock();
    this.visible = true;

    this._bindInput();
    this._resize();
    if (window.ResizeObserver) new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    else window.addEventListener("resize", () => this._resize());
    if (window.IntersectionObserver) new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; }).observe(canvas);
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _resize() {
    const el = this.canvas.parentElement, w = el.clientWidth, h = el.clientHeight || Math.round(w * 9 / 16);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 62 : 50;
    this.camera.updateProjectionMatrix();
  }

  _bindInput() {
    let drag = null;
    this.canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, yaw: this.yaw }; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener("pointermove", (e) => { if (drag) this.yaw = clamp(drag.yaw - (e.clientX - drag.x) / 300, -0.7, 0.7); });
    const end = () => { drag = null; };
    this.canvas.addEventListener("pointerup", end); this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("wheel", (e) => {
      if (!this.opts.onWheel || !e.shiftKey) return;     // plain wheel keeps scrolling the page
      e.preventDefault(); this.opts.onWheel((e.deltaY || e.deltaX) > 0 ? 10 : -10);
    }, { passive: false });
  }

  /* Build (or rebuild) the scene for a nation × situation */
  setScene({ code, persona, situation, comfortCm, poster }) {
    const look = LOOKS[code] || DEFAULT_LOOK;
    if (this.room) { this.scene.remove(this.room); dispose(this.room); }
    if (this.J) { this.base.remove(this.J.root); dispose(this.J.root); }
    if (this.rings) { this.base.remove(this.rings); dispose(this.rings); }
    this.room = buildRoom(look, code, situation, poster ? posterTexture(poster.flag, poster.word, poster.roman, poster.title) : null);
    this.scene.add(this.room);
    this.scene.background = new THREE.Color(situation === "public_etiquette" ? "#9fb7d1" : look.wall).multiplyScalar(0.55);
    this.J = buildHuman(look, persona, code);
    this.base.add(this.J.root);
    this.rings = buildRings(comfortCm);
    this.base.add(this.rings);
    this.comfort = comfortCm;
    this.zoff = this.zoffTarget = 0; this.base.position.z = 0;
    this.pose = Object.assign({}, REST, { brow: 0, browY: 0, smile: 0.2, jaw: 0, blush: 0 });
    this.play("idle_breathing");
    this.setEmotion("neutral");
  }

  play(name, params) {
    if (!ANIMS[name]) name = "idle_breathing";
    this.anim = { name, t0: this.clock.getElapsedTime(), p: params || {} };
    const a = ANIMS[name];
    if (a.aura) { this.auraColor.set(a.aura); this.auraLevel = 1; }
    if (this.opts.onAnim) this.opts.onAnim(name);
  }
  setEmotion(e) { this.emotion = EMO[e] ? e : "neutral"; }
  setGaze(g) { this.gaze = g || "direct"; }
  setSpeaking(on) { this.speaking = on; }
  pulseMouth() { this.mouthPulse = 1; }
  setDistance(cm) { this.distance = cm; }
  /* character retreats by `cm`; the camera stays where it is, so the distance grows */
  stepBack(cm) {
    const room = this.zoffTarget + 2.3;                  // keep the character off the back wall
    const m = Math.min(cm / 100, Math.max(0, room));
    this.zoffTarget -= m;
    return Math.round(m * 100);
  }
  resetPosition() { this.zoffTarget = 0; }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.visible || document.hidden || !this.J) return;
    const t = this.clock.getElapsedTime(), J = this.J, P = this.pose;
    const a = this.anim, def = ANIMS[a.name], e = t - a.t0;
    if (!def.hold && def.dur && e > def.dur) this.play("idle_breathing");
    const env = def.hold ? smooth(0, 0.35, e) : smooth(0, 0.3, e) * (1 - smooth(def.dur - 0.45, def.dur, e));
    const T = Object.assign({}, REST);
    const ap = def.pose(e, a.p);
    for (const k in ap) T[k] = lerp(REST[k] || 0, ap[k], env);

    // talking hands: amplitude & frequency come from the culture's expressiveness (server: body.gesture_amp/freq)
    if (this.speaking && ["idle_breathing", "nod_approval"].includes(a.name)) {
      const amp = this.gestureAmp != null ? this.gestureAmp : 0.5, f = (this.gestureFreq || 1.4) * PI * 2;
      T.lElX += -amp * 0.9 * (0.5 + 0.5 * Math.sin(t * f));
      T.rElX += -amp * 0.9 * (0.5 + 0.5 * Math.sin(t * f + 2.1));
      T.lShX += -amp * 0.35 * (0.5 + 0.5 * Math.sin(t * f * 0.8 + 1));
      T.rShX += -amp * 0.35 * (0.5 + 0.5 * Math.sin(t * f * 0.8 + 3));
      T.lShZ += amp * 0.25 * Math.max(0, Math.sin(t * f * 0.6));
      T.rShZ -= amp * 0.25 * Math.max(0, Math.sin(t * f * 0.6 + 1.4));
      T.headX += Math.sin(t * 5.5) * 0.025; T.headZ += Math.sin(t * 2.3) * 0.03 * (0.3 + amp);
    }
    // idle micro-movements
    T.headY += Math.sin(t * 0.37) * 0.05; T.headX += Math.sin(t * 0.53) * 0.02; T.spineZ += Math.sin(t * 0.29) * 0.012;

    // the character turns to face the camera when it orbits (unless offended)
    T.rootY += this.yaw * 0.75;

    const k = 1 - Math.exp(-dt * 7);
    for (const key in REST) P[key] = lerp(P[key], T[key], k);
    const em = EMO[this.emotion];
    const ke = 1 - Math.exp(-dt * 6);
    ["brow", "browY", "smile", "blush"].forEach((key) => { P[key] = lerp(P[key], em[key], ke); });

    // lip-sync: jaw follows word boundaries (Web Speech) or a syllable oscillator
    this.mouthPulse = Math.max(0, this.mouthPulse - dt * 4);
    const talk = this.speaking ? 0.25 + 0.45 * Math.abs(Math.sin(t * 13)) * (0.6 + 0.4 * Math.sin(t * 3.1)) + this.mouthPulse * 0.4 : 0;
    P.jaw = lerp(P.jaw, Math.max(em.jaw, talk), 1 - Math.exp(-dt * 18));

    // apply pose
    J.root.rotation.y = P.rootY;
    J.spine.rotation.set(P.spineX, P.spineY, P.spineZ);
    J.chest.scale.set(1 + Math.sin(t * 1.7) * 0.008, 1 + Math.sin(t * 1.7) * 0.014, 1 + Math.sin(t * 1.7) * 0.012);
    J.head.rotation.set(P.headX, P.headY, P.headZ);
    J.lSh.rotation.set(P.lShX, 0, P.lShZ); J.rSh.rotation.set(P.rShX, 0, P.rShZ);
    J.lEl.rotation.set(P.lElX, 0, P.lElZ); J.rEl.rotation.set(P.rElX, 0, P.rElZ);
    J.brows.forEach((b) => { b.m.rotation.z = -b.s * P.brow * 0.45; b.m.position.y = b.y + P.browY; });
    J.smile.scale.set(1, clamp(P.smile, -1, 1) * 0.9 + (Math.abs(P.smile) < 0.1 ? 0.1 : 0), 1);
    J.smile.position.y = -P.jaw * 0.004;
    J.jaw.scale.set(1 - P.jaw * 0.2, 0.05 + P.jaw * 0.85, 0.4);
    J.blush.forEach((b) => { b.material.opacity = P.blush * 0.55; });
    const prop = def.prop && env > 0.5 ? def.prop : null;
    J.gift.visible = prop === "gift"; J.cup.visible = prop === "cup";

    // walking back (legs alternate while the root moves)
    const prevZ = this.zoff;
    this.zoff = lerp(this.zoff, this.zoffTarget, 1 - Math.exp(-dt * 3));
    this.base.position.z = this.zoff;
    const moving = Math.abs(this.zoff - prevZ) > 0.0006;
    const stride = moving ? Math.sin(t * 9) * 0.35 : 0;
    J.lHip.rotation.x = lerp(J.lHip.rotation.x, stride, 0.3); J.rHip.rotation.x = lerp(J.rHip.rotation.x, -stride, 0.3);
    J.lKnee.rotation.x = lerp(J.lKnee.rotation.x, moving ? Math.max(0, -stride) : 0, 0.3);
    J.rKnee.rotation.x = lerp(J.rKnee.rotation.x, moving ? Math.max(0, stride) : 0, 0.3);

    // aura
    this.auraLevel = Math.max(0, this.auraLevel - dt * 0.35);
    J.aura.material.color.copy(this.auraColor);
    J.aura.material.opacity = this.auraLevel * (0.55 + 0.25 * Math.sin(t * 6));

    // camera: the player's eyes at `distance` cm from the character's *target* position, pulled back a little
    // (over-the-shoulder) so gestures stay in frame even at 50 cm; orbit by drag
    const R = this.distance / 100 + CAM_BACK;
    const cx = Math.sin(this.yaw) * R, cz = this.zoffTarget + Math.cos(this.yaw) * R;
    this.camera.position.set(cx, 1.62, cz);
    this.camera.lookAt(0, 1.38, this.zoff);

    // danger zone glows when the player is inside it
    const inside = this.comfort && this.distance < this.comfort * 0.75;
    if (this.rings) this.rings.userData.danger.material.opacity = inside ? 0.28 + 0.12 * Math.sin(t * 8) : 0.1;

    // eyes: gaze at the camera, soft (chin-level, glances away) or averted; blinking
    J.head.updateWorldMatrix(true, false);
    const local = J.head.worldToLocal(this.camera.position.clone()).sub(new THREE.Vector3(0, 0.11, 0)).normalize();
    let px = clamp(local.x * 0.024, -0.008, 0.008), py = clamp(local.y * 0.024, -0.007, 0.007);
    if (t > this.glanceAt) { this.glance = this.gaze === "soft" ? (Math.random() < 0.5 ? -1 : 1) : 0; this.glanceAt = t + 1.5 + Math.random() * 3; }
    if (this.gaze === "soft") { py -= 0.004; px += this.glance * 0.004; }
    if (this.gaze === "averted" || a.name === "offended_look_away") { px = 0.009; py = -0.006; }
    if (t > this.blinkAt) this.blinkAt = t + 2.5 + Math.random() * 3;
    const blink = this.blinkAt - t < 0.12 ? 0.1 : 1;
    J.eyes.forEach((ey) => {
      ey.pupil.position.x = lerp(ey.pupil.position.x, px, 0.2);
      ey.pupil.position.y = lerp(ey.pupil.position.y, py, 0.2);
      ey.g.scale.y = blink;
    });
    if (this.opts.onFrame) this.opts.onFrame(this);
    this.renderer.render(this.scene, this.camera);
  }
}

function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  });
}

window.CBSandbox3D = { Stage, LOOKS, ANIMS: Object.keys(ANIMS) };
})();

// Applies the saved theme before first paint (external file: the CSP forbids inline scripts).
// Light is the default; dark only if the visitor chose it with the theme button.
try { const t = localStorage.getItem("cb-theme"); if (t === "dark" || t === "light") document.documentElement.dataset.theme = t; } catch (e) {}
document.addEventListener("DOMContentLoaded", () => {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = document.documentElement.dataset.theme === "dark" ? "#070a15" : "#f8fafc";
});

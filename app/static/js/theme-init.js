// Applies the saved theme before first paint (external file: the CSP forbids inline scripts).
try { const t = localStorage.getItem("cb-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
document.addEventListener("DOMContentLoaded", () => {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m && document.documentElement.dataset.theme === "light") m.content = "#f8fafc";
});

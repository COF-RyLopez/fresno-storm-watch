/* Run before the application paints; a stored preference is optional. No account data is stored. */
(() => {
  const root = document.documentElement;
  const storageKey = 'fresno-storm-watch-theme';
  let mode = 'dark';
  try { if (localStorage.getItem(storageKey) === 'light') mode = 'light'; } catch { /* Storage can be disabled. */ }

  function renderControl() {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const label = mode === 'dark' ? 'Light mode' : 'Dark mode';
    button.title = `Switch to ${label.toLowerCase()}`;
    if (button.localName === 'calcite-action') {
      button.setAttribute('text', label);
      button.setAttribute('icon', mode === 'dark' ? 'brightness' : 'moon');
    } else button.textContent = label;
  }

  function apply(next, save = false) {
    mode = next;
    root.dataset.theme = mode;
    root.classList.toggle('calcite-mode-dark', mode === 'dark');
    root.classList.toggle('calcite-mode-light', mode === 'light');
    const stylesheet = document.getElementById('esri-theme');
    const href = `https://js.arcgis.com/5.1/esri/themes/${mode}/main.css`;
    if (stylesheet && stylesheet.href !== href) stylesheet.href = href;
    if (save) { try { localStorage.setItem(storageKey, mode); } catch { /* The switch still works for this page. */ } }
    renderControl();
    window.dispatchEvent(new CustomEvent('storm-theme-change', { detail: { mode } }));
  }

  apply(mode);
  document.addEventListener('DOMContentLoaded', () => {
    renderControl();
    document.getElementById('theme-toggle')?.addEventListener('click', () => apply(mode === 'dark' ? 'light' : 'dark', true));
  }, { once: true });
  window.addEventListener('storage', event => {
    if (event.key === storageKey) apply(event.newValue === 'light' ? 'light' : 'dark');
  });
})();

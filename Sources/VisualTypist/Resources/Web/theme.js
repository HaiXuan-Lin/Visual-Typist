// Sets the theme before the page is drawn: the one chosen with the toolbar's theme button
// (window.VT_THEME, provided by the app; in a browser, kept in localStorage), or else the system's.
(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    let chosen = window.VT_THEME;
    if (chosen === undefined) { try { chosen = localStorage.getItem('vt.theme'); } catch (_) { /* The web edition keeps it here. */ } }
    document.documentElement.dataset.theme = chosen === 'light' || chosen === 'dark' ? chosen : media.matches ? 'dark' : 'light';
  };
  apply();
  media.addEventListener('change', apply);
  window.VT_APPLY_THEME = apply;
})();

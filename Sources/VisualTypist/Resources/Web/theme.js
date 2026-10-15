// Sets the theme before the page is drawn: the one chosen with the toolbar's theme button
// (window.VT_THEME, provided by the app), or else the system's, following its changes.
(() => {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const chosen = window.VT_THEME;
    document.documentElement.dataset.theme = chosen === 'light' || chosen === 'dark' ? chosen : media.matches ? 'dark' : 'light';
  };
  apply();
  media.addEventListener('change', apply);
  window.VT_APPLY_THEME = apply;
})();

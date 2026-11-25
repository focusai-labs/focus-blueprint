// Runs before the page paints: night mode only when the reader chose it (light by default, the OS setting is ignored).
try { if (localStorage.getItem('bp-theme') === 'dark') document.documentElement.dataset.theme = 'dark'; } catch (e) { /* storage blocked: light */ }

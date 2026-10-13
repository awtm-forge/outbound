// Runs before the first paint so the page never flashes the wrong theme. A saved "light" or "dark" wins; anything
// else (or nothing) follows the operating system through the CSS media query.
try { var t = localStorage.getItem('awtm-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}

// Runs before the first paint so the page never flashes the wrong theme. A saved "light", "dark" or "system" is
// applied; nothing saved means dark, the default look. "system" follows the operating system through a media query.
try { var t = localStorage.getItem('awtm-theme'); if (t === 'light' || t === 'dark' || t === 'system') document.documentElement.setAttribute('data-theme', t); } catch (e) {}

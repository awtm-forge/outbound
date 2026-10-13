import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './design/tokens.css';
import './design/ui.css';
import './design/components.css';
import './design/dash.css';
import './design/auth.css';
import './design/project.css';
import './design/crm.css';
import './design/people.css';
import { App } from './App.tsx';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
// installable as an app on phones and desktops; see public/sw.js for what it does (and does not) do
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });

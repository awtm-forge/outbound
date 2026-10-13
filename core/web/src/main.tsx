import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './design/tokens.css';
import './design/ui.css';
import './design/components.css';
import './design/dash.css';
import { App } from './App.tsx';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

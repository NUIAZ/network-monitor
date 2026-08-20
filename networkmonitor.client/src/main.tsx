/**
 * Client entry point. CSS import order matters: Bootstrap first, then icons,
 * then our token stylesheet so it can override Bootstrap defaults.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './index.css';
import App from './App';
import { init as initErrorLogger } from './services/errorLogger';

// Installed before the first render so a crash during initial mount is still
// reported: the failures worth catching are the ones that happen early.
initErrorLogger();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* Dunkles Thema vor dem ersten Zeichnen setzen. Das stand frueher als
   Inline-Skript in index.html; die Content-Security-Policy erlaubt nur noch
   Skripte aus eigenen Dateien. */
try {
  const gespeichert = JSON.parse(localStorage.getItem('blankr_state'));
  if (gespeichert && gespeichert.darkMode) document.body.dataset.theme = 'dark';
} catch {
  // nichts gespeichert
}

import { createRoot } from 'react-dom/client';
import App from './App';
import './App.css';
import { getDoc, getState, SITE } from './store';

/**
 * Diagnose-Haken. Bei einem verteilten Zustand ist die entscheidende Frage
 * im Fehlerfall immer "was steht bei dir, was bei mir" -- dafuer muss man in
 * der Konsole an Dokument und Zustand herankommen, ohne einen Debug-Build.
 * Nur lesend, kein Schreibzugriff.
 */
window.__blankr = { getState, getDoc, site: SITE };

createRoot(document.getElementById('root')).render(<App />);

import { useEffect, useState } from 'react';
import { api } from '../api';
import { freigabeLink } from '../collab';
import { setState, showToast, useStore } from '../store';

/**
 * Freigabe eines Boards.
 *
 * Die Board-Kennung in der Adresse ist kein Zugang mehr. Wer andere dazuholen
 * will, stellt hier einen Link aus -- zum Bearbeiten oder nur zum Ansehen.
 * Jeder lässt sich einzeln zurückziehen, und wer über ihn gerade drin ist,
 * fliegt dabei sofort raus.
 */
const ROLLEN = [
  { rolle: 'bearbeiten', titel: 'Bearbeiten', feld: 'editToken', text: 'Darf zeichnen, verschieben und löschen.' },
  { rolle: 'ansehen', titel: 'Nur ansehen', feld: 'viewToken', text: 'Sieht das Board live mit, kann aber nichts ändern.' },
];

export default function FreigabeDialog() {
  const boardId = useStore((s) => s.freigabeOffen);
  const gaeste = useStore((s) => s.auth?.gaeste);
  const [board, setBoard] = useState(null);
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!boardId) return;
    setBoard(null);
    setFehler('');
    api(`/api/boards/${encodeURIComponent(boardId)}`)
      .then(setBoard)
      .catch((e) => setFehler(e.message));
  }, [boardId]);

  if (!boardId) return null;
  const schliessen = () => setState({ freigabeOffen: null });

  async function aendern(rolle, erstellen) {
    setBusy(rolle);
    setFehler('');
    try {
      const pfad = `/api/boards/${encodeURIComponent(boardId)}/freigabe`;
      const neu = erstellen
        ? await api(pfad, { methode: 'POST', daten: { rolle } })
        : await api(`${pfad}?rolle=${rolle}`, { methode: 'DELETE' });
      setBoard(neu);
      if (!erstellen) showToast('Link zurückgezogen');
    } catch (e) {
      setFehler(e.message);
    } finally {
      setBusy('');
    }
  }

  function kopieren(link) {
    navigator.clipboard
      .writeText(link)
      .then(() => showToast('Link kopiert'))
      .catch(() => showToast('Kopieren nicht möglich, Link bitte markieren'));
  }

  return (
    <div className="board-backdrop" onPointerDown={schliessen}>
      <div className="board-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Board teilen">
        <header>
          <h2>{board ? `„${board.name}“ teilen` : 'Teilen'}</h2>
          <button type="button" className="board-close" onClick={schliessen} title="Schließen">
            ×
          </button>
        </header>
        {fehler && <p className="board-error">{fehler}</p>}
        {board &&
          ROLLEN.map(({ rolle, titel, feld, text }) => {
            const token = board[feld];
            const link = token ? freigabeLink(token) : '';
            return (
              <section key={rolle} className="freigabe-zeile">
                <div className="freigabe-kopf">
                  <strong>{titel}</strong>
                  <span>{text}</span>
                </div>
                {token ? (
                  <div className="freigabe-link">
                    <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={`Link: ${titel}`} />
                    <button type="button" onClick={() => kopieren(link)}>
                      Kopieren
                    </button>
                    <button type="button" className="danger" disabled={busy === rolle} onClick={() => aendern(rolle, false)}>
                      Zurückziehen
                    </button>
                  </div>
                ) : (
                  <button type="button" className="knopf-primaer" disabled={busy === rolle} onClick={() => aendern(rolle, true)}>
                    Link erstellen
                  </button>
                )}
              </section>
            );
          })}
        <p className="board-hint">
          {gaeste
            ? 'Wer einen Link hat, kommt ohne Konto hinein. Gib ihn nur an Personen weiter, die das Board sehen sollen.'
            : 'Auf dieser Instanz braucht auch, wer einen Link hat, ein Konto.'}
        </p>
      </div>
    </div>
  );
}

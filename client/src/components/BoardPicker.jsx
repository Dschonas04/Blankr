import { useCallback, useEffect, useState } from 'react';
import { setState, showToast, useStore } from '../store';
import * as collab from '../collab';

/**
 * Board-Verwaltung. Boards liegen auf dem Server und ueberleben dort
 * Neustarts -- im Gegensatz zu den frueheren Raeumen, die verschwanden,
 * sobald der letzte Teilnehmer die Seite schloss.
 */
export default function BoardPicker() {
  const open = useStore((s) => s.boardPickerOpen);
  const boards = useStore((s) => s.boards);
  const currentBoard = useStore((s) => s.collabRoom);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setState({ boards: await collab.listBoards() });
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [open, refresh]);

  if (!open) return null;

  const close = () => setState({ boardPickerOpen: false });

  const create = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const board = await collab.createBoard(trimmed);
      setName('');
      await refresh();
      openBoard(board);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openBoard = (board) => {
    const url = new URL(window.location);
    url.searchParams.set('board', board.id);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    collab.disconnect();
    collab.connect(board.id, board.name);
    setState({ boardPickerOpen: false });
  };

  const rename = async (board, value) => {
    const trimmed = value.trim();
    setRenaming(null);
    if (!trimmed || trimmed === board.name) return;
    try {
      await collab.renameBoard(board.id, trimmed);
      await refresh();
    } catch (err) {
      showToast(err.message);
    }
  };

  const remove = async (board) => {
    if (!window.confirm(`Board „${board.name}" endgültig löschen?`)) return;
    try {
      await collab.deleteBoard(board.id);
      if (currentBoard === board.id) collab.disconnect();
      await refresh();
    } catch (err) {
      showToast('Löschen nicht möglich — arbeitet gerade jemand darauf?');
    }
  };

  return (
    <div className="board-backdrop" onPointerDown={close}>
      <div className="board-dialog" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Boards</h2>
          <button type="button" className="board-close" onClick={close} title="Schließen">
            ×
          </button>
        </header>

        <form className="board-create" onSubmit={create}>
          <input
            type="text"
            placeholder="Name des neuen Boards"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          <button type="submit" disabled={busy || !name.trim()}>
            Anlegen
          </button>
        </form>

        {error && <p className="board-error">{error}</p>}

        <ul className="board-list">
          {boards.map((board) => (
            <li key={board.id} className={board.id === currentBoard ? 'current' : ''}>
              {renaming === board.id ? (
                <input
                  className="board-rename"
                  autoFocus
                  defaultValue={board.name}
                  onBlur={(e) => rename(board, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.target.blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button type="button" className="board-open" onClick={() => openBoard(board)}>
                  <span className="board-name">{board.name}</span>
                  <span className="board-meta">
                    {board.online > 0 && <em className="board-online">{board.online} online</em>}
                    {new Date(board.updatedAt).toLocaleString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              )}
              <span className="board-actions">
                <button type="button" onClick={() => setRenaming(board.id)} title="Umbenennen">
                  Umbenennen
                </button>
                <button type="button" className="danger" onClick={() => remove(board)} title="Löschen">
                  Löschen
                </button>
              </span>
            </li>
          ))}
          {!boards.length && !error && (
            <li className="board-empty">Noch keine Boards. Lege oben eines an.</li>
          )}
        </ul>

        <p className="board-hint">
          Boards werden auf dem Server gespeichert und überstehen einen Neustart. Ohne
          geöffnetes Board arbeitest du lokal — dieser Stand liegt nur in diesem Browser.
        </p>
      </div>
    </div>
  );
}

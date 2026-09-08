import { useState } from 'react';

import { sitzungsLink } from '../collab';
import { useStore, showToast } from '../store';
import { IconKette, IconPruefen } from './Icons';

/**
 * Die Leiste zur Sitzung.
 *
 * Sie stand vorher da als Name, ein paar farbige Punkte und ein Knopf. Was
 * man an dieser Stelle wissen will, stand nicht dabei: bin ich mit anderen
 * zusammen, wer ist das, und wie hole ich jemanden dazu.
 *
 * Jetzt trägt sie drei Dinge in dieser Reihenfolge: den Namen der Sitzung,
 * die Beteiligten als Kreise mit ihrem Anfangsbuchstaben, und den Link. Der
 * eigene Kreis steht vorn und ist als solcher gekennzeichnet -- ohne das
 * sucht man sich in der eigenen Runde selbst.
 */
const SICHTBAR = 4;

export default function CollabBar() {
  const connected = useStore((s) => s.collabConnected);
  const users = useStore((s) => s.collabUsers);
  const cursors = useStore((s) => s.remoteCursors);
  const boardName = useStore((s) => s.collabBoardName);
  const [kopiert, setKopiert] = useState(false);

  // Die eigene Kennung steht im Store nicht, wohl aber im Zeigerstrom: wer
  // dort fehlt, ist man selbst. Reicht für die Reihenfolge und spart eine
  // zweite Quelle für dieselbe Angabe.
  const fremd = new Set(Object.keys(cursors));
  const sortiert = [...users].sort((a, b) => Number(fremd.has(a.id)) - Number(fremd.has(b.id)));
  const gezeigt = sortiert.slice(0, SICHTBAR);
  const rest = sortiert.length - gezeigt.length;

  function linkKopieren() {
    const link = sitzungsLink();
    navigator.clipboard
      .writeText(link)
      .then(() => {
        setKopiert(true);
        showToast('Link kopiert, jetzt teilen');
        // Zurück in den Normalzustand: der Haken ist eine Rückmeldung, kein
        // Zustand, in dem der Knopf bleiben dürfte.
        setTimeout(() => setKopiert(false), 2000);
      })
      .catch(() => showToast('Kopieren nicht möglich, Adresse aus der Leiste nehmen'));
  }

  return (
    <>
      {connected && (
        <div className="ui-collab">
          <div className="collab-sitzung">
            <span className="collab-marke">Sitzung</span>
            <span className="collab-board" title={boardName}>
              {boardName}
            </span>
          </div>

          <div id="collab-users" title={sortiert.map((u) => u.name).join(', ')}>
            {gezeigt.map((u, i) => (
              <span
                key={u.id}
                className={'collab-dot' + (i === 0 && !fremd.has(u.id) ? ' selbst' : '')}
                style={{ background: u.color }}
                title={i === 0 && !fremd.has(u.id) ? `${u.name} (du)` : u.name}
              >
                {(u.name || '?').trim().charAt(0).toUpperCase()}
              </span>
            ))}
            {rest > 0 && <span className="collab-dot collab-rest">+{rest}</span>}
          </div>

          {users.length < 2 && <span className="collab-allein">niemand sonst da</span>}

          <button className="share-btn" onClick={linkKopieren} title={sitzungsLink()}>
            {kopiert ? <IconPruefen /> : <IconKette />}
            {kopiert ? 'Kopiert' : 'Link teilen'}
          </button>
        </div>
      )}

      {Object.entries(cursors).map(([id, c]) => (
        <div
          key={id}
          className="remote-cursor"
          style={{ left: c.x, top: c.y, '--cursor-color': c.color }}
        >
          <span className="remote-cursor-label">{c.name}</span>
        </div>
      ))}
    </>
  );
}

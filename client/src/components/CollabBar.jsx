import { useStore, showToast } from '../store';

export default function CollabBar() {
  const connected = useStore(s => s.collabConnected);
  const users = useStore(s => s.collabUsers);
  const cursors = useStore(s => s.remoteCursors);

  return (
    <>
      {/* Collab bar */}
      {connected && (
        <div className="ui-collab">
          <div id="collab-users">
            {users.map(u => (
              <span
                key={u.id}
                className="collab-dot"
                style={{ background: u.color }}
                title={u.name}
              />
            ))}
          </div>
          <button
            className="share-btn"
            onClick={() =>
              navigator.clipboard.writeText(location.href).then(() => showToast('🔗 Link kopiert!'))
            }
          >
            🔗 Link kopieren
          </button>
        </div>
      )}

      {/* Remote cursors */}
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

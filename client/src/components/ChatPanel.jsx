// Chat Sidebar Panel

import { useState, useRef, useEffect } from 'react';
import { useStore, getState, setState } from '../store';
import { send as collabSend, isConnected } from '../collab';
import { IconKreuz, IconSenden } from './Icons';

export default function ChatPanel() {
  const chatOpen = useStore(s => s.chatOpen);
  const messages = useStore(s => s.chatMessages);
  const connected = useStore(s => s.collabConnected);
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  if (!chatOpen) return null;

  function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const msg = {
      id: Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      name: 'Ich',
      text: text.trim(),
      time: Date.now(),
      own: true,
    };
    setState(s => ({ chatMessages: [...s.chatMessages, msg] }));
    if (isConnected()) {
      collabSend({ type: 'chat', text: text.trim() });
    }
    setText('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>Chat</span>
        <button
          className="chat-close"
          title="Chat schließen"
          aria-label="Chat schließen"
          onClick={() => setState({ chatOpen: false })}
        >
          <IconKreuz />
        </button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            {connected ? 'Noch keine Nachrichten' : 'Verbinde dich, um zu chatten'}
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={`chat-msg${m.own ? ' own' : ''}`}>
            <span className="chat-name" style={{ color: m.color }}>{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          placeholder={connected ? 'Nachricht...' : 'Nicht verbunden'}
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={!connected}
        />
        <button type="submit" title="Senden" aria-label="Senden" disabled={!connected || !text.trim()}>
          <IconSenden />
        </button>
      </form>
    </div>
  );
}

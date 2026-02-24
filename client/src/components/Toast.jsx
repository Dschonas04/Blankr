import { useStore } from '../store';

export default function Toast() {
  const msg = useStore(s => s.toastMsg);
  return <div className={`toast${msg ? '' : ' hidden'}`}>{msg || ''}</div>;
}

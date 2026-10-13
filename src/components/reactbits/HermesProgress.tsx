import { useEffect, useState, useSyncExternalStore } from 'react';
import ThoughtLine from './ThoughtLine';
import LatticeLoader from './LatticeLoader';
import { hermesChat } from '../../lib/hermes-chat-state';

export default function HermesProgress() {
  const state = useSyncExternalStore(hermesChat.subscribe, hermesChat.getSnapshot, hermesChat.getServerSnapshot);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!state.busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [state.busy, state.startedAt]);
  if (!state.startedAt) return null;
  const elapsed = Math.max(0, ((state.busy ? now : state.finishedAt) - state.startedAt) / 1000);
  const doneLabel = state.outcome === 'stopped' ? 'Dihentikan' : state.outcome === 'error' ? 'Gagal' : 'Selesai';
  return <div className="hm-progress" aria-label="Status proses Hermes">
    <span aria-hidden="true"><LatticeLoader
      label="" doneLabel="" errorLabel=""
      status={state.busy ? 'working' : state.outcome === 'done' ? 'done' : 'error'}
      pattern="sweep" grid={4} cellSize={3} gap={2}
      color="#1B7A5C" doneColor="#1B7A5C" showTimer={false}
    /></span>
    <ThoughtLine
      label="Hermes sedang bekerja" doneLabel={doneLabel}
      working={state.busy} elapsed={elapsed} steps={state.steps}
      glyph="none" fontSize={13} color="#154F3F"
    />
  </div>;
}

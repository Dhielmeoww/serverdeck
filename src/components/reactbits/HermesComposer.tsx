import { useSyncExternalStore } from 'react';
import PromptBar from './PromptBar';
import { hermesChat, requestHermesSend, requestHermesStop } from '../../lib/hermes-chat-state';

export default function HermesComposer() {
  const { busy } = useSyncExternalStore(hermesChat.subscribe, hermesChat.getSnapshot, hermesChat.getServerSnapshot);
  return <PromptBar
    className="hm-composer"
    inputId="hm-chat-input"
    placeholder="Perintahkan Hermes…"
    sources={[]}
    commands={[]}
    models={[]}
    efforts={[]}
    background="#f1f5f9"
    color="#334155"
    menuBackground="#ffffff"
    sparkColor="#268E6B"
    radius={24}
    busy={busy}
    onSend={requestHermesSend}
    onStop={requestHermesStop}
  />;
}

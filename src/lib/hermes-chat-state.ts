/** Shared state between the streaming controller and React Bits islands. */
export interface HermesChatState {
  busy: boolean;
  startedAt: number;
  finishedAt: number;
  outcome: 'done' | 'error' | 'stopped';
  steps: string[];
}

const initial: HermesChatState = { busy: false, startedAt: 0, finishedAt: 0, outcome: 'done', steps: [] };
let state = initial;
const listeners = new Set<() => void>();
export const hermesChat = {
  getSnapshot: () => state,
  getServerSnapshot: () => initial,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  update(patch: Partial<HermesChatState>) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  },
  reset() {
    state = initial;
    listeners.forEach(listener => listener());
  },
};

export function requestHermesSend(text: string) {
  window.dispatchEvent(new CustomEvent('hermes:send', { detail: { text } }));
}
export function requestHermesStop() {
  window.dispatchEvent(new Event('hermes:stop'));
}

import { useEffect, useRef, useReducer } from 'react';
import { reduce, type TransitionTable } from './machine';

/** `error` for a failed action, `info` for a completed one. */
export type ToastTone = 'error' | 'info';

export interface ToastProps {
  /** Text shown in the toast. A new message queues behind the one on screen. */
  message: string;
  /** Drives both the colour and the assistive role. */
  tone?: ToastTone;
  /** How long the toast stays fully visible before it starts to fade. */
  timeoutMs?: number;
  /** Called once the fade-out finished, so the caller can clear its state. */
  onDismiss: () => void;
}

/** Kept in step with the exit animation so the node leaves with the fade. */
const EXIT_MS = 180;

/* ───────────────────────────────────────────────────────────────────────────
   The toast used to be two booleans in one effect: a new message reset the countdown
   and the previous message was never seen at all. With a transition table the states
   are explicit and a message that arrives mid-fade waits its turn instead of being
   swallowed.

     idle ──ENQUEUE──▶ visible ──TIMEOUT──▶ leaving ──EXIT_DONE──▶ idle
                         ▲                                          │
                         └──────────── ENQUEUE while queue non-empty┘
   ─────────────────────────────────────────────────────────────────────────── */

type ToastState = 'idle' | 'visible' | 'leaving';
type ToastEvent = 'ENQUEUE' | 'TIMEOUT' | 'EXIT_DONE';

const states: TransitionTable<ToastState, ToastEvent> = {
  idle: { ENQUEUE: 'visible' },
  visible: { TIMEOUT: 'leaving', ENQUEUE: 'visible' },
  leaving: { EXIT_DONE: 'idle' },
};

/**
 * Centred, self-dismissing message overlay.
 *
 * The layer is a fixed grid over the viewport with `pointer-events: none`, so a
 * message can sit in the middle of the screen without ever stealing a click from
 * the board underneath it. It has no close button: it counts itself down and
 * leaves, so nothing has to be clicked in the middle of a turn.
 *
 * Messages that arrive while one is showing are queued, not dropped: the first runs
 * its full countdown, then the next takes over only after the previous one has faded.
 */
export function Toast({ message, tone = 'error', timeoutMs = 3000, onDismiss }: ToastProps) {
  const [state, dispatch] = useReducer(
    (current: ToastState, event: ToastEvent) => reduce(states, current, event),
    'idle',
  );
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  /* The queue lives outside the machine: the machine decides *when* a message may be
     shown, the queue remembers *what* is waiting. */
  const queue = useRef<{ message: string; tone: ToastTone }[]>([]);
  const showing = useRef<{ message: string; tone: ToastTone } | null>(null);

  useEffect(() => {
    dispatch('ENQUEUE');
    queue.current.push({ message, tone });
  }, [message, tone]);

  /* Take the next message once the machine settles on `visible` with nothing showing. */
  useEffect(() => {
    if (state !== 'visible' || showing.current) return;
    const next = queue.current.shift();
    if (!next) return;
    showing.current = next;
    const timer = window.setTimeout(() => dispatch('TIMEOUT'), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [state, timeoutMs, message, tone]);

  /* The fade has finished: clear the slot, then either leave or start the next one. */
  useEffect(() => {
    if (state !== 'leaving') return;
    const timer = window.setTimeout(() => {
      showing.current = null;
      dismiss.current();
      dispatch('EXIT_DONE');
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const current = showing.current ?? { message, tone };
  const visible = state !== 'idle';

  return (
    <div className="toast-layer">
      <div
        className={`toast toast-${current.tone}${state === 'leaving' ? ' is-leaving' : ''}`}
        role={current.tone === 'error' ? 'alert' : 'status'}
        style={visible ? undefined : { display: 'none' }}
      >
        <p className="toast-message">{current.message}</p>
      </div>
    </div>
  );
}

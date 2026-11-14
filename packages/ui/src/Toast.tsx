import { useEffect, useRef, useState } from 'react';

/** `error` for a failed action, `info` for a completed one. */
export type ToastTone = 'error' | 'info';

export interface ToastProps {
  /** Text shown in the toast. A new message restarts the countdown. */
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

/**
 * Centred, self-dismissing message overlay.
 *
 * The layer is a fixed grid over the viewport with `pointer-events: none`, so a
 * message can sit in the middle of the screen without ever stealing a click from
 * the board underneath it. It has no close button: it counts itself down and
 * leaves, so nothing has to be clicked in the middle of a turn.
 */
export function Toast({ message, tone = 'error', timeoutMs = 3000, onDismiss }: ToastProps) {
  const [leaving, setLeaving] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    setLeaving(false);
    const timer = window.setTimeout(() => setLeaving(true), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [message, tone, timeoutMs]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => dismiss.current(), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div className="toast-layer">
      <div
        className={`toast toast-${tone}${leaving ? ' is-leaving' : ''}`}
        role={tone === 'error' ? 'alert' : 'status'}
      >
        <p className="toast-message">{message}</p>
      </div>
    </div>
  );
}

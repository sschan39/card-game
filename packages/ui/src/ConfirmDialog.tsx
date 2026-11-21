import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface Confirmation {
  title: string;
  message: string;
  confirmLabel: string;
}

/** The caller can await a decision. Dismissing or leaving the page cancels it. */
export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const finish = useCallback((confirmed: boolean) => {
    const reply = resolve.current;
    resolve.current = null;
    setRequest(null);
    reply?.(confirmed);
  }, []);
  useEffect(() => () => {
    resolve.current?.(false);
    resolve.current = null;
  }, []);
  const confirm = useCallback((confirmation: Confirmation) => {
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>(reply => {
      resolve.current = reply;
      setRequest(confirmation);
    });
  }, []);
  return { confirm, dialog: request && <ConfirmDialog request={request} finish={finish} /> };
}

function ConfirmDialog({ request, finish }: { request: Confirmation; finish: (confirmed: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      if (element?.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return <dialog ref={dialog} className="confirmation-dialog" aria-labelledby={title} aria-describedby={description}
    onCancel={event => { event.preventDefault(); finish(false); }}>
    <h2 id={title}>{request.title}</h2>
    <p id={description}>{request.message}</p>
    <div className="confirmation-actions">
      <button type="button" autoFocus onClick={() => finish(false)}>Cancel</button>
      <button type="button" className="confirmation-primary" onClick={() => finish(true)}>{request.confirmLabel}</button>
    </div>
  </dialog>;
}

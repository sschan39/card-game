import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardView } from '@card-game/protocol';
import CardComponent from '../CardComponent';
import { CardTray } from '../CardTray';

export function PermanentStackPicker({ cards, eligible, label, onClose, renderAction, triggerKey }: {
  cards: CardView[];
  eligible: (card: CardView) => boolean;
  label: (card: CardView) => string;
  onClose: () => void;
  renderAction: (card: CardView) => ReactNode;
  triggerKey: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.querySelector<HTMLElement>('.card-tray-scroll')?.focus({ preventScroll: true });
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || panel.current?.contains(event.target) ||
          event.target.closest('.context-menu-overlay, .card-detail') ||
          event.target.closest<HTMLElement>('[data-stack-picker-trigger]')?.dataset.stackPickerTrigger === triggerKey) return;
      close.current();
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      if (document.activeElement === document.body && opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [triggerKey]);

  return createPortal(
    <section className="card-tray-panel permanent-stack-picker" role="dialog" aria-label={`${cards[0].name} stack`}
      ref={panel} onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) close.current();
      }}>
      <header>
        <h3>{cards[0].name} ×{cards.length}</h3>
        <button type="button" onClick={onClose}>Close stack</button>
      </header>
      <CardTray label="Cards in stack" items={cards.map(card => ({
        id: card.uuid,
        content: <div className="permanent-stack-picker-card">
          <CardComponent card={card} zone="battlefield" />
          <div className="permanent-stack-picker-actions">
            {eligible(card) && <button type="button" aria-label={`Select ${label(card)} on battlefield`}
              onClick={event => event.currentTarget.closest('.permanent-stack-picker-card')?.querySelector<HTMLElement>('.card')?.click()}>
              Select
            </button>}
            {renderAction(card)}
          </div>
        </div>,
      }))} />
    </section>,
    document.body,
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardView } from '@card-game/protocol';
import CardComponent from '../CardComponent';

export function PermanentStackPicker({ cards, eligible, label, onClose, renderAction, triggerKey }: {
  cards: CardView[];
  eligible: (card: CardView) => boolean;
  label: (card: CardView) => string;
  onClose: () => void;
  renderAction: (card: CardView) => ReactNode;
  triggerKey: string;
}) {
  const [selectedId, setSelectedId] = useState(() => (cards.find(eligible) ?? cards[0]).uuid);
  const selected = cards.find(card => card.uuid === selectedId) ?? cards[0];
  const panel = useRef<HTMLElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    select.current?.focus({ preventScroll: true });
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || panel.current?.contains(event.target) ||
          event.target.closest('.context-menu-overlay') ||
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
    <section className="permanent-stack-picker" role="dialog" aria-label={`${cards[0].name} stack`}
      ref={panel} onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) close.current();
      }}>
      <header>
        <label>Card in stack
          <select ref={select} value={selected.uuid} onChange={event => setSelectedId(event.target.value)}>
            {cards.map((card, index) => <option key={card.uuid} value={card.uuid}>{index + 1}. {label(card)}</option>)}
          </select>
        </label>
        <button type="button" onClick={onClose}>Close stack</button>
      </header>
      <div className="permanent-stack-picker-card" ref={face}>
        <CardComponent card={selected} zone="battlefield" />
      </div>
      <div className="permanent-stack-picker-actions">
        {eligible(selected) && <button type="button"
          onClick={() => face.current?.querySelector<HTMLElement>('.card')?.click()}>Select on battlefield</button>}
        {renderAction(selected)}
      </div>
    </section>,
    document.body,
  );
}

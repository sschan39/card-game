import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../store/gameStore';
import type { CardObservationView } from '@card-game/protocol';
import { CardTray } from './CardTray';
import { MatchCardFace } from './MatchCardFace';

function Observation({ view }: { view: CardObservationView }) {
  const [open, setOpen] = useState(false);
  const visible = view.cards ?? [];
  const title = `Observed cards · Turn ${view.turnNumber}`;
  return (
    <div className="card-observation">
      <p>
        Turn {view.turnNumber}
        {view.count !== undefined ? ` · ${view.count} disclosed cards` : ''}
        {view.ordered ? ' · captured top to bottom' : ' · source order hidden'}
      </p>
      {visible.length > 0 && <button type="button" onClick={() => setOpen(true)} aria-expanded={open}>View cards</button>}
      {open && visible.length > 0 && createPortal(
        <section className="card-tray-panel observation-tray" role="dialog" aria-label={title}
          onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.contains(event.target as Node)) setOpen(false); }}>
          <header><h3>{title}</h3><button type="button" autoFocus onClick={() => setOpen(false)}>Close</button></header>
          <CardTray label={view.ordered ? 'Cards in revealed order' : 'Visible cards'} items={visible.map(card => ({
            id: card.id, content: <MatchCardFace card={card} />,
          }))} />
        </section>, document.body)}
    </div>
  );
}

export default function CardObservations() {
  const active = useGameStore((state) => state.room?.observations?.active);
  const locks = useGameStore((state) => state.room?.publicNameLocks);
  const viewerId = useGameStore((state) => state.myPlayerId);
  const hosted = useGameStore(state => state.room?.hostedCards);
  const battlefield = useGameStore(state => state.room?.battlefield);
  if (!active?.length && !locks?.length && !hosted?.length) return null;
  return (
    <section className="card-observations" aria-label="Card information">
      {!!hosted?.length && (
        <div>
          <h3>Stored cards</h3>
          {hosted.map(group => {
            const host = battlefield?.find(card => card.uuid === group.hostUuid && (card.state.zoneRevision ?? 0) === group.hostRevision);
            return (
              <div className="card-observation" key={JSON.stringify([group.hostUuid, group.hostRevision])}>
                <p>{host?.label ?? 'Departed host'}</p>
                <CardTray label="Stored cards" items={group.cards.map(card => ({
                  id: card.uuid, content: <MatchCardFace card={card} />,
                }))} />
              </div>
            );
          })}
        </div>
      )}
      {locks?.map(lock => (
        <p key={JSON.stringify([lock.playerId, lock.name])}>
          {lock.playerId === viewerId ? 'You cannot use' : 'Your opponent cannot use'} {lock.name} until end of turn.
        </p>
      ))}
      {!!active?.length && (
        <div>
          <h3>Observed cards</h3>
          <p>Snapshots from this effect. Cards remain in their actual zones.</p>
          {active.map((view) => (
            <Observation key={view.id} view={view} />
          ))}
        </div>
      )}
    </section>
  );
}

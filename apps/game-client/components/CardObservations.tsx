import { useGameStore } from '../store/gameStore';
import type { CardObservationView, CardView } from '@card-game/protocol';

function CardDetails({ card }: { card: Pick<CardView, 'name' | 'cardTypes' | 'subTypes' | 'power' | 'toughness' | 'rulesText'> }) {
  return (
    <details>
      <summary>{card.name}</summary>
      <p>
        {[...card.cardTypes, ...card.subTypes].join(' · ')}
        {card.power !== undefined && card.toughness !== undefined ? ` · ${card.power}/${card.toughness}` : ''}
      </p>
      <p>{card.rulesText}</p>
    </details>
  );
}

function Observation({ view }: { view: CardObservationView }) {
  return (
    <div className="card-observation">
      <p>
        Turn {view.turnNumber}
        {view.count !== undefined ? ` · ${view.count} disclosed cards` : ''}
        {view.ordered ? ' · captured top to bottom' : ' · source order hidden'}
      </p>
      {view.cards?.map(card => <CardDetails key={card.id} card={card} />)}
    </div>
  );
}

export default function CardObservations() {
  const observations = useGameStore((state) => state.room?.observations);
  const locks = useGameStore((state) => state.room?.publicNameLocks);
  const viewerId = useGameStore((state) => state.myPlayerId);
  const hosted = useGameStore(state => state.room?.hostedCards);
  const battlefield = useGameStore(state => state.room?.battlefield);
  if (!observations?.active.length && !observations?.history.length && !locks?.length && !hosted?.length) return null;
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
                {group.cards.map(card => <CardDetails key={card.uuid} card={card} />)}
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
      {!!observations?.active.length && (
        <div>
          <h3>Observed cards</h3>
          <p>Snapshots from this effect. Cards remain in their actual zones.</p>
          {observations.active.map((view) => (
            <Observation key={view.id} view={view} />
          ))}
        </div>
      )}
      {!!observations?.history.length && (
        <details>
          <summary>Observation history</summary>
          <p>Previously seen cards, recorded at the time of observation.</p>
          {observations.history.map((view) => (
            <Observation key={view.id} view={view} />
          ))}
        </details>
      )}
    </section>
  );
}

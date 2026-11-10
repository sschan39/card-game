import { useGameStore } from '../store/gameStore';
import type { CardObservationView } from '@card-game/protocol';

function Observation({ view }: { view: CardObservationView }) {
  return (
    <div className="card-observation">
      <p>
        Turn {view.turnNumber}
        {view.count !== undefined ? ` · ${view.count} disclosed cards` : ''}
        {view.ordered ? ' · captured top to bottom' : ' · source order hidden'}
      </p>
      {view.cards?.map((card) => (
        <details key={card.id}>
          <summary>{card.name}</summary>
          <p>
            {[...card.cardTypes, ...card.subTypes].join(' · ')}
            {card.power !== undefined && card.toughness !== undefined ? ` · ${card.power}/${card.toughness}` : ''}
          </p>
          <p>{card.rulesText}</p>
        </details>
      ))}
    </div>
  );
}

export default function CardObservations() {
  const observations = useGameStore((state) => state.room?.observations);
  const locks = useGameStore((state) => state.room?.publicNameLocks);
  const viewerId = useGameStore((state) => state.myPlayerId);
  if (!observations?.active.length && !observations?.history.length && !locks?.length) return null;
  return (
    <section className="card-observations" aria-label="Observed cards">
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

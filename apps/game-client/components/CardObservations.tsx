import { useGameStore } from '../store/gameStore';
import type { CardObservationView, CardView } from '@card-game/protocol';
import { cardTypeLine, useT } from '@card-game/ui';

function CardDetails({ card }: { card: Pick<CardView, 'name' | 'cardTypes' | 'subTypes' | 'power' | 'toughness' | 'rulesText'> }) {
  const t = useT();
  return (
    <details>
      <summary>{card.name}</summary>
      <p>
        {cardTypeLine(card.cardTypes, card.subTypes, t)}
        {card.power !== undefined && card.toughness !== undefined ? ` · ${card.power}/${card.toughness}` : ''}
      </p>
      <p>{card.rulesText}</p>
    </details>
  );
}

function Observation({ view }: { view: CardObservationView }) {
  const t = useT();
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
  const t = useT();
  const observations = useGameStore((state) => state.room?.observations);
  const locks = useGameStore((state) => state.room?.publicNameLocks);
  const viewerId = useGameStore((state) => state.myPlayerId);
  const hosted = useGameStore(state => state.room?.hostedCards);
  const battlefield = useGameStore(state => state.room?.battlefield);
  if (!observations?.active.length && !observations?.history.length && !locks?.length && !hosted?.length) return null;
  return (
    <section className="card-observations" aria-label={t('board.cardInformation')}>
      {!!hosted?.length && (
        <div>
          <h3>{t('board.storedCards')}</h3>
          {hosted.map(group => {
            const host = battlefield?.find(card => card.uuid === group.hostUuid && (card.state.zoneRevision ?? 0) === group.hostRevision);
            return (
              <div className="card-observation" key={JSON.stringify([group.hostUuid, group.hostRevision])}>
                <p>{host?.label ?? t('board.departedHost')}</p>
                {group.cards.map(card => <CardDetails key={card.uuid} card={card} />)}
              </div>
            );
          })}
        </div>
      )}
      {locks?.map(lock => (
        <p key={JSON.stringify([lock.playerId, lock.name])}>
          {lock.playerId === viewerId ? t('board.cannotUse', { name: lock.name }) : t('board.opponentCannotUse', { name: lock.name })}
        </p>
      ))}
      {!!observations?.active.length && (
        <div>
          <h3>{t('board.observedCards')}</h3>
          <p>{t('board.observedHint')}</p>
          {observations.active.map((view) => (
            <Observation key={view.id} view={view} />
          ))}
        </div>
      )}
      {!!observations?.history.length && (
        <details>
          <summary>{t('board.observationHistory')}</summary>
          <p>{t('board.observationHistoryHint')}</p>
          {observations.history.map((view) => (
            <Observation key={view.id} view={view} />
          ))}
        </details>
      )}
    </section>
  );
}

import type { PendingChoice } from '@shared/choice.types';
import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '@shared/action.ids';
import { battlefieldCardLabel } from '../card-label';
import type { DamageRecipient } from '@shared/damage.types';

interface ChoiceFormProps {
  choice: PendingChoice;
  selected: string[];
  allocations: Record<string, number>;
  onSelection: (id: string) => void;
  onAllocation: (id: string, amount: number) => void;
  onAnswer: (data: Record<string, unknown>) => void;
  numberText?: string;
  onNumber?: (value: string) => void;
}
export function ChoiceForm({ choice, selected, allocations, onSelection, onAllocation, onAnswer, numberText = '', onNumber }: ChoiceFormProps) {
  if (choice.kind === 'number') {
    const number = Number(numberText);
    const valid = numberText.trim() !== '' && Number.isSafeInteger(number) && number >= choice.range.min && (choice.range.max === undefined || number <= choice.range.max);
    return <section className="choice-panel" role="dialog" aria-label={choice.prompt}>
      <h3>{choice.prompt}</h3>
      <p>Range: {choice.range.max === undefined ? `${choice.range.min} or more` : `${choice.range.min}–${choice.range.max}`}</p>
      <input aria-label={choice.prompt} type="number" step={1} min={choice.range.min} max={choice.range.max} value={numberText} onChange={event => onNumber?.(event.target.value)} />
      <button data-action="confirm" disabled={!valid} onClick={() => onAnswer({ choiceId: choice.id, number })}>Confirm</button>
      <button onClick={() => onAnswer({ choiceId: choice.id, cancel: true })}>Cancel</button>
    </section>;
  }
  const allocating = choice.kind === 'distribution' || choice.kind === 'payment';
  const total = Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
  const valid = allocating ? total === choice.total && Object.entries(allocations).every(([id, amount]) =>
    Number.isSafeInteger(amount) && amount >= 0 && choice.options.some(option => option.id === id && amount <= (option.limit ?? Infinity))) && choice.options.every(option => (allocations[option.id] ?? 0) >= (choice.minimumPerOption ?? 0))
    : selected.length >= choice.min && selected.length <= choice.max;
  return <section className="choice-panel" role="dialog" aria-label={choice.prompt}>
    <h3>{choice.prompt}</h3>
    <p>{allocating ? `Allocate ${choice.total} (${total} selected)` : choice.kind === 'ordering' ? 'Select items in the desired order' : `Choose ${choice.min === choice.max ? choice.min : `${choice.min}–${choice.max}`}.`}</p>
    <div className="choice-options">
      {choice.options.map(option => allocating ? <label key={option.id}>{option.label}
        <input aria-label={option.label} type="number" min={choice.minimumPerOption ?? 0} max={option.limit ?? choice.total} step={1} value={allocations[option.id] ?? 0}
          onChange={event => onAllocation(option.id, Number(event.target.value))} />
      </label> : <button key={option.id} aria-pressed={selected.includes(option.id)} onClick={() => onSelection(option.id)}>
        {choice.kind === 'ordering' && selected.includes(option.id) ? `${selected.indexOf(option.id) + 1}. ` : ''}{option.label}
      </button>)}
    </div>
    <button data-action="confirm" disabled={!valid} onClick={() => onAnswer({ choiceId: choice.id, ...(allocating ? { allocations } : { choices: selected }) })}>Confirm</button>
    {choice.continuation.type === 'action' && <button onClick={() => onAnswer({ choiceId: choice.id, cancel: true })}>Cancel</button>}
  </section>;
}

function OwnedChoice({ choice }: { choice: PendingChoice }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [numberText, setNumberText] = useState('');
  const { playerAction } = useGameActions();
  const room = useGameStore(state => state.room);
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const displayedChoice = room && choice.kind !== 'number' && choice.continuation.type === 'combat' ? {
    ...choice,
    options: choice.options.map(option => {
      const recipient = option.value as DamageRecipient;
      const card = recipient.kind === 'permanent' ? room.battlefield.find(card => card.uuid === recipient.cardUuid && (card.state.zoneRevision ?? 0) === recipient.zoneRevision) : undefined;
      return { ...option, label: recipient.kind === 'player' ? recipient.playerId === myPlayerId ? 'You' : 'Opponent'
        : card ? battlefieldCardLabel(room, card) : option.label };
    }),
  } : choice;
  const data = choice.continuation.type === 'action' ? choice.continuation.data : undefined;
  const source = room && data?.cardUuid ? [...Object.values(room.players).flatMap(player => player.hand), ...room.battlefield].find(card => card.uuid === data.cardUuid) : undefined;
  const bindings = data?.numericBindings as Record<string, number> | undefined;
  const combatSourceUuid = choice.continuation.type === 'combat' ? choice.continuation.sourceUuid : undefined;
  const combatSource = room?.battlefield.find(card => card.uuid === combatSourceUuid);
  return <>{combatSource && <p>Damage source: {battlefieldCardLabel(room!, combatSource)}</p>}{source && <p>{source.blueprint.name}{Object.entries(bindings ?? {}).map(([name, number]) => ` · ${name}: ${number}`).join('')}</p>}<ChoiceForm choice={displayedChoice} selected={selected} allocations={allocations}
    numberText={numberText} onNumber={setNumberText}
    onSelection={id => setSelected(previous => choice.kind === 'number' ? previous : previous.includes(id) ? previous.filter(value => value !== id)
      : choice.max === 1 ? [id] : previous.length < choice.max ? [...previous, id] : previous)}
    onAllocation={(id, amount) => setAllocations(previous => ({ ...previous, [id]: amount }))}
    onAnswer={data => playerAction(ACTION_IDS.choose, undefined, undefined, data)} /></>;
}

export default function ChoicePanel() {
  const choice = useGameStore(state => state.room?.pendingChoice);
  const playerId = useGameStore(state => state.myPlayerId);
  if (!choice) return null;
  if (choice.playerId !== playerId) return <p role="status">Waiting for the other player's choice…</p>;
  return <OwnedChoice key={choice.id} choice={choice} />;
}

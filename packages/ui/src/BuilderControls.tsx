import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';

function QuantityInput({ label, quantity, disabled, onQuantity }: {
    label: string; quantity: number; disabled?: boolean; onQuantity: (quantity: number) => string | null;
}) {
    const [text, setText] = useState(String(quantity)), [error, setError] = useState<string | null>(null);
    const errorId = useId();
    useEffect(() => { setText(String(quantity)); setError(null); }, [quantity]);
    const commit = () => {
        if (disabled) return;
        if (!/^\d+$/.test(text.trim())) { setError('Enter a whole number of zero or more.'); return; }
        const issue = onQuantity(Number(text));
        setError(issue);
        if (!issue) setText(String(Number(text)));
    };
    return <span className="quantity-field">
        <input aria-label={'Quantity of ' + label} inputMode="numeric" value={text} disabled={disabled}
            aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
            onChange={event => { setText(event.target.value); setError(null); }} onBlur={commit}
            onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); commit(); }
                if (event.key === 'Escape') { event.preventDefault(); setText(String(quantity)); setError(null); }
            }} />
        {error && <span id={errorId} role="alert" className="quantity-error">{error}</span>}
    </span>;
}
export function CardCountControls({ label, quantity, disabled, onChange, canAdd = true, onQuantity }: {
    label: string;
    quantity: number;
    disabled?: boolean;
    canAdd?: boolean;
    onChange: (delta: number) => void;
    onQuantity?: (quantity: number) => string | null;
}) { return <span className="card-count-controls"><button type="button" aria-label={'Remove one ' + label} disabled={disabled || quantity === 0} onClick={() => onChange(-1)}>−</button>{onQuantity ? <QuantityInput label={label} quantity={quantity} disabled={disabled} onQuantity={onQuantity} /> : <span>{quantity}</span>}<button type="button" aria-label={'Add one ' + label} disabled={disabled || !canAdd} onClick={() => onChange(1)}>+</button></span>; }
export function CatalogTile({ children, id, description, action, onClick, index, selected = false, count }: {
    children: ReactNode;
    id?: string;
    description: string;
    action: ReactNode;
    /** Fired for the tile surface; callers are expected to ignore clicks that landed on a control. */
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    /** Position in the grid; the entrance stagger uses it as a delay slot. */
    index?: number;
    /** True when the card already sits in the draft: shows the green tick badge. */
    selected?: boolean;
    /** Copies of the card when previewing a saved deck: shows a "xN" badge. */
    count?: number;
}) { return <article onClick={onClick} style={index === undefined ? undefined : ({ '--i': index } as CSSProperties)}>
    {selected && <span className="tile-selected" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 9.5 17 19 7" /></svg>
    </span>}
    {count !== undefined && <span className="tile-count" aria-hidden="true">×{count}</span>}
    {children}{id && <p className="card-id">{id}</p>}<p className="card-description">{description}</p>{action}
</article>; }
export function BuilderTransfer({ text, onText, onImport, onExport, disabled, label = 'Fixture JSON', importLabel = 'Import', exportLabel = 'Export', maxLength = 65536 }: {
    text: string;
    onText: (text: string) => void;
    onImport: () => void;
    onExport: () => void;
    disabled?: boolean;
    label?: string;
    importLabel?: string;
    exportLabel?: string;
    maxLength?: number;
}) { return <section aria-label="Import and export"><label>{label}<textarea rows={7} maxLength={maxLength} value={text} disabled={disabled} onChange={e => onText(e.target.value)}/></label><button disabled={disabled || !text.trim()} onClick={onImport}>{importLabel}</button><button disabled={disabled} onClick={onExport}>{exportLabel}</button></section>; }

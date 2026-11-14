import type { CSSProperties, MouseEvent, ReactNode } from 'react';
export function CardCountControls({ label, quantity, disabled, onChange, canAdd = true }: {
    label: string;
    quantity: number;
    disabled?: boolean;
    canAdd?: boolean;
    onChange: (delta: number) => void;
}) { return <span className="card-count-controls"><button type="button" aria-label={'Remove one ' + label} disabled={disabled || quantity === 0} onClick={() => onChange(-1)}>−</button><span>{quantity}</span><button type="button" aria-label={'Add one ' + label} disabled={disabled || !canAdd} onClick={() => onChange(1)}>+</button></span>; }
export function CatalogTile({ children, id, description, action, onClick, index }: {
    children: ReactNode;
    id: string;
    description: string;
    action: ReactNode;
    /** Fired for the tile surface; callers are expected to ignore clicks that landed on a control. */
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    /** Position in the grid; the entrance stagger uses it as a delay slot. */
    index?: number;
}) { return <article onClick={onClick} style={index === undefined ? undefined : ({ '--i': index } as CSSProperties)}>{children}<p className="card-id">{id}</p><p className="card-description">{description}</p>{action}</article>; }
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

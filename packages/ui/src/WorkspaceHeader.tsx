import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import registry from './config/navigation.json';
import { fadeThenNavigate, usePageLeaveReset } from './page-transition';
export interface WorkspaceLink { id: string; label: string; href: string; adminOnly?: boolean }
export interface WorkspaceNavigation {
  instanceId: string; purpose: 'development' | 'live' | 'lab'; label: string;
  home: string; play: string; decks: string; admin: string | null; lab: string | null;
  extraPages?: Array<{ id: string; label: string; workspace: string; href: string; adminOnly: boolean }>;
}
/** Public destinations only. App adapters own authentication and route actions. */
export function workspaceLinks(navigation: WorkspaceNavigation, isAdmin: boolean): WorkspaceLink[] {
  return registry.filter(item => !item.adminOnly || isAdmin).flatMap(item => {
    if (!['home', 'play', 'decks', 'admin'].includes(item.destination)) throw new Error('Invalid workspace registry.');
    const href = navigation[item.destination as 'home' | 'play' | 'decks' | 'admin'];
    return href ? [{ id: item.id, label: item.label, href, adminOnly: item.adminOnly }] : [];
  });
}
/**
 * Account menu as an overlay.
 *
 * The panel is absolutely positioned by `.workspace-account-panel`, so opening it
 * never changes the height of the sticky header and never pushes the page down.
 * Closing on an outside pointer or Escape keeps it from hovering over the board
 * after the player has moved on.
 */
/**
 * Room code as a button.
 *
 * The code itself is noise on screen — players only ever need to hand it to someone.
 * Copying it and flashing "Copied" is the whole job, so no room code is printed.
 */
function CopyRoomId({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      return;
    } catch {
      // Clipboard API can be refused (focus, permissions, policy): fall back below.
    }
    const field = document.createElement('textarea');
    field.value = roomId;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    document.body.removeChild(field);
    setCopied(copied);
  };
  return <button type="button" className="workspace-copy-room" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy room ID'}</button>;
}
export function WorkspaceHeader({ navigation, current, account, activeRoomId, breadcrumb, accountMenu, scenariosAvailable = false }: {
  navigation: WorkspaceNavigation | null; current: string; account: { username: string; role: string } | null;
  activeRoomId?: string | null; breadcrumb?: string; accountMenu?: ReactNode; scenariosAvailable?: boolean;
}) {
  const accountRef = useRef<HTMLDetailsElement>(null);
  /* A document restored from the back/forward cache must not stay at opacity 0. */
  usePageLeaveReset();
  /* Tab clicks fade the current page out before the browser loads the next one.
     Modified clicks and new-tab links return false, so the browser keeps them. */
  const navigate = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.currentTarget.target === '_blank') return;
    if (fadeThenNavigate(href, event)) event.preventDefault();
  };
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const element = accountRef.current;
      if (!element?.open || (event.target instanceof Node && element.contains(event.target))) return;
      element.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const element = accountRef.current;
      if (event.key !== 'Escape' || !element?.open) return;
      element.open = false;
      element.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  return <header className="workspace-header">
    <div className="workspace-brand"><strong>Card Game</strong><span className={'environment environment-' + (navigation?.purpose ?? 'unknown')}>{navigation ? navigation.label : 'Environment unavailable'}</span></div>
    <nav aria-label="Workspaces">{navigation && workspaceLinks(navigation, account?.role === 'admin').map(link => <a key={link.id} href={link.href} aria-current={current === link.id ? 'page' : undefined} onClick={navigate(link.href)}
      {...(activeRoomId ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{link.label}</a>)}</nav>
    {!!navigation?.extraPages?.some(page => page.workspace === current && (!page.adminOnly || account?.role === 'admin')) && <nav className="workspace-pages" aria-label="Workspace pages">{navigation.extraPages.filter(page => page.workspace === current && (!page.adminOnly || account?.role === 'admin')).map(page => <a key={page.id} href={page.href} onClick={navigate(page.href)} {...(activeRoomId ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{page.label}</a>)}</nav>}
    <div className="workspace-context"><span>{breadcrumb ?? current}</span>{activeRoomId && <CopyRoomId roomId={activeRoomId} />}
      <details className="workspace-account" ref={accountRef}>
        <summary>
          <span className="workspace-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
            </svg>
          </span>
          {account?.username ?? 'Guest'}
        </summary>
        <div className="workspace-account-panel">
          <div className="account-card">
            <span className="workspace-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="12" cy="8.5" r="3.5" />
                <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
              </svg>
            </span>
            <p className="account-card-name">{account?.username ?? 'Guest'}</p>
          </div>
          {accountMenu ?? <p>Use this workspace's account controls below.</p>}
        </div>
      </details>
      {account?.role === 'admin' && <span className="lab-unavailable">{scenariosAvailable && (navigation?.lab || navigation?.admin) ? <a href={navigation.lab ?? navigation.admin ?? undefined} target="_blank" rel="noopener noreferrer">Test Lab — scenarios enabled</a> : 'Test Lab — unavailable'}</span>}
    </div>
  </header>;
}

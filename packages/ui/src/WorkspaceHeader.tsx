import type { ReactNode } from 'react';
import registry from './config/navigation.json';
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
export function WorkspaceHeader({ navigation, current, account, activeRoomId, breadcrumb, accountMenu }: {
  navigation: WorkspaceNavigation | null; current: string; account: { username: string; role: string } | null;
  activeRoomId?: string | null; breadcrumb?: string; accountMenu?: ReactNode;
}) {
  return <header className="workspace-header">
    <div className="workspace-brand"><strong>Card Game</strong><span className={'environment environment-' + (navigation?.purpose ?? 'unknown')}>{navigation ? navigation.label + ' · ' + navigation.purpose : 'Environment unavailable'}</span></div>
    <nav aria-label="Workspaces">{navigation && workspaceLinks(navigation, account?.role === 'admin').map(link => <a key={link.id} href={link.href} aria-current={current === link.id ? 'page' : undefined}
      {...(activeRoomId ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{link.label}{activeRoomId ? ' ↗' : ''}</a>)}</nav>
    {!!navigation?.extraPages?.some(page => page.workspace === current && (!page.adminOnly || account?.role === 'admin')) && <nav className="workspace-pages" aria-label="Workspace pages">{navigation.extraPages.filter(page => page.workspace === current && (!page.adminOnly || account?.role === 'admin')).map(page => <a key={page.id} href={page.href} {...(activeRoomId ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{page.label}</a>)}</nav>}
    <div className="workspace-context"><span>{breadcrumb ?? current}</span>{activeRoomId && <span>Active room: {activeRoomId}</span>}<details className="workspace-account"><summary>{account?.username ?? 'Guest'}</summary>{accountMenu ?? <p>Use this workspace's account controls below.</p>}</details>
      {account?.role === 'admin' && <span className="lab-unavailable" title="Scenario tools arrive in Milestone 7.">Test Lab — unavailable</span>}
    </div>
  </header>;
}

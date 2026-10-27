export const adminRoutes = ['rooms', 'logs', 'accounts', 'config'] as const;
export type AdminRoute = typeof adminRoutes[number];
export function resolveRoute(hash: string): AdminRoute {
  const value = hash.replace(/^#\/?/, ''); return adminRoutes.includes(value as AdminRoute) ? value as AdminRoute : 'rooms';
}

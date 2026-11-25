/** Check normalized instructions after the content provider has loaded its token catalog. */
export function validateTokenReferences(value: unknown, hasToken: (id: string) => boolean, path: string): void {
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.action === 'CREATE_TOKEN') {
    const id = (record.params as { tokenId: string }).tokenId;
    if (!hasToken(id)) throw new Error(`${path}.params.tokenId: Unknown token definition '${id}'`);
  }
  for (const [key, child] of Object.entries(record)) validateTokenReferences(child, hasToken, `${path}.${key}`);
}

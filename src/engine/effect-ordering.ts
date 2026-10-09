/** Select a prerequisite component, ignoring only edges within a dependency cycle. */
export function nextEffectIndex<T>(ordered: T[], dependsOn: (effect: T, prerequisite: T) => boolean): number {
  const edges = ordered.map((effect, index) => ordered.flatMap((other, j) => index !== j && dependsOn(effect, other) ? [j] : []));
  const indices = new Map<number, number>(), low = new Map<number, number>();
  const stack: number[] = [], onStack = new Set<number>(), components: number[][] = [];
  let sequence = 0;
  function visit(node: number) {
    indices.set(node, sequence); low.set(node, sequence++); stack.push(node); onStack.add(node);
    for (const other of edges[node]) {
      if (!indices.has(other)) { visit(other); low.set(node, Math.min(low.get(node)!, low.get(other)!)); }
      else if (onStack.has(other)) low.set(node, Math.min(low.get(node)!, indices.get(other)!));
    }
    if (low.get(node) === indices.get(node)) {
      const component: number[] = [];
      let member: number;
      do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== node);
      components.push(component);
    }
  }
  ordered.forEach((_, i) => { if (!indices.has(i)) visit(i); });
  const eligible = components.filter(group => {
    const members = new Set(group);
    return group.every(node => edges[node].every(other => members.has(other)));
  });
  return Math.min(...eligible.flat());
}

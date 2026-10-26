/** Compact metadata shared by frontend sends and backend receipts. */
export function choiceAnswerDetails(data?: Record<string, unknown>) {
  const allocations = data?.allocations;
  return {
    number: data?.number,
    selected: Array.isArray(data?.choices) ? data.choices.length : undefined,
    attackers: Array.isArray(data?.attackers) ? data.attackers : undefined,
    assignments: Array.isArray(data?.assignments) ? data.assignments : undefined,
    allocationChoices: allocations && typeof allocations === 'object'
      ? Object.entries(allocations).filter(([, amount]) => typeof amount === 'number' && amount > 0).map(([id, amount]) => ({ id, amount })) : undefined,
    allocationTotal: allocations && typeof allocations === 'object'
      ? Object.values(allocations).reduce<number>((sum, amount) => sum + (typeof amount === 'number' ? amount : 0), 0) : undefined,
  };
}

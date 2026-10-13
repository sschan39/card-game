/** Compact metadata shared by frontend sends and backend receipts. */
export function choiceAnswerDetails(data?: Record<string, unknown>) {
  const allocations = data?.allocations;
  return {
    number: data?.number,
    selected: Array.isArray(data?.choices) ? data.choices.length : undefined,
    allocationTotal: allocations && typeof allocations === 'object'
      ? Object.values(allocations).reduce<number>((sum, amount) => sum + (typeof amount === 'number' ? amount : 0), 0) : undefined,
  };
}

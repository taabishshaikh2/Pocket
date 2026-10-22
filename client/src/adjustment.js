export function adjustmentTotal(current, change, operation) {
  if (change === '' || !['add', 'subtract'].includes(operation)) return null;
  const amount = Number(change);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) return null;
  return (Math.round(current * 100) + (operation === 'add' ? 1 : -1) * Math.round(amount * 100)) / 100;
}

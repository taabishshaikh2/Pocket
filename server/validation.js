import { z } from 'zod';
export const categories = {
  expense: ['Food & groceries', 'Rent & home', 'Shopping', 'Transport', 'Bills & utilities', 'Health', 'Entertainment', 'Other'],
  investment: ['Mutual funds', 'Stocks', 'Fixed deposit', 'Gold', 'Retirement', 'Other'],
};
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');
const amount = z.number().finite().min(0).max(1_000_000_000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, 'Use at most two decimal places.');
export const salarySchema = z.object({ salary: amount, received: dateSchema }).strict();
export const tripSchema = z.object({
  name: z.string().trim().min(1).max(80),
  budget: amount.refine(n => n > 0, 'Set a budget greater than zero.'),
  saved: amount,
  targetDate: z.union([dateSchema, z.literal('')]),
}).strict();
export const contributionSchema = z.object({ amount: amount.refine(n => n > 0, 'Add an amount greater than zero.') }).strict();
export const entrySchema = z.object({
  name: z.string().trim().min(1).max(80), amount: amount.refine(n => n > 0, 'Amount must be greater than zero.'),
  type: z.enum(['expense', 'investment']), date: dateSchema, category: z.string(),
}).strict().refine(e => categories[e.type].includes(e.category), 'Choose a valid category.');
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12, 'Use at least 12 characters.').max(72),
}).strict().refine(v => Buffer.byteLength(v.password, 'utf8') <= 72, 'Password must fit within 72 UTF-8 bytes.');
export const importSchema = z.record(monthSchema, z.object({
  salary: amount, received: z.union([dateSchema, z.literal('')]),
  entries: z.array(z.object({ id: z.string().min(1).max(100), ...entrySchema.shape }).strict()).max(10000),
}).strict()).refine(data => Object.entries(data).every(([month, m]) =>
  (!m.received || m.received.startsWith(month)) && (m.salary === 0 || m.received) &&
  m.entries.every(e => e.date.startsWith(month) && categories[e.type].includes(e.category)) &&
  new Set(m.entries.map(e => e.id)).size === m.entries.length
), 'Imported dates, categories, or transaction IDs are invalid.');
export function assertMonthDate(month, date) {
  if (!date.startsWith(month)) { const error = new Error('Date must be within the selected month.'); error.status = 400; throw error; }
}
export const cents = n => Math.round(n * 100);
export function summarize(month) {
  const expense = month.entries.filter(e => e.type === 'expense').reduce((n, e) => n + cents(e.amount), 0);
  const investment = month.entries.filter(e => e.type === 'investment').reduce((n, e) => n + cents(e.amount), 0);
  return { expenses: expense / 100, investments: investment / 100, remaining: (cents(month.salary) - expense - investment) / 100 };
}

import { Category, User } from './models.js';
import { categories } from './validation.js';
export async function seedCategories() {
  const records = Object.entries(categories).flatMap(([type, labels]) => labels.map((label, order) => ({
    _id: `${type}-default-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    type, label, labelKey: label.toLowerCase(), active: true, isOther: label === 'Other', previousLabels: [], order,
  })));
  records.push({ _id: 'expense-legacy-rent-home', type: 'expense', label: 'Rent & home', labelKey: 'rent & home', active: false, isOther: false, order: 99 });
  await Category.bulkWrite(records.map(record => ({ updateOne: { filter: { _id: record._id }, update: { $setOnInsert: record }, upsert: true } })));
}
export async function bootstrapAdmin(email) {
  if (!email) return false;
  // Promote an existing account only. Never creates an account or changes a password.
  const result = await User.updateOne({ email: email.trim().toLowerCase() }, { $set: { role: 'admin' } });
  return result.matchedCount > 0;
}
export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export async function resolveCategory(values, previous) {
  const unchanged = previous && previous.type === values.type && (
    values.categoryId ? values.categoryId === previous.categoryId : values.category === previous.category
  );
  if (unchanged) return { ...values, category: previous.category, categoryId: previous.categoryId,
    otherReason: previous.category === 'Other' ? (values.otherReason || '') : '' };
  const filter = { type: values.type, active: true, ...(values.categoryId ? { _id: values.categoryId } : { label: values.category }) };
  const category = await Category.findOne(filter).lean();
  if (!category) fail('Choose an active category. It may have changed; refresh the page.');
  return { ...values, categoryId: category._id, category: category.label, otherReason: category.isOther ? (values.otherReason || '') : '' };
}
export async function validateImportCategories(data) {
  const catalog = await Category.find().lean();
  for (const record of Object.values(data)) for (const entry of record.entries) {
    const match = catalog.find(c => c.type === entry.type && (c.label === entry.category || c.previousLabels?.includes(entry.category)));
    if (!match) fail('Backup contains an unknown category for its transaction type.');
    if (entry.categoryId && entry.categoryId !== match._id) fail('Backup category does not match its ID.');
    entry.categoryId = match._id;
    entry.otherReason = match.isOther ? (entry.otherReason || '') : '';
  }
}

export async function categoryNameTaken(type, label, exceptId) {
  const key = label.toLowerCase();
  const peers = await Category.find({ type }).select('label previousLabels').lean();
  return peers.some(c => c._id !== exceptId && [c.label, ...(c.previousLabels || [])].some(name => name.toLowerCase() === key));
}

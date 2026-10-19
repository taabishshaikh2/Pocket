import mongoose from 'mongoose';
const { Schema } = mongoose;
const userSchema = new Schema({ email: { type: String, required: true, unique: true }, passwordHash: { type: String, required: true }, role: { type: String, enum: ['user', 'admin'], default: 'user' }, disabled: { type: Boolean, default: false } }, { timestamps: true });
const entrySchema = new Schema({
  id: { type: String, required: true }, name: String, amount: Number,
  type: { type: String, enum: ['expense', 'investment'] }, date: String, category: String, categoryId: String, otherReason: { type: String, default: '' },
}, { _id: false });
const monthSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  month: { type: String, required: true }, salary: { type: Number, default: 0 },
  received: { type: String, default: '' }, entries: { type: [entrySchema], default: [] },
}, { timestamps: true });
monthSchema.index({ userId: 1, month: 1 }, { unique: true });
export const User = mongoose.model('User', userSchema);
export const Month = mongoose.model('Month', monthSchema);
const tripSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  budgetCents: { type: Number, required: true, min: 1 },
  savedCents: { type: Number, required: true, min: 0, default: 0 },
  targetDate: { type: String, default: '' },
}, { timestamps: true });
export const Trip = mongoose.model('Trip', tripSchema);

const categorySchema = new Schema({
  _id: String, type: { type: String, enum: ['expense', 'investment'], required: true },
  label: { type: String, required: true }, labelKey: { type: String, required: true },
  active: { type: Boolean, default: true }, isOther: { type: Boolean, default: false },
  previousLabels: { type: [String], default: [] }, order: { type: Number, default: 100 },
}, { timestamps: true });
categorySchema.index({ type: 1, labelKey: 1 }, { unique: true });
export const Category = mongoose.model('Category', categorySchema);
export const Settings = mongoose.model('Settings', new Schema({ _id: String, registrationOpen: { type: Boolean, default: true } }));
export const Audit = mongoose.model('Audit', new Schema({ actorId: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, target: String }, { timestamps: true }));

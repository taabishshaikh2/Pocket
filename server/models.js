import mongoose from 'mongoose';
const { Schema } = mongoose;
const userSchema = new Schema({ email: { type: String, required: true, unique: true }, passwordHash: { type: String, required: true } }, { timestamps: true });
const entrySchema = new Schema({
  id: { type: String, required: true }, name: String, amount: Number,
  type: { type: String, enum: ['expense', 'investment'] }, date: String, category: String,
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

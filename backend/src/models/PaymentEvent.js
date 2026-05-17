import mongoose from 'mongoose';

const paymentEventSchema = new mongoose.Schema(
  {
    razorpayPaymentId: { type: String, required: true, unique: true },
    razorpayOrderId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    plan: { type: String, enum: ['pro', 'elite'], required: true },
    amountPaise: { type: Number },
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const PaymentEvent = mongoose.model('PaymentEvent', paymentEventSchema);

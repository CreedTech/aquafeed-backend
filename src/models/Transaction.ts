import mongoose, { Schema, Document } from 'mongoose';

export type TransactionType = 'credit' | 'debit';
export type TransactionStatus = 'pending' | 'success' | 'failed';

export interface ITransaction extends Document {
    userId: mongoose.Types.ObjectId;

    type: TransactionType;
    amount: number;  // ₦ Naira
    description: string;

    // Payment Integration
    paystackReference?: string;
    status: TransactionStatus;

    // Balance tracking
    balanceAfter: number;

    // Optional metadata
    formulationId?: mongoose.Types.ObjectId;  // If unlocking a formulation

    createdAt: Date;
    updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['credit', 'debit'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    paystackReference: {
        type: String,
        unique: true,
        sparse: true  // Allow null
    },
    status: {
        type: String,
        enum: ['pending', 'success', 'failed'],
        default: 'success',
        index: true
    },
    balanceAfter: {
        type: Number,
        required: true,
        min: 0
    },
    formulationId: {
        type: Schema.Types.ObjectId,
        ref: 'Formulation'
    }
}, {
    timestamps: true
});

// Indexes
TransactionSchema.index({ userId: 1, createdAt: -1 });
// paystackReference index is already defined in the schema path

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);

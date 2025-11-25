import mongoose, { Schema, Document } from 'mongoose';

export type ExpenseCategory =
    | 'Feed'
    | 'Labor'
    | 'Equipment'
    | 'Transport'
    | 'Supplies'
    | 'Marketing'
    | 'Maintenance'
    | 'Utilities'
    | 'Fingerlings'
    | 'Other';

export interface IExpense extends Document {
    userId: mongoose.Types.ObjectId;
    farmId: mongoose.Types.ObjectId;

    category: ExpenseCategory;
    amount: number;  // ₦ Naira
    description: string;
    date: Date;

    receiptUrl?: string;  // Cloudinary URL

    // Auto-linked if from formulation
    formulationId?: mongoose.Types.ObjectId;
    batchId?: mongoose.Types.ObjectId;

    createdAt: Date;
    updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    farmId: {
        type: Schema.Types.ObjectId,
        ref: 'FarmProfile',
        required: true,
        index: true
    },
    category: {
        type: String,
        enum: ['Feed', 'Labor', 'Equipment', 'Transport', 'Supplies', 'Marketing', 'Maintenance', 'Utilities', 'Fingerlings', 'Other'],
        required: true,
        index: true
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
    date: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    receiptUrl: {
        type: String
    },
    formulationId: {
        type: Schema.Types.ObjectId,
        ref: 'Formulation'
    },
    batchId: {
        type: Schema.Types.ObjectId,
        ref: 'Batch'
    }
}, {
    timestamps: true
});

// Indexes for reporting
ExpenseSchema.index({ userId: 1, farmId: 1, date: -1 });
ExpenseSchema.index({ userId: 1, category: 1, date: -1 });

export default mongoose.model<IExpense>('Expense', ExpenseSchema);

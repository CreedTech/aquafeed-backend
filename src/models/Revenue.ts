import mongoose, { Schema, Document } from 'mongoose';

export type RevenueType = 'Fingerling' | 'TableSize' | 'Other';

export interface IRevenue extends Document {
    userId: mongoose.Types.ObjectId;
    farmId: mongoose.Types.ObjectId;

    type: RevenueType;
    quantity: number;     // pieces or kg
    pricePerUnit: number; // ₦/piece or ₦/kg
    totalAmount: number;  // ₦ total
    buyer?: string;
    date: Date;

    batchId?: mongoose.Types.ObjectId;

    createdAt: Date;
    updatedAt: Date;
}

const RevenueSchema = new Schema<IRevenue>({
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
    type: {
        type: String,
        enum: ['Fingerling', 'TableSize', 'Other'],
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 0
    },
    pricePerUnit: {
        type: Number,
        required: true,
        min: 0
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    buyer: {
        type: String,
        trim: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    batchId: {
        type: Schema.Types.ObjectId,
        ref: 'Batch'
    }
}, {
    timestamps: true
});

// Indexes for reporting
RevenueSchema.index({ userId: 1, farmId: 1, date: -1 });
RevenueSchema.index({ userId: 1, type: 1, date: -1 });

// Auto-calculate total amount before save
RevenueSchema.pre('save', function (next) {
    this.totalAmount = this.quantity * this.pricePerUnit;
    next();
});

export default mongoose.model<IRevenue>('Revenue', RevenueSchema);

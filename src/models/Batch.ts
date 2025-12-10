import mongoose, { Schema, Document } from 'mongoose';

export interface IBatch extends Document {
    userId: mongoose.Types.ObjectId;
    farmId: mongoose.Types.ObjectId;
    pondId: number;

    name: string;
    formulationId?: mongoose.Types.ObjectId;  // Linked feed formulation

    startDate: Date;
    currentWeek: number;
    status: 'Active' | 'Harvested';

    initialFishCount: number;
    currentFishCount: number;  // After mortality

    feedingLogs: mongoose.Types.ObjectId[];  // References to DailyLog

    // Performance Metrics
    totalFeedUsedKg: number;
    estimatedFishWeightKg: number;
    fcr: number;  // Feed Conversion Ratio

    createdAt: Date;
    updatedAt: Date;
}

const BatchSchema = new Schema<IBatch>({
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
    pondId: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    formulationId: {
        type: Schema.Types.ObjectId,
        ref: 'Formulation'
    },
    startDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    currentWeek: {
        type: Number,
        default: 1,
        min: 1
    },
    status: {
        type: String,
        enum: ['Active', 'Harvested'],
        default: 'Active',
        index: true
    },
    initialFishCount: {
        type: Number,
        required: true,
        min: 0
    },
    currentFishCount: {
        type: Number,
        required: true,
        min: 0
    },
    feedingLogs: [{
        type: Schema.Types.ObjectId,
        ref: 'DailyLog'
    }],
    totalFeedUsedKg: {
        type: Number,
        default: 0,
        min: 0
    },
    estimatedFishWeightKg: {
        type: Number,
        default: 0,
        min: 0
    },
    fcr: {
        type: Number,
        default: 0,
        min: 0
    }
}, {
    timestamps: true
});

// Indexes
BatchSchema.index({ userId: 1, farmId: 1, status: 1 });
BatchSchema.index({ startDate: -1 });

// Auto-update FCR before save
BatchSchema.pre('save', function (next) {
    if (this.estimatedFishWeightKg > 0) {
        this.fcr = this.totalFeedUsedKg / this.estimatedFishWeightKg;
    } else {
        this.fcr = 0;
    }
    next();
});

export default mongoose.model<IBatch>('Batch', BatchSchema);

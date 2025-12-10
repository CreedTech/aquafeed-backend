import mongoose, { Schema, Document } from 'mongoose';

export interface IDailyLog extends Document {
    userId: mongoose.Types.ObjectId;
    farmId: mongoose.Types.ObjectId;
    batchId: mongoose.Types.ObjectId;

    date: Date;
    weekNumber: number;

    feedGivenKg: number;  // Feed given that day
    mortality: number;     // Fish deaths
    observations?: string;

    // Optional: Water quality parameters
    waterTemp?: number;
    phLevel?: number;
    dissolvedOxygen?: number;

    createdAt: Date;
    updatedAt: Date;
}

const DailyLogSchema = new Schema<IDailyLog>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    farmId: {
        type: Schema.Types.ObjectId,
        ref: 'FarmProfile',
        required: true
    },
    batchId: {
        type: Schema.Types.ObjectId,
        ref: 'Batch',
        required: true,
        index: true
    },
    date: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    weekNumber: {
        type: Number,
        required: true,
        min: 1
    },
    feedGivenKg: {
        type: Number,
        required: true,
        min: 0
    },
    mortality: {
        type: Number,
        default: 0,
        min: 0
    },
    observations: {
        type: String,
        trim: true
    },
    waterTemp: {
        type: Number,
        min: 0,
        max: 50
    },
    phLevel: {
        type: Number,
        min: 0,
        max: 14
    },
    dissolvedOxygen: {
        type: Number,
        min: 0
    }
}, {
    timestamps: true
});

// Compound indexes
DailyLogSchema.index({ batchId: 1, date: -1 });
DailyLogSchema.index({ userId: 1, date: -1 });

// Ensure one log per batch per day
DailyLogSchema.index({ batchId: 1, date: 1 }, { unique: true });

export default mongoose.model<IDailyLog>('DailyLog', DailyLogSchema);

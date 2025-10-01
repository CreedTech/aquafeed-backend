import mongoose, { Schema, Document } from 'mongoose';

export interface INutrientRange {
    min?: number;
    max?: number;
}

export interface ITargetNutrients {
    protein: INutrientRange;
    fat: INutrientRange;
    fiber: INutrientRange;
    ash?: INutrientRange;
    lysine?: INutrientRange;
    methionine?: INutrientRange;
    calcium?: INutrientRange;
    phosphorous?: INutrientRange;
}

export interface IFeedStandard extends Document {
    name: string;
    brand: string;
    pelletSize: string;  // 2mm, 3mm, 4.5mm, etc.
    fishType: 'Catfish' | 'Tilapia' | 'Both';
    stage: 'Starter' | 'Grower' | 'Finisher';
    targetNutrients: ITargetNutrients;
    tolerance: number;  // % deviation allowed (default 6%)
    isDefault: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const NutrientRangeSchema = new Schema({
    min: { type: Number },
    max: { type: Number }
}, { _id: false });

const TargetNutrientsSchema = new Schema<ITargetNutrients>({
    protein: { type: NutrientRangeSchema, required: true },
    fat: { type: NutrientRangeSchema, required: true },
    fiber: { type: NutrientRangeSchema, required: true },
    ash: { type: NutrientRangeSchema },
    lysine: { type: NutrientRangeSchema },
    methionine: { type: NutrientRangeSchema },
    calcium: { type: NutrientRangeSchema },
    phosphorous: { type: NutrientRangeSchema }
}, { _id: false });

const FeedStandardSchema = new Schema<IFeedStandard>({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    brand: {
        type: String,
        required: true,
        index: true
    },
    pelletSize: {
        type: String,
        required: true
    },
    fishType: {
        type: String,
        enum: ['Catfish', 'Tilapia', 'Both'],
        required: true,
        index: true
    },
    stage: {
        type: String,
        enum: ['Starter', 'Grower', 'Finisher'],
        required: true,
        index: true
    },
    targetNutrients: {
        type: TargetNutrientsSchema,
        required: true
    },
    tolerance: {
        type: Number,
        default: 2,   // ±2% tolerance (professor's recommendation)
        min: 0,
        max: 20
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

// Index for query performance
FeedStandardSchema.index({ brand: 1, fishType: 1, stage: 1 });

export default mongoose.model<IFeedStandard>('FeedStandard', FeedStandardSchema);

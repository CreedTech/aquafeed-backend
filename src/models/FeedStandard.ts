import mongoose, { Schema, Document } from 'mongoose';

export interface INutrientRange {
    min: number;
    max: number;
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
    fishType: string;  // Dynamic from Categories
    stage: string;       // Dynamic from Categories
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
        required: true,
        index: true
    },
    stage: {
        type: String,
        required: true,
        index: true
    },
    targetNutrients: {
        type: TargetNutrientsSchema,
        required: true
    },
    tolerance: {
        type: Number,
        default: 6
    },
    isDefault: {
        type: Boolean,
        default: false,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

// Update index prefix for fishType/stage
FeedStandardSchema.index({ fishType: 1, stage: 1, isActive: 1 });

export default mongoose.model<IFeedStandard>('FeedStandard', FeedStandardSchema);

import mongoose, { Schema, Document } from 'mongoose';
import { INutrients } from './Ingredient';

export type ComplianceColor = 'Red' | 'Blue' | 'Green';

export interface IIngredientUsed {
    ingredientId: mongoose.Types.ObjectId;
    name: string;              // Frozen name
    qtyKg: number;
    bags: number;              // Rounded to nearest bag
    priceAtMoment: number;     // Frozen price (₦/kg)
    nutrientsAtMoment: INutrients;  // Frozen nutritional data
}

export interface IAlternativeSuggestion {
    suggestion: string;
    savings: number;  // ₦ savings
}

export interface IFormulation extends Document {
    userId: mongoose.Types.ObjectId;
    farmId?: mongoose.Types.ObjectId;

    // User Input
    batchName: string;
    targetWeightKg: number;
    standardUsed: mongoose.Types.ObjectId;  // Reference to FeedStandard

    // Optimization Result
    totalCost: number;  // ₦ Naira (includes overhead)
    costPerKg: number;
    overheadCost: number;  // ₦ Naira - milling, processing, pelletizing, transport

    // Compliance
    complianceColor: ComplianceColor;
    qualityMatchPercentage: number;  // 0-100%

    // Snapshot of ingredients (FROZEN DATA)
    ingredientsUsed: IIngredientUsed[];

    // Calculated Nutrients (Result)
    actualNutrients: INutrients;

    // Smart Recommendations
    alternatives: IAlternativeSuggestion[];

    // Monetization
    isDemo: boolean;
    isUnlocked: boolean;
    unlockedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

const NutrientsAtMomentSchema = new Schema({
    protein: { type: Number, required: true },
    fat: { type: Number, required: true },
    fiber: { type: Number, required: true },
    ash: { type: Number, required: true },
    lysine: { type: Number, required: true },
    methionine: { type: Number, required: true },
    calcium: { type: Number, required: true },
    phosphorous: { type: Number, required: true }
}, { _id: false });

const IngredientUsedSchema = new Schema({
    ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    qtyKg: {
        type: Number,
        required: true,
        min: 0
    },
    bags: {
        type: Number,
        required: true,
        min: 0
    },
    priceAtMoment: {
        type: Number,
        required: true,
        min: 0
    },
    nutrientsAtMoment: {
        type: NutrientsAtMomentSchema,
        required: true
    }
}, { _id: false });


const AlternativeSuggestionSchema = new Schema({
    suggestion: { type: String, required: true },
    savings: { type: Number, required: true }
}, { _id: false });


const FormulationSchema = new Schema<IFormulation>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    farmId: {
        type: Schema.Types.ObjectId,
        ref: 'FarmProfile'
    },
    batchName: {
        type: String,
        required: true,
        trim: true
    },
    targetWeightKg: {
        type: Number,
        required: true,
        min: 1
    },
    standardUsed: {
        type: Schema.Types.ObjectId,
        ref: 'FeedStandard',
        required: true
    },
    totalCost: {
        type: Number,
        required: true,
        min: 0
    },
    costPerKg: {
        type: Number,
        required: true,
        min: 0
    },
    overheadCost: {
        type: Number,
        default: 0,
        min: 0  // Milling, processing, pelletizing, transport costs
    },
    complianceColor: {
        type: String,
        enum: ['Red', 'Blue', 'Green'],
        required: true
    },
    qualityMatchPercentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    ingredientsUsed: {
        type: [IngredientUsedSchema],
        required: true
    },
    actualNutrients: {
        protein: { type: Number, required: true },
        fat: { type: Number, required: true },
        fiber: { type: Number, required: true },
        ash: { type: Number, required: true },
        lysine: { type: Number, required: true },
        methionine: { type: Number, required: true },
        calcium: { type: Number, required: true },
        phosphorous: { type: Number, required: true }
    },
    alternatives: {
        type: [AlternativeSuggestionSchema],
        default: []
    },
    isDemo: {
        type: Boolean,
        default: false
    },
    isUnlocked: {
        type: Boolean,
        default: false,
        index: true
    },
    unlockedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes for performance
FormulationSchema.index({ userId: 1, createdAt: -1 });
FormulationSchema.index({ userId: 1, isUnlocked: 1 });

export default mongoose.model<IFormulation>('Formulation', FormulationSchema);

import mongoose, { Schema, Document } from 'mongoose';

export interface INutrients {
    protein: number;      // % Crude Protein
    fat: number;          // % Fat/Oil
    fiber: number;        // % Fiber
    ash: number;          // % Ash
    lysine: number;       // % Lysine
    methionine: number;   // % Methionine
    calcium: number;      // % Calcium
    phosphorous: number;  // % Phosphorous
}

export interface IConstraints {
    max_inclusion?: number;  // Maximum % in formulation
    min_inclusion?: number;  // Minimum % in formulation
}

export type IngredientCategory = 'CARBOHYDRATE' | 'PROTEIN' | 'FIBER' | 'MINERALS' | 'OTHER';

export interface IIngredient extends Document {
    name: string;
    category: IngredientCategory;
    nutrients: INutrients;
    constraints: IConstraints;
    defaultPrice: number | null;  // Benchmark market price (₦/kg)
    bagWeight: number | null;     // Fixed bag size (kg) - null if sold loose
    specificGravity: number | null; // For liquids like Palm Oil (0.91) - converts liters to kg
    isAutoCalculated: boolean;    // True for Vitamin C (400mg/kg auto-calculated)
    autoCalcRatio: number | null; // Ratio for auto-calculation (e.g., 0.0004 for 400mg/kg)
    alternatives: mongoose.Types.ObjectId[];  // Alternative ingredients
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const NutrientsSchema = new Schema({
    protein: { type: Number, required: true, default: 0 },
    fat: { type: Number, required: true, default: 0 },
    fiber: { type: Number, required: true, default: 0 },
    ash: { type: Number, required: true, default: 0 },
    lysine: { type: Number, required: true, default: 0 },
    methionine: { type: Number, required: true, default: 0 },
    calcium: { type: Number, required: true, default: 0 },
    phosphorous: { type: Number, required: true, default: 0 },
}, { _id: false });

const ConstraintsSchema = new Schema({
    max_inclusion: { type: Number },
    min_inclusion: { type: Number },
}, { _id: false });

const IngredientSchema = new Schema<IIngredient>({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    category: {
        type: String,
        enum: ['CARBOHYDRATE', 'PROTEIN', 'FIBER', 'MINERALS', 'OTHER'],
        required: true,
        index: true
    },
    nutrients: {
        type: NutrientsSchema,
        required: true
    },
    constraints: {
        type: ConstraintsSchema,
        default: {}
    },
    defaultPrice: {
        type: Number,
        default: null
    },
    bagWeight: {
        type: Number,
        default: null,
        min: 0
    },
    specificGravity: {
        type: Number,
        default: null,  // For liquids like Palm Oil (0.91)
        min: 0,
        max: 2
    },
    isAutoCalculated: {
        type: Boolean,
        default: false  // True for Vitamin C (auto-calculated based on batch weight)
    },
    autoCalcRatio: {
        type: Number,
        default: null   // e.g., 0.0004 for 400mg/kg Vitamin C
    },
    alternatives: [{
        type: Schema.Types.ObjectId,
        ref: 'Ingredient'
    }],
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

// Indexes for performance
IngredientSchema.index({ name: 'text' });
IngredientSchema.index({ category: 1, isActive: 1 });

export default mongoose.model<IIngredient>('Ingredient', IngredientSchema);

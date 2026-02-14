import mongoose, { Schema, Document } from 'mongoose';

export interface IAlternativeRule extends Document {
    originalIngredientId: mongoose.Types.ObjectId;
    alternativeIngredientId: mongoose.Types.ObjectId;
    feedType: 'fish' | 'poultry' | 'both';
    maxBlendPercent?: number;
    notes?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const AlternativeRuleSchema = new Schema<IAlternativeRule>({
    originalIngredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient',
        required: true,
        index: true
    },
    alternativeIngredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient',
        required: true,
        index: true
    },
    feedType: {
        type: String,
        enum: ['fish', 'poultry', 'both'],
        default: 'both',
        index: true
    },
    maxBlendPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 100
    },
    notes: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

AlternativeRuleSchema.index(
    { originalIngredientId: 1, alternativeIngredientId: 1, feedType: 1 },
    { unique: true }
);

export default mongoose.model<IAlternativeRule>('AlternativeRule', AlternativeRuleSchema);

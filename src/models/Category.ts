import mongoose, { Schema, Document } from 'mongoose';

export type CategoryType = 'ingredient' | 'fish_type' | 'stage' | 'other';

export interface ICategory extends Document {
    name: string;
    type: CategoryType;
    displayName: string;
    description?: string;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>({
    name: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['ingredient', 'fish_type', 'stage', 'other'],
        required: true,
        index: true
    },
    displayName: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    sortOrder: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Unique combination of name and type
CategorySchema.index({ name: 1, type: 1 }, { unique: true });

export default mongoose.model<ICategory>('Category', CategorySchema);

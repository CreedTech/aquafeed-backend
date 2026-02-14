import mongoose, { Schema, Document } from 'mongoose';

export interface IFeedTemplate extends Document {
    name: string;
    description: string;
    feedCategory: 'Catfish' | 'Poultry';
    poultryType?: 'Broiler' | 'Layer';
    ingredientNames: string[]; // Names of ingredients to pre-select
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const FeedTemplateSchema = new Schema<IFeedTemplate>({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    feedCategory: {
        type: String,
        enum: ['Catfish', 'Poultry'],
        default: 'Catfish',
        required: true,
        index: true
    },
    poultryType: {
        type: String,
        enum: ['Broiler', 'Layer'],
        index: true
    },
    ingredientNames: [{
        type: String,
        required: true
    }],
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

export default mongoose.model<IFeedTemplate>('FeedTemplate', FeedTemplateSchema);

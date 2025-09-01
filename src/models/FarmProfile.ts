import mongoose, { Schema, Document } from 'mongoose';

export interface IPond {
    id: number;
    name: string;
    fishCount: number;
    currentWeek: number;
    status: 'Active' | 'Harvested' | 'Drained';
}

export interface IFarmProfile extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    location: {
        state: string;
        lga: string;
        address?: string;
    };
    fishType: 'Catfish' | 'Tilapia' | 'Both';
    ponds: IPond[];
    isActive: boolean;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const PondSchema = new Schema({
    id: { type: Number, required: true },
    name: { type: String, required: true },
    fishCount: { type: Number, required: true, min: 0 },
    currentWeek: { type: Number, default: 1, min: 1 },
    status: {
        type: String,
        enum: ['Active', 'Harvested', 'Drained'],
        default: 'Active'
    }
}, { _id: false });

const FarmProfileSchema = new Schema<IFarmProfile>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    location: {
        state: { type: String, required: true },
        lga: { type: String, required: true },
        address: { type: String }
    },
    fishType: {
        type: String,
        enum: ['Catfish', 'Tilapia', 'Both'],
        required: true
    },
    ponds: {
        type: [PondSchema],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    isDefault: {
        type: Boolean,
        default: false,
        index: true
    }
}, {
    timestamps: true
});

// Indexes
FarmProfileSchema.index({ userId: 1, isActive: 1 });

export default mongoose.model<IFarmProfile>('FarmProfile', FarmProfileSchema);

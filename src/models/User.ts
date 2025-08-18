import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'farmer' | 'admin' | 'consultant';

export interface IUser extends Document {
    email: string;
    phone?: string;
    name: string;
    role: UserRole;
    walletBalance: number;
    hasFullAccess: boolean;  // Paid ₦10,000 for full access
    freeTrialUsed: boolean;  // Used their 1 free formula
    formulaCount: number;    // Total formulas created
    lastLoginAt?: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;

    // Method to check if user can create formula
    canCreateFormula(): boolean;
}

const UserSchema = new Schema<IUser>({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    phone: {
        type: String,
        trim: true,
        match: [/^\+?[\d\s-()]+$/, 'Please enter a valid phone number']
    },
    name: {
        type: String,
        required: true,
        default: 'Farmer',
        trim: true
    },
    role: {
        type: String,
        enum: ['farmer', 'admin', 'consultant'],
        default: 'farmer',
        index: true
    },
    walletBalance: {
        type: Number,
        default: 0,
        min: 0
    },
    hasFullAccess: {
        type: Boolean,
        default: false,
        index: true
    },
    freeTrialUsed: {
        type: Boolean,
        default: false
    },
    formulaCount: {
        type: Number,
        default: 0,
        min: 0
    },
    lastLoginAt: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

// Check if user can create a formula
UserSchema.methods.canCreateFormula = function (): boolean {
    // We now allow all users to run "Demo" calculations.
    // Restrictions (weight capping) are handled in the controller.
    return true;
};

// Indexes
UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ hasFullAccess: 1 });

export default mongoose.model<IUser>('User', UserSchema);


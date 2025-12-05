import mongoose, { Schema, Document } from 'mongoose';

export interface IUserInventory extends Document {
    userId: mongoose.Types.ObjectId;
    farmId: mongoose.Types.ObjectId;
    ingredientId: mongoose.Types.ObjectId;

    currentStockKg: number;
    userLocalPrice: number;  // Price they paid (₦/kg)
    lastRestockDate: Date;

    // Alerts
    lowStockThreshold: number;
    expiryDate?: Date;

    updatedAt: Date;
    createdAt: Date;
}

const UserInventorySchema = new Schema<IUserInventory>({
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
    ingredientId: {
        type: Schema.Types.ObjectId,
        ref: 'Ingredient',
        required: true,
        index: true
    },
    currentStockKg: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    userLocalPrice: {
        type: Number,
        required: true,
        min: 0
    },
    lastRestockDate: {
        type: Date,
        default: Date.now
    },
    lowStockThreshold: {
        type: Number,
        default: 50,  // Alert when < 50kg
        min: 0
    },
    expiryDate: {
        type: Date
    }
}, {
    timestamps: true
});

// Compound indexes
UserInventorySchema.index({ userId: 1, farmId: 1, ingredientId: 1 }, { unique: true });
UserInventorySchema.index({ userId: 1, currentStockKg: 1 });  // For low stock queries

// Instance method to check if stock is low
UserInventorySchema.methods.isLowStock = function (): boolean {
    return this.currentStockKg < this.lowStockThreshold;
};

// Instance method to check if expired
UserInventorySchema.methods.isExpired = function (): boolean {
    if (!this.expiryDate) return false;
    return new Date() > this.expiryDate;
};

export default mongoose.model<IUserInventory>('UserInventory', UserInventorySchema);

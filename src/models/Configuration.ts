import mongoose, { Schema, Document } from 'mongoose';

export interface IConfiguration extends Document {
    key: string;
    value: any;
    description?: string;
    category: 'FINANCIAL' | 'SCIENTIFIC' | 'SOLVER' | 'SYSTEM';
    updatedBy?: mongoose.Types.ObjectId;
}

const ConfigurationSchema = new Schema<IConfiguration>({
    key: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    value: {
        type: Schema.Types.Mixed,
        required: true
    },
    description: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        enum: ['FINANCIAL', 'SCIENTIFIC', 'SOLVER', 'SYSTEM'],
        required: true,
        index: true
    },
    updatedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

export default mongoose.model<IConfiguration>('Configuration', ConfigurationSchema);

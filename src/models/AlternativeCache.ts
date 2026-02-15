import mongoose, { Document, Schema } from 'mongoose';

export interface IAlternativeCache extends Document {
    key: string;
    payload: unknown;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AlternativeCacheSchema = new Schema<IAlternativeCache>(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        payload: {
            type: Schema.Types.Mixed,
            required: true
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }
        }
    },
    {
        timestamps: true
    }
);

export default mongoose.model<IAlternativeCache>('AlternativeCache', AlternativeCacheSchema);

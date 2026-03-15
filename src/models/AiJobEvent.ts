import mongoose, { Document, Schema } from 'mongoose';

export type AiJobEventType =
    | 'status'
    | 'delta'
    | 'sources'
    | 'reasoning_summary'
    | 'thought_delta'
    | 'answer_delta'
    | 'tool_trace'
    | 'done'
    | 'error';

export interface IAiJobEvent extends Document {
    jobId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    requestId: string;
    eventType: AiJobEventType;
    payload: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

const AiJobEventSchema = new Schema<IAiJobEvent>({
    jobId: {
        type: Schema.Types.ObjectId,
        ref: 'AiJob',
        required: true,
        index: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    requestId: {
        type: String,
        required: true,
        trim: true
    },
    eventType: {
        type: String,
        enum: ['status', 'delta', 'sources', 'reasoning_summary', 'thought_delta', 'answer_delta', 'tool_trace', 'done', 'error'],
        required: true,
        index: true
    },
    payload: {
        type: Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true
});

AiJobEventSchema.index({ jobId: 1, createdAt: 1 });
AiJobEventSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IAiJobEvent>('AiJobEvent', AiJobEventSchema);

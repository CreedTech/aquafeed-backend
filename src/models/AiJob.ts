import mongoose, { Document, Schema } from 'mongoose';

export type AiJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface IAiJob extends Document {
    userId: mongoose.Types.ObjectId;
    threadId: mongoose.Types.ObjectId;
    userMessageId?: mongoose.Types.ObjectId;
    assistantMessageId?: mongoose.Types.ObjectId;
    requestId: string;
    question: string;
    modelId?: string;
    streamRequested: boolean;
    context: {
        formulationId?: mongoose.Types.ObjectId;
        feedType?: 'fish' | 'poultry';
        stageCode?: string;
    };
    status: AiJobStatus;
    result?: Record<string, unknown>;
    errorMessage?: string;
    startedAt?: Date;
    completedAt?: Date;
    cancelledAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AiJobSchema = new Schema<IAiJob>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    threadId: {
        type: Schema.Types.ObjectId,
        ref: 'AiConversation',
        required: true,
        index: true
    },
    userMessageId: {
        type: Schema.Types.ObjectId,
        ref: 'AiMessage'
    },
    assistantMessageId: {
        type: Schema.Types.ObjectId,
        ref: 'AiMessage'
    },
    requestId: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    question: {
        type: String,
        required: true,
        trim: true
    },
    modelId: {
        type: String,
        trim: true
    },
    streamRequested: {
        type: Boolean,
        default: true
    },
    context: {
        formulationId: {
            type: Schema.Types.ObjectId,
            ref: 'Formulation'
        },
        feedType: {
            type: String,
            enum: ['fish', 'poultry']
        },
        stageCode: {
            type: String,
            trim: true,
            uppercase: true
        }
    },
    status: {
        type: String,
        enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
        default: 'queued',
        index: true
    },
    result: {
        type: Schema.Types.Mixed
    },
    errorMessage: {
        type: String
    },
    startedAt: {
        type: Date
    },
    completedAt: {
        type: Date
    },
    cancelledAt: {
        type: Date
    }
}, {
    timestamps: true
});

AiJobSchema.index({ userId: 1, createdAt: -1 });
AiJobSchema.index({ threadId: 1, createdAt: -1 });
AiJobSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IAiJob>('AiJob', AiJobSchema);

import mongoose, { Schema, Document } from 'mongoose';

export type AiInteractionKind = 'query' | 'what_if';
export type AiInteractionStatus = 'success' | 'fallback' | 'error';
export type AiVerificationStatus = 'passed' | 'failed' | 'not_applicable';
export type AiPricingSource = 'model_catalog' | 'config_estimate' | 'unknown';

export interface IAiNumericClaim {
    label: string;
    value: number;
    unit?: string;
    factId: string;
}

export interface IAiInteraction extends Document {
    userId: mongoose.Types.ObjectId;
    threadId?: mongoose.Types.ObjectId;
    formulationId?: mongoose.Types.ObjectId;
    jobId?: mongoose.Types.ObjectId;
    requestId?: string;
    kind: AiInteractionKind;
    status: AiInteractionStatus;
    verificationStatus: AiVerificationStatus;
    prompt: string;
    answer?: string;
    fallbackMessage?: string;
    citations: string[];
    numericClaims: IAiNumericClaim[];
    verificationErrors: string[];
    modelPrimary: string;
    modelFallback: string;
    modelUsed?: string;
    fallbackUsed: boolean;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    pricingSource: AiPricingSource;
    latencyMs: number;
    queueWaitMs?: number;
    processingMs?: number;
    providerStatusCode?: number;
    providerErrorCode?: string;
    retrievalSummary?: {
        sourceCount?: number;
        internalFactsCount?: number;
        knowledgeChunkCount?: number;
    };
    toolTrace?: Array<Record<string, unknown>>;
    attempts?: Array<{
        model: string;
        latencyMs?: number;
        status: 'success' | 'failed';
        errorMessage?: string;
    }>;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

const AiNumericClaimSchema = new Schema<IAiNumericClaim>({
    label: { type: String, required: true, trim: true },
    value: { type: Number, required: true },
    unit: { type: String, trim: true },
    factId: { type: String, required: true, trim: true }
}, { _id: false });

const AiInteractionSchema = new Schema<IAiInteraction>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    threadId: {
        type: Schema.Types.ObjectId,
        ref: 'AiConversation',
        index: true
    },
    formulationId: {
        type: Schema.Types.ObjectId,
        ref: 'Formulation',
        index: true
    },
    jobId: {
        type: Schema.Types.ObjectId,
        ref: 'AiJob',
        index: true
    },
    requestId: {
        type: String,
        trim: true,
        index: true
    },
    kind: {
        type: String,
        enum: ['query', 'what_if'],
        required: true
    },
    status: {
        type: String,
        enum: ['success', 'fallback', 'error'],
        required: true
    },
    verificationStatus: {
        type: String,
        enum: ['passed', 'failed', 'not_applicable'],
        required: true
    },
    prompt: {
        type: String,
        required: true,
        trim: true
    },
    answer: {
        type: String
    },
    fallbackMessage: {
        type: String
    },
    citations: {
        type: [String],
        default: []
    },
    numericClaims: {
        type: [AiNumericClaimSchema],
        default: []
    },
    verificationErrors: {
        type: [String],
        default: []
    },
    modelPrimary: {
        type: String,
        required: true
    },
    modelFallback: {
        type: String,
        required: true
    },
    modelUsed: {
        type: String
    },
    fallbackUsed: {
        type: Boolean,
        default: false
    },
    promptTokens: {
        type: Number,
        default: 0,
        min: 0
    },
    completionTokens: {
        type: Number,
        default: 0,
        min: 0
    },
    totalTokens: {
        type: Number,
        default: 0,
        min: 0
    },
    estimatedCostUsd: {
        type: Number,
        default: 0,
        min: 0
    },
    pricingSource: {
        type: String,
        enum: ['model_catalog', 'config_estimate', 'unknown'],
        default: 'unknown'
    },
    latencyMs: {
        type: Number,
        default: 0,
        min: 0
    },
    queueWaitMs: {
        type: Number,
        min: 0
    },
    processingMs: {
        type: Number,
        min: 0
    },
    providerStatusCode: {
        type: Number
    },
    providerErrorCode: {
        type: String,
        trim: true
    },
    retrievalSummary: {
        sourceCount: { type: Number, min: 0 },
        internalFactsCount: { type: Number, min: 0 },
        knowledgeChunkCount: { type: Number, min: 0 }
    },
    toolTrace: {
        type: [Schema.Types.Mixed],
        default: []
    },
    attempts: {
        type: [{
            model: { type: String, required: true },
            latencyMs: { type: Number, min: 0 },
            status: {
                type: String,
                enum: ['success', 'failed'],
                required: true
            },
            errorMessage: { type: String }
        }],
        default: []
    },
    errorMessage: {
        type: String
    }
}, {
    timestamps: true
});

AiInteractionSchema.index({ createdAt: -1 });
AiInteractionSchema.index({ userId: 1, createdAt: -1 });
AiInteractionSchema.index({ threadId: 1, createdAt: -1 });
AiInteractionSchema.index({ jobId: 1, createdAt: -1 });
AiInteractionSchema.index({ requestId: 1, createdAt: -1 });
AiInteractionSchema.index({ status: 1, createdAt: -1 });
AiInteractionSchema.index({ verificationStatus: 1, createdAt: -1 });

export default mongoose.model<IAiInteraction>('AiInteraction', AiInteractionSchema);

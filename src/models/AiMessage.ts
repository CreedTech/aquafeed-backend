import mongoose, { Schema, Document } from 'mongoose';

export type AiMessageRole = 'user' | 'assistant' | 'system';

export interface IAiMessageNumericClaim {
    label: string;
    value: number;
    unit?: string;
    factId: string;
}

export interface IAiScenarioMeta {
    scenarioType?: string;
    inputs?: Record<string, unknown>;
    result?: Record<string, unknown>;
}

export interface IAiResponseBlock {
    type: 'summary' | 'numbers_table' | 'actions' | 'warnings';
    title?: string;
    content?: string;
    rows?: Record<string, unknown>[];
}

export interface IAiRedirectTarget {
    type: 'unlock_formulation' | 'open_formulation' | 'supported_topics' | 'none';
    formulationId?: string;
}

export interface IAiMessage extends Document {
    conversationId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    requestId?: string;
    jobId?: mongoose.Types.ObjectId;
    role: AiMessageRole;
    text: string;
    rawContent?: string;
    answerContent?: string;
    thoughtProcess?: string;
    citations: string[];
    numericClaims: IAiMessageNumericClaim[];
    verificationStatus?: 'passed' | 'failed' | 'not_applicable';
    fallbackMessage?: string;
    reasoningSummary?: string;
    confidence?: number;
    responseBlocks?: IAiResponseBlock[];
    followUpPrompts?: string[];
    toolTrace?: Array<Record<string, unknown>>;
    sources?: Array<{ type?: string; title?: string; reference?: string }>;
    policyStatus?: 'allowed' | 'blocked' | 'out_of_scope';
    policyReason?: 'paid_formulation_required' | 'out_of_domain' | 'unsupported_request' | 'safety_limited';
    redirectTarget?: IAiRedirectTarget;
    groundingMode?: 'general' | 'advisory' | 'system_verified' | 'deterministic_formulation';
    modelId?: string;
    scenario?: IAiScenarioMeta;
    createdAt: Date;
    updatedAt: Date;
}

const AiMessageNumericClaimSchema = new Schema<IAiMessageNumericClaim>({
    label: { type: String, required: true, trim: true },
    value: { type: Number, required: true },
    unit: { type: String, trim: true },
    factId: { type: String, required: true, trim: true }
}, { _id: false });

const AiScenarioMetaSchema = new Schema<IAiScenarioMeta>({
    scenarioType: { type: String, trim: true },
    inputs: { type: Schema.Types.Mixed },
    result: { type: Schema.Types.Mixed }
}, { _id: false });

const AiResponseBlockSchema = new Schema<IAiResponseBlock>({
    type: {
        type: String,
        enum: ['summary', 'numbers_table', 'actions', 'warnings'],
        required: true
    },
    title: { type: String, trim: true },
    content: { type: String, trim: true },
    rows: {
        type: [Schema.Types.Mixed],
        default: []
    }
}, { _id: false });

const AiRedirectTargetSchema = new Schema<IAiRedirectTarget>({
    type: {
        type: String,
        enum: ['unlock_formulation', 'open_formulation', 'supported_topics', 'none'],
        required: true
    },
    formulationId: {
        type: String,
        trim: true
    }
}, { _id: false });

const AiMessageSchema = new Schema<IAiMessage>({
    conversationId: {
        type: Schema.Types.ObjectId,
        ref: 'AiConversation',
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
        trim: true,
        index: true
    },
    jobId: {
        type: Schema.Types.ObjectId,
        ref: 'AiJob',
        index: true
    },
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true
    },
    text: {
        type: String,
        required: true,
        trim: true
    },
    rawContent: {
        type: String
    },
    answerContent: {
        type: String
    },
    thoughtProcess: {
        type: String
    },
    citations: {
        type: [String],
        default: []
    },
    numericClaims: {
        type: [AiMessageNumericClaimSchema],
        default: []
    },
    verificationStatus: {
        type: String,
        enum: ['passed', 'failed', 'not_applicable']
    },
    fallbackMessage: {
        type: String
    },
    reasoningSummary: {
        type: String
    },
    confidence: {
        type: Number,
        min: 0,
        max: 1
    },
    responseBlocks: {
        type: [AiResponseBlockSchema],
        default: []
    },
    followUpPrompts: {
        type: [String],
        default: []
    },
    toolTrace: {
        type: [Schema.Types.Mixed],
        default: []
    },
    sources: {
        type: [{
            type: {
                type: String,
                trim: true
            },
            title: {
                type: String,
                trim: true
            },
            reference: {
                type: String,
                trim: true
            }
        }],
        default: []
    },
    policyStatus: {
        type: String,
        enum: ['allowed', 'blocked', 'out_of_scope']
    },
    policyReason: {
        type: String,
        enum: ['paid_formulation_required', 'out_of_domain', 'unsupported_request', 'safety_limited']
    },
    redirectTarget: {
        type: AiRedirectTargetSchema
    },
    groundingMode: {
        type: String,
        enum: ['general', 'advisory', 'system_verified', 'deterministic_formulation']
    },
    modelId: {
        type: String,
        trim: true
    },
    scenario: {
        type: AiScenarioMetaSchema
    }
}, {
    timestamps: true
});

AiMessageSchema.index({ conversationId: 1, createdAt: 1 });
AiMessageSchema.index({ userId: 1, createdAt: -1 });
AiMessageSchema.index({ requestId: 1, createdAt: -1 });
AiMessageSchema.index({ jobId: 1, createdAt: -1 });

export default mongoose.model<IAiMessage>('AiMessage', AiMessageSchema);

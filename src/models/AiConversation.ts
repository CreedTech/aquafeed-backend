import mongoose, { Schema, Document } from 'mongoose';

export interface IAiConversationContext {
    feedType?: 'fish' | 'poultry';
    stageCode?: string;
    formulationId?: mongoose.Types.ObjectId;
}

export interface IAiConversation extends Document {
    userId: mongoose.Types.ObjectId;
    title: string;
    contextDefaults?: IAiConversationContext;
    selectedModelId?: string;
    streamEnabled: boolean;
    archived: boolean;
    lastMessageAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AiConversationContextSchema = new Schema<IAiConversationContext>({
    feedType: {
        type: String,
        enum: ['fish', 'poultry']
    },
    stageCode: {
        type: String,
        trim: true,
        uppercase: true
    },
    formulationId: {
        type: Schema.Types.ObjectId,
        ref: 'Formulation'
    }
}, { _id: false });

const AiConversationSchema = new Schema<IAiConversation>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        trim: true,
        default: 'Formulation Assistant'
    },
    contextDefaults: {
        type: AiConversationContextSchema
    },
    selectedModelId: {
        type: String,
        trim: true
    },
    streamEnabled: {
        type: Boolean,
        default: true
    },
    archived: {
        type: Boolean,
        default: false,
        index: true
    },
    lastMessageAt: {
        type: Date,
        index: true
    }
}, {
    timestamps: true
});

AiConversationSchema.index({ userId: 1, updatedAt: -1 });
AiConversationSchema.index({ userId: 1, archived: 1, updatedAt: -1 });

export default mongoose.model<IAiConversation>('AiConversation', AiConversationSchema);

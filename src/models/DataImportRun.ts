import mongoose, { Document, Schema } from 'mongoose';

export type ImportRunStatus = 'previewed' | 'applied' | 'rolled_back' | 'failed';

export interface IFlaggedItem {
    entityType: 'ingredient' | 'standard';
    key: string;
    reasons: string[];
    severity: 'warning' | 'error';
}

export interface IImportChange {
    entityType: 'ingredient' | 'standard';
    key: string;
    action: 'create' | 'update' | 'skip';
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    notes?: string[];
}

export interface IDiffSummary {
    standardsCreated: number;
    standardsUpdated: number;
    ingredientsCreated: number;
    ingredientsUpdated: number;
    flagged: number;
}

export interface IRollbackSnapshot {
    standards: Array<Record<string, unknown>>;
    ingredients: Array<Record<string, unknown>>;
}

export interface IDataImportRun extends Document {
    importType: 'poultry_workbook';
    sourceFile: string;
    sourceVersion: string;
    status: ImportRunStatus;
    diffSummary: IDiffSummary;
    flaggedItems: IFlaggedItem[];
    changes: IImportChange[];
    rollbackSnapshotId?: string;
    rollbackSnapshot?: IRollbackSnapshot;
    errorMessage?: string;
    previewedAt?: Date;
    appliedAt?: Date;
    rolledBackAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const FlaggedItemSchema = new Schema<IFlaggedItem>({
    entityType: {
        type: String,
        enum: ['ingredient', 'standard'],
        required: true
    },
    key: {
        type: String,
        required: true,
        trim: true
    },
    reasons: [{
        type: String,
        trim: true
    }],
    severity: {
        type: String,
        enum: ['warning', 'error'],
        default: 'warning'
    }
}, { _id: false });

const ImportChangeSchema = new Schema<IImportChange>({
    entityType: {
        type: String,
        enum: ['ingredient', 'standard'],
        required: true
    },
    key: {
        type: String,
        required: true,
        trim: true
    },
    action: {
        type: String,
        enum: ['create', 'update', 'skip'],
        required: true
    },
    before: {
        type: Schema.Types.Mixed
    },
    after: {
        type: Schema.Types.Mixed
    },
    notes: [{
        type: String,
        trim: true
    }]
}, { _id: false });

const DataImportRunSchema = new Schema<IDataImportRun>({
    importType: {
        type: String,
        enum: ['poultry_workbook'],
        default: 'poultry_workbook',
        required: true,
        index: true
    },
    sourceFile: {
        type: String,
        required: true,
        trim: true
    },
    sourceVersion: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        enum: ['previewed', 'applied', 'rolled_back', 'failed'],
        default: 'previewed',
        required: true,
        index: true
    },
    diffSummary: {
        standardsCreated: { type: Number, default: 0 },
        standardsUpdated: { type: Number, default: 0 },
        ingredientsCreated: { type: Number, default: 0 },
        ingredientsUpdated: { type: Number, default: 0 },
        flagged: { type: Number, default: 0 }
    },
    flaggedItems: {
        type: [FlaggedItemSchema],
        default: []
    },
    changes: {
        type: [ImportChangeSchema],
        default: []
    },
    rollbackSnapshotId: {
        type: String,
        trim: true
    },
    rollbackSnapshot: {
        standards: {
            type: [Schema.Types.Mixed],
            default: []
        },
        ingredients: {
            type: [Schema.Types.Mixed],
            default: []
        }
    },
    errorMessage: {
        type: String,
        trim: true
    },
    previewedAt: {
        type: Date
    },
    appliedAt: {
        type: Date
    },
    rolledBackAt: {
        type: Date
    }
}, { timestamps: true });

DataImportRunSchema.index({ importType: 1, createdAt: -1 });

export default mongoose.model<IDataImportRun>('DataImportRun', DataImportRunSchema);

import { Request, Response } from 'express';
import FeedStandard from '../../models/FeedStandard';

type FeedType = 'fish' | 'poultry';

type StandardPayload = {
    name?: string;
    brand?: string;
    feedType?: FeedType;
    feedCategory?: 'Catfish' | 'Poultry';
    fishSubtype?: string;
    fishType?: string;
    poultryType?: 'Broiler' | 'Layer';
    stage?: string;
    pelletSize?: string;
    targetNutrients?: Record<string, { min?: number; max?: number }>;
    tolerance?: number;
    isDefault?: boolean;
    isActive?: boolean;
};

const toFeedCategory = (payload: StandardPayload): 'Catfish' | 'Poultry' => {
    if (payload.feedCategory) return payload.feedCategory;
    return payload.feedType === 'poultry' ? 'Poultry' : 'Catfish';
};

const normalizeStandardPayload = (payload: StandardPayload) => {
    const feedCategory = toFeedCategory(payload);
    return {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.brand !== undefined ? { brand: payload.brand } : {}),
        feedCategory,
        ...(feedCategory === 'Poultry'
            ? { poultryType: payload.poultryType }
            : { fishType: payload.fishSubtype || payload.fishType || 'catfish' }),
        ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
        ...(payload.pelletSize !== undefined ? { pelletSize: payload.pelletSize } : {}),
        ...(payload.targetNutrients !== undefined ? { targetNutrients: payload.targetNutrients } : {}),
        ...(payload.tolerance !== undefined ? { tolerance: payload.tolerance } : {}),
        ...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {}),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {})
    };
};

const withCanonicalFields = <T extends { feedCategory: string; fishType?: string; poultryType?: string }>(standard: T) => ({
    ...standard,
    feedType: standard.feedCategory.toLowerCase() === 'poultry' ? 'poultry' : 'fish',
    fishSubtype: standard.feedCategory.toLowerCase() === 'poultry' ? undefined : (standard.fishType || 'catfish'),
    poultryType: standard.feedCategory.toLowerCase() === 'poultry' ? standard.poultryType : undefined
});

export const getAllStandardsAdmin = async (req: Request, res: Response) => {
    try {
        const { feedType, stage, active } = req.query;

        const query: Record<string, unknown> = {};
        if (stage) query.stage = String(stage);
        if (active !== undefined) query.isActive = active === 'true';
        if (feedType === 'fish') query.feedCategory = 'Catfish';
        if (feedType === 'poultry') query.feedCategory = 'Poultry';

        const standards = await FeedStandard.find(query).sort({ feedCategory: 1, stage: 1, name: 1 }).lean();

        res.json({
            count: standards.length,
            standards: standards.map((standard) => withCanonicalFields(standard))
        });
    } catch (error) {
        console.error('Get standards admin error:', error);
        res.status(500).json({ error: 'Failed to fetch standards' });
    }
};

export const createStandardAdmin = async (req: Request, res: Response) => {
    try {
        const payload = req.body as StandardPayload;
        if (!payload.name || !payload.stage || !payload.targetNutrients || !payload.brand || !payload.pelletSize) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['name', 'brand', 'stage', 'pelletSize', 'targetNutrients']
            });
        }

        const normalized = normalizeStandardPayload(payload);
        const created = await FeedStandard.create(normalized);

        res.status(201).json({
            message: 'Standard created successfully',
            standard: withCanonicalFields(created.toObject())
        });
    } catch (error: unknown) {
        console.error('Create standard admin error:', error);
        const duplicateError = typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
        if (duplicateError) {
            return res.status(400).json({ error: 'A standard with this name already exists' });
        }
        return res.status(400).json({ error: 'Failed to create standard' });
    }
};

export const updateStandardAdmin = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const payload = req.body as StandardPayload;
        const normalized = normalizeStandardPayload(payload);

        const updated = await FeedStandard.findByIdAndUpdate(id, normalized, {
            new: true,
            runValidators: true
        }).lean();

        if (!updated) {
            return res.status(404).json({ error: 'Standard not found' });
        }

        res.json({
            message: 'Standard updated successfully',
            standard: withCanonicalFields(updated)
        });
    } catch (error) {
        console.error('Update standard admin error:', error);
        res.status(400).json({ error: 'Failed to update standard' });
    }
};

export const deleteStandardAdmin = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deleted = await FeedStandard.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ error: 'Standard not found' });
        }

        res.json({ message: 'Standard deleted successfully' });
    } catch (error) {
        console.error('Delete standard admin error:', error);
        res.status(500).json({ error: 'Failed to delete standard' });
    }
};

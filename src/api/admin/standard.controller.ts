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
    stageCode?: string;
    ageGuidance?: string;
    sourceMeta?: {
        workbook?: string;
        sheet?: string;
        version?: string;
        inheritedFields?: string[];
    };
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
        ...(payload.stageCode !== undefined ? { stageCode: payload.stageCode } : {}),
        ...(payload.ageGuidance !== undefined ? { ageGuidance: payload.ageGuidance } : {}),
        ...(payload.sourceMeta !== undefined ? { sourceMeta: payload.sourceMeta } : {}),
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

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseBooleanQuery = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
};

const sortFieldMap: Record<string, string> = {
    name: 'name',
    feedType: 'feedCategory',
    stage: 'stage',
    stageCode: 'stageCode',
    protein: 'targetNutrients.protein.min',
    status: 'isActive',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};

type SortSpec = Record<string, 1 | -1>;

const normalizeSortDirection = (raw: unknown): 1 | -1 => {
    const normalized = String(raw || '').toLowerCase();
    return normalized === 'desc' ? -1 : 1;
};

const getSort = (sortKey: unknown, sortDirection: unknown) => {
    const field = sortFieldMap[String(sortKey || '')] || 'feedCategory';
    const dir = normalizeSortDirection(sortDirection);
    return { [field]: dir, stage: 1, name: 1 } as SortSpec;
};

export const getAllStandardsAdmin = async (req: Request, res: Response) => {
    try {
        const { feedType, stage, search } = req.query;

        const query: Record<string, unknown> = {};
        if (stage) query.stage = { $regex: `^${escapeRegex(String(stage))}$`, $options: 'i' };
        const active = parseBooleanQuery(req.query.active);
        if (active !== undefined) query.isActive = active;
        if (feedType === 'fish') query.feedCategory = 'Catfish';
        if (feedType === 'poultry') query.feedCategory = 'Poultry';
        if (search) {
            const pattern = escapeRegex(String(search).trim());
            if (pattern) {
                query.$or = [
                    { name: { $regex: pattern, $options: 'i' } },
                    { stage: { $regex: pattern, $options: 'i' } },
                    { brand: { $regex: pattern, $options: 'i' } }
                ];
            }
        }

        const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
        const page = clamp(parseInt(String(req.query.page || '1'), 10) || 1, 1, 100000);
        const limit = clamp(parseInt(String(req.query.limit || '20'), 10) || 20, 1, 200);
        const skip = (page - 1) * limit;
        const sort = getSort(req.query.sortKey, req.query.sortDirection);

        const [standards, filteredTotal, total, activeCount, fishCount, poultryCount] = await Promise.all([
            FeedStandard.find(query)
                .sort(sort)
                .skip(hasPagination ? skip : 0)
                .limit(hasPagination ? limit : 0)
                .lean(),
            FeedStandard.countDocuments(query),
            FeedStandard.countDocuments({}),
            FeedStandard.countDocuments({ isActive: true }),
            FeedStandard.countDocuments({ feedCategory: 'Catfish' }),
            FeedStandard.countDocuments({ feedCategory: 'Poultry' })
        ]);

        const payload: Record<string, unknown> = {
            count: standards.length,
            filteredTotal,
            standards: standards.map((standard) => withCanonicalFields(standard)),
            summary: {
                total,
                active: activeCount,
                fish: fishCount,
                poultry: poultryCount
            }
        };

        if (hasPagination) {
            payload.meta = {
                page,
                limit,
                total: filteredTotal,
                pages: Math.max(1, Math.ceil(filteredTotal / limit)),
                hasNext: skip + standards.length < filteredTotal,
                hasPrev: page > 1
            };
        }

        res.json(payload);
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

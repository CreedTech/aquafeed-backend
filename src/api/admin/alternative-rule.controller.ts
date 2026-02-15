import { Request, Response } from 'express';
import AlternativeRule from '../../models/AlternativeRule';
import Ingredient from '../../models/Ingredient';

type AlternativeRulePayload = {
    originalIngredientId?: string;
    alternativeIngredientId?: string;
    feedType?: 'fish' | 'poultry' | 'both';
    maxBlendPercent?: number;
    notes?: string;
    isActive?: boolean;
};

const parseBooleanQuery = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sortFieldMap: Record<string, string> = {
    original: 'originalIngredientId.name',
    alternative: 'alternativeIngredientId.name',
    feedType: 'feedType',
    maxBlendPercent: 'maxBlendPercent',
    status: 'isActive',
    createdAt: 'createdAt'
};

const ensureIngredientLink = async (originalIngredientId: string, alternativeIngredientId: string) => {
    await Ingredient.findByIdAndUpdate(originalIngredientId, {
        $addToSet: { alternatives: alternativeIngredientId }
    });
};

const removeIngredientLink = async (originalIngredientId: string, alternativeIngredientId: string) => {
    await Ingredient.findByIdAndUpdate(originalIngredientId, {
        $pull: { alternatives: alternativeIngredientId }
    });
};

export const getAlternativeRulesAdmin = async (req: Request, res: Response) => {
    try {
        const { feedType, search, sortKey, sortDirection } = req.query;
        const query: Record<string, unknown> = {};

        if (feedType && ['fish', 'poultry', 'both'].includes(String(feedType))) {
            query.feedType = String(feedType);
        }

        const active = parseBooleanQuery(req.query.active);
        if (active !== undefined) {
            query.isActive = active;
        }

        const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
        const page = clamp(parseInt(String(req.query.page || '1'), 10) || 1, 1, 100000);
        const limit = clamp(parseInt(String(req.query.limit || '20'), 10) || 20, 1, 200);
        const skip = (page - 1) * limit;

        const resolvedSortField = sortFieldMap[String(sortKey || '')] || 'createdAt';
        const resolvedSortDirection = String(sortDirection || '').toLowerCase() === 'asc' ? 1 : -1;

        const basePipeline: any[] = [
            { $match: query },
            {
                $lookup: {
                    from: 'ingredients',
                    localField: 'originalIngredientId',
                    foreignField: '_id',
                    as: 'originalIngredientId'
                }
            },
            {
                $unwind: {
                    path: '$originalIngredientId',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'ingredients',
                    localField: 'alternativeIngredientId',
                    foreignField: '_id',
                    as: 'alternativeIngredientId'
                }
            },
            {
                $unwind: {
                    path: '$alternativeIngredientId',
                    preserveNullAndEmptyArrays: true
                }
            }
        ];

        const normalizedSearch = String(search || '').trim();
        if (normalizedSearch) {
            const pattern = escapeRegex(normalizedSearch);
            basePipeline.push({
                $match: {
                    $or: [
                        { 'originalIngredientId.name': { $regex: pattern, $options: 'i' } },
                        { 'alternativeIngredientId.name': { $regex: pattern, $options: 'i' } },
                        { notes: { $regex: pattern, $options: 'i' } }
                    ]
                }
            });
        }

        const [rules, filteredTotalRows, summaryRows] = await Promise.all([
            AlternativeRule.aggregate([
                ...basePipeline,
                { $sort: { [resolvedSortField]: resolvedSortDirection, _id: 1 } },
                ...(hasPagination ? [{ $skip: skip }, { $limit: limit }] : [])
            ]),
            AlternativeRule.aggregate([...basePipeline, { $count: 'total' }]),
            AlternativeRule.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        active: {
                            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
                        },
                        fish: {
                            $sum: { $cond: [{ $eq: ['$feedType', 'fish'] }, 1, 0] }
                        },
                        poultry: {
                            $sum: { $cond: [{ $eq: ['$feedType', 'poultry'] }, 1, 0] }
                        },
                        both: {
                            $sum: { $cond: [{ $eq: ['$feedType', 'both'] }, 1, 0] }
                        }
                    }
                }
            ])
        ]);

        const filteredTotal = Number(filteredTotalRows[0]?.total || 0);
        const summary = summaryRows[0] || {
            total: 0,
            active: 0,
            fish: 0,
            poultry: 0,
            both: 0
        };

        const payload: Record<string, unknown> = {
            count: rules.length,
            filteredTotal,
            rules,
            summary: {
                total: Number(summary.total || 0),
                active: Number(summary.active || 0),
                inactive: Math.max(0, Number(summary.total || 0) - Number(summary.active || 0)),
                fish: Number(summary.fish || 0),
                poultry: Number(summary.poultry || 0),
                both: Number(summary.both || 0)
            },
            filterOptions: {
                feedTypes: ['fish', 'poultry', 'both']
            }
        };

        if (hasPagination) {
            payload.meta = {
                page,
                limit,
                total: filteredTotal,
                pages: Math.max(1, Math.ceil(filteredTotal / limit)),
                hasNext: skip + rules.length < filteredTotal,
                hasPrev: page > 1
            };
        }

        res.json(payload);
    } catch (error) {
        console.error('Get alternative rules error:', error);
        res.status(500).json({ error: 'Failed to fetch alternative rules' });
    }
};

export const createAlternativeRuleAdmin = async (req: Request, res: Response) => {
    try {
        const payload = req.body as AlternativeRulePayload;
        if (!payload.originalIngredientId || !payload.alternativeIngredientId) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['originalIngredientId', 'alternativeIngredientId']
            });
        }

        const created = await AlternativeRule.create({
            originalIngredientId: payload.originalIngredientId,
            alternativeIngredientId: payload.alternativeIngredientId,
            feedType: payload.feedType || 'both',
            maxBlendPercent: payload.maxBlendPercent ?? 100,
            notes: payload.notes,
            isActive: payload.isActive ?? true
        });

        await ensureIngredientLink(payload.originalIngredientId, payload.alternativeIngredientId);

        const hydrated = await AlternativeRule.findById(created._id)
            .populate('originalIngredientId', 'name category defaultPrice')
            .populate('alternativeIngredientId', 'name category defaultPrice')
            .lean();

        res.status(201).json({ message: 'Alternative rule created', rule: hydrated });
    } catch (error: unknown) {
        console.error('Create alternative rule error:', error);
        const duplicateError = typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000;
        if (duplicateError) {
            return res.status(400).json({ error: 'This alternative mapping already exists' });
        }
        return res.status(400).json({ error: 'Failed to create alternative rule' });
    }
};

export const updateAlternativeRuleAdmin = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const payload = req.body as AlternativeRulePayload;

        const existing = await AlternativeRule.findById(id);
        if (!existing) {
            return res.status(404).json({ error: 'Alternative rule not found' });
        }

        const updated = await AlternativeRule.findByIdAndUpdate(
            id,
            {
                ...(payload.originalIngredientId ? { originalIngredientId: payload.originalIngredientId } : {}),
                ...(payload.alternativeIngredientId ? { alternativeIngredientId: payload.alternativeIngredientId } : {}),
                ...(payload.feedType ? { feedType: payload.feedType } : {}),
                ...(payload.maxBlendPercent !== undefined ? { maxBlendPercent: payload.maxBlendPercent } : {}),
                ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
                ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {})
            },
            { new: true, runValidators: true }
        )
            .populate('originalIngredientId', 'name category defaultPrice')
            .populate('alternativeIngredientId', 'name category defaultPrice')
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'Alternative rule not found' });
        }

        if (
            payload.originalIngredientId ||
            payload.alternativeIngredientId
        ) {
            await removeIngredientLink(
                existing.originalIngredientId.toString(),
                existing.alternativeIngredientId.toString()
            );
            await ensureIngredientLink(
                (payload.originalIngredientId || existing.originalIngredientId.toString()),
                (payload.alternativeIngredientId || existing.alternativeIngredientId.toString())
            );
        }

        res.json({ message: 'Alternative rule updated', rule: updated });
    } catch (error) {
        console.error('Update alternative rule error:', error);
        res.status(400).json({ error: 'Failed to update alternative rule' });
    }
};

export const deleteAlternativeRuleAdmin = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const deleted = await AlternativeRule.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ error: 'Alternative rule not found' });
        }

        await removeIngredientLink(
            deleted.originalIngredientId.toString(),
            deleted.alternativeIngredientId.toString()
        );

        res.json({ message: 'Alternative rule deleted' });
    } catch (error) {
        console.error('Delete alternative rule error:', error);
        res.status(500).json({ error: 'Failed to delete alternative rule' });
    }
};

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
        const { feedType, active } = req.query;
        const query: Record<string, unknown> = {};

        if (feedType) query.feedType = String(feedType);
        if (active !== undefined) query.isActive = active === 'true';

        const rules = await AlternativeRule.find(query)
            .populate('originalIngredientId', 'name category defaultPrice')
            .populate('alternativeIngredientId', 'name category defaultPrice')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ count: rules.length, rules });
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

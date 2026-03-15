import { Request, Response } from 'express';
import FeedStandard from '../../models/FeedStandard';
import { resolveCanonicalStageCode } from '../../utils/stage-code.util';

/**
 * Get all feed standards
 * GET /api/v1/standards
 */
export const getStandards = async (req: Request, res: Response) => {
    try {
        const { fishType, stage, brand, feedType, poultryType } = req.query;

        const query: any = { isActive: true };

        if (feedType === 'fish') {
            query.feedCategory = 'Catfish';
        }
        if (feedType === 'poultry') {
            query.feedCategory = 'Poultry';
        }

        if (fishType) {
            query.fishType = fishType;
        }

        if (poultryType) {
            query.poultryType = poultryType;
        }

        if (stage) {
            const rawStage = String(stage).trim();
            const normalizedStageCode = rawStage.toUpperCase();
            const resolvedStageCode = resolveCanonicalStageCode(normalizedStageCode, {
                feedType: feedType === 'poultry' ? 'poultry' : 'fish'
            });
            query.$or = [
                { stage: { $regex: `^${rawStage}$`, $options: 'i' } },
                { stageCode: normalizedStageCode },
                ...(resolvedStageCode !== normalizedStageCode ? [{ stageCode: resolvedStageCode }] : [])
            ];
        }

        if (brand) {
            query.brand = brand;
        }

        const standards = await FeedStandard.find(query).sort({ brand: 1, stage: 1 }).lean();

        res.json({
            count: standards.length,
            standards: standards.map((standard) => ({
                ...standard,
                feedType: standard.feedCategory.toLowerCase() === 'poultry' ? 'poultry' : 'fish',
                fishSubtype: standard.feedCategory.toLowerCase() === 'poultry'
                    ? undefined
                    : (standard.fishType || 'catfish')
            }))
        });

    } catch (error) {
        console.error('Error fetching standards:', error);
        res.status(500).json({
            error: 'Failed to fetch standards',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get single standard
 * GET /api/v1/standards/:id
 */
export const getStandardById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const standard = await FeedStandard.findById(id).lean();

        if (!standard) {
            return res.status(404).json({ error: 'Standard not found' });
        }

        res.json({
            standard: {
                ...standard,
                feedType: standard.feedCategory.toLowerCase() === 'poultry' ? 'poultry' : 'fish',
                fishSubtype: standard.feedCategory.toLowerCase() === 'poultry'
                    ? undefined
                    : (standard.fishType || 'catfish')
            }
        });

    } catch (error) {
        console.error('Error fetching standard:', error);
        res.status(500).json({
            error: 'Failed to fetch standard',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get default standard
 * GET /api/v1/standards/default
 */
export const getDefaultStandard = async (_req: Request, res: Response) => {
    try {
        const standard = await FeedStandard.findOne({ isDefault: true, isActive: true }).lean();

        if (!standard) {
            return res.status(404).json({ error: 'No default standard found' });
        }

        res.json({
            standard: {
                ...standard,
                feedType: standard.feedCategory.toLowerCase() === 'poultry' ? 'poultry' : 'fish',
                fishSubtype: standard.feedCategory.toLowerCase() === 'poultry'
                    ? undefined
                    : (standard.fishType || 'catfish')
            }
        });

    } catch (error) {
        console.error('Error fetching default standard:', error);
        res.status(500).json({
            error: 'Failed to fetch default standard',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

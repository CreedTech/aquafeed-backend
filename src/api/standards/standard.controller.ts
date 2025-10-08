import { Request, Response } from 'express';
import FeedStandard from '../../models/FeedStandard';

/**
 * Get all feed standards
 * GET /api/v1/standards
 */
export const getStandards = async (req: Request, res: Response) => {
    try {
        const { fishType, stage, brand } = req.query;

        const query: any = { isActive: true };

        if (fishType) {
            query.fishType = fishType;
        }

        if (stage) {
            query.stage = stage;
        }

        if (brand) {
            query.brand = brand;
        }

        const standards = await FeedStandard.find(query).sort({ brand: 1, stage: 1 });

        res.json({
            count: standards.length,
            standards
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

        const standard = await FeedStandard.findById(id);

        if (!standard) {
            return res.status(404).json({ error: 'Standard not found' });
        }

        res.json({ standard });

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
        const standard = await FeedStandard.findOne({ isDefault: true, isActive: true });

        if (!standard) {
            return res.status(404).json({ error: 'No default standard found' });
        }

        res.json({ standard });

    } catch (error) {
        console.error('Error fetching default standard:', error);
        res.status(500).json({
            error: 'Failed to fetch default standard',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

import { Request, Response } from 'express';
import Batch from '../../models/Batch';
import { ensureFarmProfile } from '../../services/farm.service';

/**
 * Create a new batch
 */
export const createBatch = async (req: Request, res: Response) => {
    try {
        const { name, pondId, initialFishCount, startDate } = req.body;
        const userId = req.session.userId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const farm = await ensureFarmProfile(userId);

        // Check if pond is already occupied (optional validation)
        const activeBatch = await Batch.findOne({
            userId,
            pondId,
            status: 'Active'
        });

        if (activeBatch) {
            res.status(400).json({
                error: `Pond ${pondId} already has an active batch: ${activeBatch.name}`
            });
            return;
        }

        if (Number(initialFishCount) < 0) {
            res.status(400).json({ error: 'Initial fish count cannot be negative' });
            return;
        }

        const batch = await Batch.create({
            userId,
            farmId: farm._id,
            name,
            pondId,
            initialFishCount: Number(initialFishCount),
            currentFishCount: Number(initialFishCount),
            startDate: startDate || new Date(),
            status: 'Active'
        });

        res.status(201).json({ message: 'Batch created successfully', batch });

    } catch (error) {
        console.error('Create Batch Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get active batches
 */
export const getBatches = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId;
        const { status } = req.query; // 'Active' or 'Harvested'

        const query: any = { userId };
        if (status) query.status = status;

        const batches = await Batch.find(query).sort({ startDate: -1 });

        res.json({ data: batches });
    } catch (error) {
        console.error('Get Batches Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Log daily feed usage
 */
export const logFeeding = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // Batch ID
        const { feedAmountKg } = req.body; // Can be linked to an inventory item later
        const userId = req.session.userId;

        const batch = await Batch.findOne({ _id: id, userId });
        if (!batch) {
            res.status(404).json({ error: 'Batch not found' });
            return;
        }

        if (batch.status !== 'Active') {
            res.status(400).json({ error: 'Cannot log feed for inactive batch' });
            return;
        }

        if (feedAmountKg <= 0) {
            res.status(400).json({ error: 'Feed amount must be positive' });
            return;
        }

        // Update total feed used (triggers pre-save FCR recalc)
        batch.totalFeedUsedKg += Number(feedAmountKg);

        // Use markModified if needed, but since it's a top level number it should be fine.
        // FCR calc happens in pre('save') inside Batch model checking totalFeedUsedKg
        await batch.save();

        res.json({
            message: 'Feeding logged',
            totalFeedUsed: batch.totalFeedUsedKg,
            newFcr: batch.fcr
        });

    } catch (error) {
        console.error('Log Feeding Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update estimated biomass (updates FCR)
 */
export const updateBiomass = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { currentWeightKg, mortalityCount } = req.body;
        const userId = req.session.userId;

        const batch = await Batch.findOne({ _id: id, userId });
        if (!batch) {
            res.status(404).json({ error: 'Batch not found' });
            return;
        }

        if (currentWeightKg !== undefined) {
            batch.estimatedFishWeightKg = Number(currentWeightKg);
        }

        if (mortalityCount !== undefined) {
            batch.currentFishCount = batch.currentFishCount - Number(mortalityCount);
            if (batch.currentFishCount < 0) batch.currentFishCount = 0;
        }

        await batch.save(); // Triggers FCR recalc

        res.json({
            message: 'Biomass updated',
            estimatedWeight: batch.estimatedFishWeightKg,
            currentFishCount: batch.currentFishCount,
            newFcr: batch.fcr
        });

    } catch (error) {
        console.error('Update Biomass Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Close/Harvest Batch
 */
export const closeBatch = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.session.userId;

        const batch = await Batch.findOneAndUpdate(
            { _id: id, userId },
            { status: 'Harvested' },
            { new: true }
        );

        if (!batch) {
            res.status(404).json({ error: 'Batch not found' });
            return;
        }

        res.json({ message: 'Batch harvested successfully', batch });

    } catch (error) {
        console.error('Close Batch Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

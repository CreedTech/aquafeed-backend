import { Request, Response } from 'express';
import Revenue from '../../models/Revenue';
import { ensureFarmProfile } from '../../services/farm.service';
import mongoose from 'mongoose';

/**
 * Create a new revenue entry
 */
export const createRevenue = async (req: Request, res: Response) => {
    try {
        const { type, quantity, pricePerUnit, buyer, date, batchId } = req.body;
        const userId = req.session.userId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Ensure user has a farm profile
        const farm = await ensureFarmProfile(userId);

        const revenue = await Revenue.create({
            userId,
            farmId: farm._id,
            type,
            quantity: Number(quantity),
            pricePerUnit: Number(pricePerUnit),
            totalAmount: Number(quantity) * Number(pricePerUnit), // Redundant but explicit
            buyer,
            date: date || new Date(),
            batchId: batchId || undefined
        });

        res.status(201).json({ message: 'Revenue recorded successfully', revenue });

    } catch (error) {
        console.error('Create Revenue Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get revenues with pagination and filters
 */
export const getRevenues = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId;
        if (!userId) return;

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const { type, startDate, endDate } = req.query;

        // Build query
        const query: any = { userId };

        if (type) {
            query.type = type;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate as string);
            if (endDate) query.date.$lte = new Date(endDate as string);
        }

        // Execute query
        const revenues = await Revenue.find(query)
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Revenue.countDocuments(query);

        res.json({
            data: revenues,
            meta: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get Revenues Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get revenue summary
 */
export const getRevenueSummary = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId;
        if (!userId) return;

        const { startDate, endDate } = req.query;
        const matchStage: any = {
            userId: new mongoose.Types.ObjectId(userId)
        };

        if (startDate || endDate) {
            matchStage.date = {};
            if (startDate) matchStage.date.$gte = new Date(startDate as string);
            if (endDate) matchStage.date.$lte = new Date(endDate as string);
        }

        const summary = await Revenue.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$type',
                    totalAmount: { $sum: '$totalAmount' },
                    totalQuantity: { $sum: '$quantity' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { totalAmount: -1 } }
        ]);

        const totalRevenue = summary.reduce((acc, curr) => acc + curr.totalAmount, 0);

        res.json({
            total: totalRevenue,
            breakdown: summary
        });

    } catch (error) {
        console.error('Revenue Summary Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

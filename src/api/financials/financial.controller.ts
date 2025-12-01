import { Request, Response } from 'express';
import Expense from '../../models/Expense';
import Revenue from '../../models/Revenue';
import mongoose from 'mongoose';

/**
 * Get Profit and Loss Summary
 */
export const getPnL = async (req: Request, res: Response) => {
    try {
        const userId = req.session?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const { startDate, endDate } = req.query;
        const matchStage: any = {
            userId: new mongoose.Types.ObjectId(userId)
        };

        if (startDate || endDate) {
            matchStage.date = {};
            if (startDate) matchStage.date.$gte = new Date(startDate as string);
            if (endDate) matchStage.date.$lte = new Date(endDate as string);
        }

        // Parallel aggregation for performance
        const [expenseData, revenueData] = await Promise.all([
            Expense.aggregate([
                { $match: matchStage },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Revenue.aggregate([
                { $match: matchStage },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } }
            ])
        ]);

        const totalExpenses = expenseData.length > 0 ? expenseData[0].total : 0;
        const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;
        const netProfit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        const metrics = {
            totalRevenue,
            totalExpenses,
            netProfit,
            profitMargin: parseFloat(profitMargin.toFixed(2))
        };

        console.log(`PnL for User ${userId}:`, metrics);

        res.json({
            data: {
                metrics,
                period: {
                    startDate: startDate || 'All Time',
                    endDate: endDate || 'All Time'
                }
            }
        });

    } catch (error) {
        console.error('P&L Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

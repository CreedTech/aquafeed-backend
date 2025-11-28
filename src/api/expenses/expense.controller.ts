import { Request, Response } from 'express';
import Expense from '../../models/Expense';
import { ensureFarmProfile } from '../../services/farm.service';
import { uploadImage } from '../../config/cloudinary';
import mongoose from 'mongoose';

/**
 * Create a new expense
 */
export const createExpense = async (req: Request, res: Response) => {
    try {
        const { amount, category, description, date, formulationId } = req.body;
        const userId = req.session.userId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Ensure user has a farm profile
        const farm = await ensureFarmProfile(userId);

        let receiptUrl = '';
        // Handle file upload
        if (req.file) {
            try {
                if (process.env.CLOUDINARY_CLOUD_NAME) {
                    receiptUrl = await uploadImage(req.file.buffer, 'aquafeed_receipts');
                } else {
                    console.warn('Cloudinary keys missing. Skipping upload.');
                }
            } catch (uploadError) {
                console.error('Image upload failed:', uploadError);
                // We continue saving the expense even if image upload fails, but warn the user
            }
        }

        const expense = await Expense.create({
            userId,
            farmId: farm._id,
            amount: Number(amount),
            category,
            description,
            date: date || new Date(),
            receiptUrl,
            formulationId: formulationId || undefined
        });

        res.status(201).json({ message: 'Expense recorded successfully', expense });

    } catch (error) {
        console.error('Create Expense Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get expenses with pagination and filters
 */
export const getExpenses = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId;
        if (!userId) return;

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const { category, startDate, endDate } = req.query;

        // Build query
        const query: any = { userId };

        if (category) {
            query.category = category;
        }

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate as string);
            if (endDate) query.date.$lte = new Date(endDate as string);
        }

        // Execute query
        const expenses = await Expense.find(query)
            .sort({ date: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Expense.countDocuments(query);

        res.json({
            data: expenses,
            meta: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get Expenses Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get expense summary for charts
 */
export const getExpenseSummary = async (req: Request, res: Response) => {
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

        const summary = await Expense.aggregate([
            { $match: matchStage },
            {
                $group: {
                    _id: '$category',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { totalAmount: -1 } }
        ]);

        const totalExpense = summary.reduce((acc, curr) => acc + curr.totalAmount, 0);

        res.json({
            total: totalExpense,
            breakdown: summary
        });

    } catch (error) {
        console.error('Expense Summary Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

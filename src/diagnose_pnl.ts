import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Expense from './models/Expense';
import Revenue from './models/Revenue';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aquafeed';
const USER_ID = '694ef01bbc3a03ef564c55e0';

async function diagnose() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        const userId = new mongoose.Types.ObjectId(USER_ID);
        const matchStage = { userId };

        console.log('Diagnosing User:', USER_ID);

        // Check raw counts
        const expenseCount = await Expense.countDocuments({ userId });
        const revenueCount = await Revenue.countDocuments({ userId });

        console.log('Expense Count:', expenseCount);
        console.log('Revenue Count:', revenueCount);

        // Run aggregations
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

        console.log('Expense Aggregation:', JSON.stringify(expenseData, null, 2));
        console.log('Revenue Aggregation:', JSON.stringify(revenueData, null, 2));

        const totalExpenses = expenseData.length > 0 ? expenseData[0].total : 0;
        const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

        console.log('--- Results ---');
        console.log('Total Revenue:', totalRevenue);
        console.log('Total Expenses:', totalExpenses);
        console.log('Net Profit:', totalRevenue - totalExpenses);

        await mongoose.disconnect();
    } catch (error) {
        console.error('Diagnosis failed:', error);
    }
}

diagnose();

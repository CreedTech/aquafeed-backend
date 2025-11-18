import mongoose from 'mongoose';
import User from '../models/User';
import Transaction, { ITransaction, TransactionType } from '../models/Transaction'; // Ensure ITransaction is exported from model

/**
 * Process a wallet transaction atomically
 */
export const processTransaction = async (
    userId: string,
    amount: number,
    type: TransactionType,
    description: string,
    paystackReference?: string,
    formulationId?: string
): Promise<ITransaction> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error('User not found');

        if (amount <= 0) throw new Error('Transaction amount must be positive');

        let newBalance = user.walletBalance;

        if (type === 'credit') {
            newBalance += amount;
        } else if (type === 'debit') {
            if (user.walletBalance < amount) {
                throw new Error('Insufficient wallet balance');
            }
            newBalance -= amount;
        }

        // Update User Balance
        user.walletBalance = newBalance;
        await user.save({ session });

        // Create Transaction Record
        const transaction = await Transaction.create([{
            userId,
            type,
            amount,
            description,
            status: 'success',
            balanceAfter: newBalance,
            paystackReference,
            formulationId
        }], { session });

        await session.commitTransaction();
        return transaction[0];

    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};

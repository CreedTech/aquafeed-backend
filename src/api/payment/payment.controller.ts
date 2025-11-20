import { Request, Response } from 'express';
import axios from 'axios';
import { processTransaction } from '../../services/wallet.service';
import Transaction from '../../models/Transaction';
import User from '../../models/User';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

/**
 * Initialize Paystack Deposit
 */
export const initializeDeposit = async (req: Request, res: Response) => {
    console.log('Payment Init: Start');
    try {
        const { amount } = req.body; // Amount in Naira
        const userId = req.session.userId;
        console.log('Payment Init: UserID', userId, 'Amount', amount);

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const user = await User.findById(userId);
        console.log('Payment Init: User Found', !!user);

        if (!user) {
            res.status(401).json({ error: 'User not found' });
            return;
        }

        if (amount <= 0) {
            res.status(400).json({ error: 'Deposit amount must be positive' });
            return;
        }

        const amountKobo = Math.round(amount * 100); // Paystack expects Kobo

        console.log('Payment Init: Secret Check', !!PAYSTACK_SECRET);
        if (!PAYSTACK_SECRET) {
            // Mock for development if no key
            console.warn('PAYSTACK_SECRET_KEY missing. Returning mock URL.');
            res.json({
                authorization_url: 'http://localhost:3000/dashboard/wallet?mock_success=true',
                access_code: 'mock_code',
                reference: `mock_${Date.now()}`
            });
            return;
        }

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email: user.email,
                amount: amountKobo,
                callback_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/wallet/callback`,
                metadata: {
                    userId: user._id.toString(),
                    type: 'wallet_deposit'
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json(response.data.data);

    } catch (error: any) {
        console.error('Paystack Init Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
};

/**
 * Verify Paystack Payment
 */
export const verifyPayment = async (req: Request, res: Response) => {
    try {
        const { reference } = req.query;
        const userId = req.session.userId;

        if (!reference) {
            res.status(400).json({ error: 'No reference provided' });
            return;
        }

        // Check if transaction already processed
        const existingTx = await Transaction.findOne({ paystackReference: reference as string });
        if (existingTx) {
            res.status(400).json({ error: 'Transaction already processed' });
            return;
        }

        if (!PAYSTACK_SECRET || (reference as string).startsWith('mock_')) {
            // Handle Mock Verification
            const amount = 5000; // Mock amount
            await processTransaction(
                userId!,
                amount,
                'credit',
                'Wallet Deposit (Mock)',
                reference as string
            );
            res.json({ message: 'Payment verified (Mock)', amount });
            return;
        }

        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
            }
        );

        const data = response.data.data;

        if (data.status === 'success') {
            const amountNaira = data.amount / 100;

            // Credit Wallet
            await processTransaction(
                userId!,
                amountNaira,
                'credit',
                'Wallet Deposit',
                reference as string
            );

            res.json({ message: 'Payment verified successfully', amount: amountNaira });
        } else {
            res.status(400).json({ error: 'Payment verification failed' });
        }

    } catch (error: any) {
        console.error('Verify Payment Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Verification failed' });
    }
};

/**
 * Get User Transactions
 */
export const getTransactions = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId || (req as any).userId;
        const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(50);
        res.json({ data: transactions });
    } catch (error) {
        console.error('Get Transactions Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Grant Full Access (₦10,000 payment)
 * Called after successful Paystack payment for full access
 */
export const grantFullAccess = async (req: Request, res: Response) => {
    try {
        const userId = req.session.userId || (req as any).userId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Check if already has access
        if (user.hasFullAccess) {
            res.json({ success: true, message: 'You already have full access' });
            return;
        }

        // Deduct from wallet if balance >= 10000
        const ACCESS_COST = 10000;
        if (user.walletBalance >= ACCESS_COST) {
            user.walletBalance -= ACCESS_COST;
            user.hasFullAccess = true;
            await user.save();

            // Record transaction
            await processTransaction(
                userId,
                ACCESS_COST,
                'debit',
                'Full Access Purchase',
                `access_${Date.now()}`
            );

            res.json({
                success: true,
                message: 'Full access granted!',
                user: {
                    hasFullAccess: user.hasFullAccess,
                    walletBalance: user.walletBalance,
                }
            });
        } else {
            res.status(400).json({
                error: 'Insufficient wallet balance',
                required: ACCESS_COST,
                current: user.walletBalance
            });
        }
    } catch (error) {
        console.error('Grant Access Error:', error);
        res.status(500).json({ error: 'Failed to grant access' });
    }
};


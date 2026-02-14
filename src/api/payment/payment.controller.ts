import crypto from 'crypto';
import { Request, Response } from 'express';
import axios from 'axios';
import mongoose from 'mongoose';
import { processTransaction } from '../../services/wallet.service';
import Transaction from '../../models/Transaction';
import User from '../../models/User';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

class PaymentProcessingError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const getAuthenticatedUserId = (req: Request): string | null => (
    req.userId || req.session?.userId || null
);

const getReferenceFromRequest = (req: Request): string | null => {
    const rawReference = req.query.reference;
    if (typeof rawReference === 'string' && rawReference.trim().length > 0) {
        return rawReference.trim();
    }
    return null;
};

const getWebhookSignature = (req: Request): string | null => {
    const header = req.headers['x-paystack-signature'];
    if (!header) return null;
    if (Array.isArray(header)) return header[0] || null;
    return header;
};

const isDuplicateReferenceError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const maybeMongoError = error as { code?: number };
    return maybeMongoError.code === 11000;
};

const getConfiguredCallbackUrl = (): string | undefined => {
    if (process.env.PAYSTACK_CALLBACK_URL?.trim()) {
        return process.env.PAYSTACK_CALLBACK_URL.trim();
    }

    // Default callback for local testing.
    if (process.env.NODE_ENV !== 'production') {
        const backendBaseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
        return `${backendBaseUrl}/api/v1/payments/callback`;
    }

    return undefined;
};

type PaystackVerifyData = {
    status?: string;
    amount?: number;
    currency?: string;
    reference?: string;
    metadata?: {
        userId?: string;
        type?: string;
        requestedAmountNaira?: number;
    };
};

type CreditResult = {
    amountNaira: number;
    reference: string;
    userId: string;
    alreadyProcessed: boolean;
};

const creditWalletFromVerifiedPaystackData = async (
    verifyData: PaystackVerifyData,
    expectedUserId?: string
): Promise<CreditResult> => {
    const reference = typeof verifyData.reference === 'string'
        ? verifyData.reference
        : '';
    if (!reference) {
        throw new PaymentProcessingError('Missing payment reference');
    }

    if (verifyData.status !== 'success') {
        throw new PaymentProcessingError('Payment is not successful');
    }

    if (verifyData.currency && verifyData.currency !== 'NGN') {
        throw new PaymentProcessingError('Unsupported payment currency');
    }

    const metadataUserId = typeof verifyData.metadata?.userId === 'string'
        ? verifyData.metadata.userId
        : undefined;

    if (
        expectedUserId &&
        metadataUserId &&
        expectedUserId !== metadataUserId
    ) {
        throw new PaymentProcessingError(
            'Payment reference does not belong to this user',
            403
        );
    }

    const resolvedUserId = metadataUserId || expectedUserId;
    if (!resolvedUserId) {
        throw new PaymentProcessingError('Unable to determine payment owner');
    }

    const amountKobo = Number(verifyData.amount ?? 0);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
        throw new PaymentProcessingError('Invalid payment amount');
    }
    const amountNaira = amountKobo / 100;

    const existingTx = await Transaction.findOne({
        paystackReference: reference,
    }).lean();
    if (existingTx) {
        const existingUserId = existingTx.userId.toString();
        if (expectedUserId && existingUserId !== expectedUserId) {
            throw new PaymentProcessingError(
                'Payment reference does not belong to this user',
                403
            );
        }

        if (existingTx.status !== 'success') {
            throw new PaymentProcessingError(
                'Payment reference is not in a successful state'
            );
        }

        return {
            amountNaira: Number(existingTx.amount),
            reference,
            userId: existingUserId,
            alreadyProcessed: true,
        };
    }

    try {
        await processTransaction(
            resolvedUserId,
            amountNaira,
            'credit',
            'Wallet Deposit',
            reference
        );
    } catch (error) {
        if (isDuplicateReferenceError(error)) {
            return {
                amountNaira,
                reference,
                userId: resolvedUserId,
                alreadyProcessed: true,
            };
        }
        throw error;
    }

    return {
        amountNaira,
        reference,
        userId: resolvedUserId,
        alreadyProcessed: false,
    };
};

/**
 * Initialize Paystack Deposit
 */
export const initializeDeposit = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        const amount = Number(req.body?.amount);

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const user = await User.findById(userId).lean();
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ error: 'Deposit amount must be positive' });
            return;
        }

        const amountKobo = Math.round(amount * 100);
        const reference = `aqf_${new mongoose.Types.ObjectId().toString()}`;

        if (!PAYSTACK_SECRET) {
            // Development-only fallback to unblock local testing.
            if (process.env.NODE_ENV === 'production') {
                res.status(500).json({ error: 'Paystack is not configured' });
                return;
            }

            res.json({
                authorization_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/wallet?mock_success=true&reference=${reference}`,
                access_code: 'mock_code',
                reference,
            });
            return;
        }

        const callbackUrl = getConfiguredCallbackUrl();
        const payload: Record<string, unknown> = {
            email: user.email,
            amount: amountKobo,
            reference,
            metadata: {
                userId,
                type: 'wallet_deposit',
                requestedAmountNaira: amount,
            },
        };

        if (callbackUrl) {
            payload.callback_url = callbackUrl;
        }

        const response = await axios.post(
            `${PAYSTACK_BASE_URL}/transaction/initialize`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        res.json(response.data.data);
    } catch (error: unknown) {
        const details = axios.isAxiosError(error)
            ? error.response?.data
            : (error as Error).message;
        console.error('Paystack Init Error:', details);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
};

/**
 * Verify Paystack Payment
 */
export const verifyPayment = async (req: Request, res: Response) => {
    try {
        const reference = getReferenceFromRequest(req);
        const userId = getAuthenticatedUserId(req);

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!reference) {
            res.status(400).json({ error: 'No reference provided' });
            return;
        }

        if (!PAYSTACK_SECRET || reference.startsWith('mock_')) {
            const existingMockTx = await Transaction.findOne({
                paystackReference: reference,
            }).lean();

            if (!existingMockTx) {
                await processTransaction(
                    userId,
                    5000,
                    'credit',
                    'Wallet Deposit (Mock)',
                    reference
                );
            }

            res.json({
                message: existingMockTx
                    ? 'Payment already verified (Mock)'
                    : 'Payment verified (Mock)',
                amount: existingMockTx ? existingMockTx.amount : 5000,
                reference,
            });
            return;
        }

        const response = await axios.get(
            `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
            }
        );

        const verifyData = response.data?.data as PaystackVerifyData;
        const creditResult = await creditWalletFromVerifiedPaystackData(
            verifyData,
            userId
        );

        res.json({
            message: creditResult.alreadyProcessed
                ? 'Payment already verified'
                : 'Payment verified successfully',
            amount: creditResult.amountNaira,
            reference: creditResult.reference,
            alreadyProcessed: creditResult.alreadyProcessed,
        });
    } catch (error: unknown) {
        if (error instanceof PaymentProcessingError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }

        const details = axios.isAxiosError(error)
            ? error.response?.data
            : (error as Error).message;
        console.error('Verify Payment Error:', details);
        res.status(500).json({ error: 'Verification failed' });
    }
};

/**
 * Paystack webhook - server to server payment confirmation.
 * Route: POST /api/v1/payments/webhook
 */
export const handleWebhook = async (req: Request, res: Response) => {
    try {
        if (!PAYSTACK_SECRET) {
            res.status(500).json({ error: 'Paystack is not configured' });
            return;
        }

        const signature = getWebhookSignature(req);
        const rawBody = (req as Request & { rawBody?: string }).rawBody;
        if (!signature || !rawBody) {
            res.status(400).json({ error: 'Missing webhook signature' });
            return;
        }

        const expectedSignature = crypto
            .createHmac('sha512', PAYSTACK_SECRET)
            .update(rawBody)
            .digest('hex');

        if (signature !== expectedSignature) {
            res.status(401).json({ error: 'Invalid webhook signature' });
            return;
        }

        const event = req.body as { event?: string; data?: PaystackVerifyData };
        if (event.event !== 'charge.success' || !event.data) {
            res.status(200).json({ received: true, ignored: true });
            return;
        }

        const metadataType = event.data.metadata?.type;
        if (metadataType && metadataType !== 'wallet_deposit') {
            res.status(200).json({ received: true, ignored: true });
            return;
        }

        await creditWalletFromVerifiedPaystackData(event.data);
        res.status(200).json({ received: true });
    } catch (error: unknown) {
        if (error instanceof PaymentProcessingError) {
            // Acknowledge non-retriable business errors to avoid noisy retries.
            if (error.statusCode >= 400 && error.statusCode < 500) {
                res.status(200).json({ received: true, ignored: true });
                return;
            }
        }

        console.error('Paystack Webhook Error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

/**
 * Payment callback page for in-app/browser checkout return.
 * Route: GET /api/v1/payments/callback
 */
export const paymentCallback = async (req: Request, res: Response) => {
    const reference = typeof req.query.reference === 'string'
        ? req.query.reference
        : '';
    const status = typeof req.query.status === 'string'
        ? req.query.status
        : '';

    res.status(200).type('html').send(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment Return</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #111827; }
      .card { max-width: 520px; margin: 48px auto; background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
      h1 { margin: 0 0 12px; font-size: 20px; }
      p { margin: 8px 0; line-height: 1.5; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Payment Return</h1>
      <p>Your checkout flow is complete. Return to the AquaFeed app and tap <strong>Verify</strong> to credit your wallet.</p>
      ${status ? `<p>Status: <code>${status}</code></p>` : ''}
      ${reference ? `<p>Reference: <code>${reference}</code></p>` : ''}
    </div>
  </body>
</html>`);
};

/**
 * Get User Transactions
 */
export const getTransactions = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const transactions = await Transaction.find({ userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        res.json({ data: transactions });
    } catch (error) {
        console.error('Get Transactions Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Grant Full Access (legacy wallet deduction flow)
 */
export const grantFullAccess = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        if (user.hasFullAccess) {
            res.json({ success: true, message: 'You already have full access' });
            return;
        }

        const ACCESS_COST = 10000;
        if (user.walletBalance >= ACCESS_COST) {
            user.walletBalance -= ACCESS_COST;
            user.hasFullAccess = true;
            await user.save();

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
                },
            });
        } else {
            res.status(400).json({
                error: 'Insufficient wallet balance',
                required: ACCESS_COST,
                current: user.walletBalance,
            });
        }
    } catch (error) {
        console.error('Grant Access Error:', error);
        res.status(500).json({ error: 'Failed to grant access' });
    }
};

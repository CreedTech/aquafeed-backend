import { Request, Response } from 'express';
import User from '../../models/User';
import FarmProfile from '../../models/FarmProfile';
import Transaction from '../../models/Transaction';
import Ingredient from '../../models/Ingredient';
import Formulation from '../../models/Formulation';
import Configuration from '../../models/Configuration';
import FeedTemplate from '../../models/FeedTemplate';
import AiInteraction from '../../models/AiInteraction';
import AiJob from '../../models/AiJob';
import AiJobEvent from '../../models/AiJobEvent';
import { Types } from 'mongoose';
import { configService } from '../../services/config.service';
import {
    buildCalculationLedger,
    buildFormulationExport,
    getAnalyticsOverview,
    getAnalyticsTrends,
    getFormulationWithStandard
} from '../../services/formulation-intelligence.service';
import { openRouterService } from '../../services/openrouter.service';

const CANONICAL_UNLOCK_FEE_KEY = 'formulation_fee';
const LEGACY_UNLOCK_FEE_KEY = 'formulation_unlock_fee';
type ConfigurationRecord = {
    key: string;
    value: unknown;
    description?: string;
    category: 'FINANCIAL' | 'SCIENTIFIC' | 'SOLVER' | 'SYSTEM';
    updatedAt?: Date;
    [key: string]: unknown;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseBooleanQuery = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseDateQuery = (value: unknown): Date | undefined => {
    if (!value) return undefined;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseFeedTypeQuery = (value: unknown): 'fish' | 'poultry' | undefined => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'fish' || normalized === 'poultry') return normalized;
    return undefined;
};

const parsePositiveIntQuery = (value: unknown, fallback: number, min = 1, max = 200): number => {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

/**
 * Get all users with pagination and filtering
 */
export const getAllUsers = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const { role, search } = req.query;

        const query: any = {};
        if (role) query.role = role;
        if (search) {
            query.$or = [
                { email: { $regex: search, $options: 'i' } },
                { name: { $regex: search, $options: 'i' } }
            ];
        }

        const users = await User.find(query)
            .select('-password') // Exclude password if it existed
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await User.countDocuments(query);

        res.json({
            data: users,
            meta: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get Users Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Block/Unblock a user
 */
export const toggleUserBlock = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body; // true or false

        const user = await User.findByIdAndUpdate(
            id,
            { isActive },
            { new: true }
        ).select('-password');

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // Also update their farm profiles
        await FarmProfile.updateMany({ userId: id }, { isActive });

        res.json({ message: `User ${isActive ? 'unblocked' : 'blocked'} successfully`, user });

    } catch (error) {
        console.error('Toggle Block Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get System Statistics
 */
export const getSystemStats = async (_req: Request, res: Response) => {
    try {
        const [
            totalUsers,
            activeFarms,
            totalRevenue,
            totalIngredients,
            totalFormulations
        ] = await Promise.all([
            User.countDocuments({ role: 'farmer' }),
            FarmProfile.countDocuments({ isActive: true }),
            Transaction.aggregate([
                { $match: { type: 'credit', status: 'success' } }, // Total deposits into system
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Ingredient.countDocuments({}),
            Formulation.countDocuments({})
        ]);

        res.json({
            users: totalUsers,
            activeFarms,
            platformRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
            ingredients: totalIngredients,
            formulations: totalFormulations
        });

    } catch (error) {
        console.error('System Stats Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get Chart Data for Dashboard (Real Data)
 */
export const getChartData = async (_req: Request, res: Response) => {
    try {
        // Revenue by month (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const revenueByMonth = await Transaction.aggregate([
            { $match: { type: 'credit', status: 'success', createdAt: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                    value: { $sum: '$amount' }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { name: '$_id', value: 1, _id: 0 } }
        ]);

        // Formulations by status
        const [unlockedCount, demoCount, lockedCount] = await Promise.all([
            Formulation.countDocuments({ isUnlocked: true }),
            Formulation.countDocuments({ isDemo: true }),
            Formulation.countDocuments({ isUnlocked: false, isDemo: false })
        ]);

        const formulationsByStatus = [
            { name: 'Unlocked', value: unlockedCount, color: '#0EA27E' },
            { name: 'Demo', value: demoCount, color: '#6B7280' },
            { name: 'Locked', value: lockedCount, color: '#F59E0B' }
        ];

        // Formulations per day (last 7 days) - Use $dayOfWeek since %a is not valid in MongoDB
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const formulationsRaw = await Formulation.aggregate([
            { $match: { createdAt: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dayOfWeek: '$createdAt' },
                    value: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);
        const formulationsPerDay = formulationsRaw.map(d => ({
            name: dayNames[d._id - 1] || 'Unknown',
            value: d.value
        }));

        // User signups trend (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const userSignups = await User.aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    value: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } },
            { $project: { name: '$_id', value: 1, _id: 0 } }
        ]);

        res.json({
            revenueByMonth,
            formulationsByStatus,
            formulationsPerDay,
            userSignups
        });

    } catch (error) {
        console.error('Chart Data Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get AI usage telemetry summary
 * GET /api/v1/admin/ai/usage-summary
 */
export const getAiUsageSummary = async (req: Request, res: Response) => {
    try {
        const from = parseDateQuery(req.query.from);
        const to = parseDateQuery(req.query.to);
        const match: Record<string, unknown> = {};
        if (from || to) {
            const createdAt: Record<string, Date> = {};
            if (from) createdAt.$gte = from;
            if (to) createdAt.$lte = to;
            match.createdAt = createdAt;
        }

        const [totalsRows, modelRows, dayRows, verificationRows] = await Promise.all([
            AiInteraction.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: null,
                        interactions: { $sum: 1 },
                        successCount: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'success'] }, 1, 0]
                            }
                        },
                        fallbackCount: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'fallback'] }, 1, 0]
                            }
                        },
                        errorCount: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'error'] }, 1, 0]
                            }
                        },
                        totalTokens: { $sum: '$totalTokens' },
                        estimatedCostUsd: { $sum: '$estimatedCostUsd' },
                        avgLatencyMs: { $avg: '$latencyMs' }
                    }
                }
            ]),
            AiInteraction.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$modelUsed',
                        count: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        estimatedCostUsd: { $sum: '$estimatedCostUsd' }
                    }
                },
                { $sort: { count: -1 } }
            ]),
            AiInteraction.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: '%Y-%m-%d',
                                date: '$createdAt'
                            }
                        },
                        count: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                        estimatedCostUsd: { $sum: '$estimatedCostUsd' }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            AiInteraction.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: '$verificationStatus',
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        const totals = totalsRows[0] || {
            interactions: 0,
            successCount: 0,
            fallbackCount: 0,
            errorCount: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            avgLatencyMs: 0
        };

        const verification = verificationRows.reduce<Record<string, number>>((acc, row) => {
            const key = String(row._id || 'unknown');
            acc[key] = Number(row.count || 0);
            return acc;
        }, { passed: 0, failed: 0 });

        return res.json({
            totals: {
                interactions: Number(totals.interactions || 0),
                successCount: Number(totals.successCount || 0),
                fallbackCount: Number(totals.fallbackCount || 0),
                errorCount: Number(totals.errorCount || 0),
                totalTokens: Number(totals.totalTokens || 0),
                estimatedCostUsd: Number(Number(totals.estimatedCostUsd || 0).toFixed(8)),
                avgLatencyMs: Number(Number(totals.avgLatencyMs || 0).toFixed(2)),
                verification
            },
            byModel: modelRows.map((row) => ({
                model: String(row._id || 'unknown'),
                count: Number(row.count || 0),
                totalTokens: Number(row.totalTokens || 0),
                estimatedCostUsd: Number(Number(row.estimatedCostUsd || 0).toFixed(8))
            })),
            daily: dayRows.map((row) => ({
                date: String(row._id),
                count: Number(row.count || 0),
                totalTokens: Number(row.totalTokens || 0),
                estimatedCostUsd: Number(Number(row.estimatedCostUsd || 0).toFixed(8))
            }))
        });
    } catch (error) {
        console.error('Get AI usage summary error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get detailed AI interaction logs (admin diagnostics).
 * GET /api/v1/admin/ai/logs
 */
export const getAiLogs = async (req: Request, res: Response) => {
    try {
        const page = parsePositiveIntQuery(req.query.page, 1, 1, 100000);
        const limit = parsePositiveIntQuery(req.query.limit, 25, 1, 200);
        const skip = (page - 1) * limit;
        const includeFull = parseBooleanQuery(req.query.full) === true;

        const from = parseDateQuery(req.query.from);
        const to = parseDateQuery(req.query.to);
        const query: Record<string, unknown> = {};
        if (from || to) {
            const createdAt: Record<string, Date> = {};
            if (from) createdAt.$gte = from;
            if (to) createdAt.$lte = to;
            query.createdAt = createdAt;
        }

        const status = String(req.query.status || '').trim().toLowerCase();
        if (['success', 'fallback', 'error'].includes(status)) {
            query.status = status;
        }
        const verificationStatus = String(req.query.verificationStatus || '').trim().toLowerCase();
        if (['passed', 'failed', 'not_applicable'].includes(verificationStatus)) {
            query.verificationStatus = verificationStatus;
        }
        const kind = String(req.query.kind || '').trim().toLowerCase();
        if (['query', 'what_if'].includes(kind)) {
            query.kind = kind;
        }

        const requestId = String(req.query.requestId || '').trim();
        if (requestId) query.requestId = requestId;
        const modelUsed = String(req.query.modelUsed || '').trim();
        if (modelUsed) query.modelUsed = modelUsed;

        const userId = String(req.query.userId || '').trim();
        if (userId && Types.ObjectId.isValid(userId)) {
            query.userId = new Types.ObjectId(userId);
        }
        const threadId = String(req.query.threadId || '').trim();
        if (threadId && Types.ObjectId.isValid(threadId)) {
            query.threadId = new Types.ObjectId(threadId);
        }
        const jobId = String(req.query.jobId || '').trim();
        if (jobId && Types.ObjectId.isValid(jobId)) {
            query.jobId = new Types.ObjectId(jobId);
        }

        const search = String(req.query.search || '').trim();
        if (search) {
            const safeRegex = new RegExp(escapeRegex(search), 'i');
            query.$or = [
                { prompt: safeRegex },
                { answer: safeRegex },
                { fallbackMessage: safeRegex },
                { errorMessage: safeRegex }
            ];
        }

        const [rows, total] = await Promise.all([
            AiInteraction.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AiInteraction.countDocuments(query)
        ]);

        return res.json({
            data: rows.map((row: any) => {
                const mapped = {
                    id: String(row._id),
                    createdAt: row.createdAt,
                    userId: row.userId ? String(row.userId) : null,
                    threadId: row.threadId ? String(row.threadId) : null,
                    jobId: row.jobId ? String(row.jobId) : null,
                    requestId: row.requestId || null,
                    kind: row.kind,
                    status: row.status,
                    verificationStatus: row.verificationStatus,
                    modelUsed: row.modelUsed || null,
                    modelPrimary: row.modelPrimary,
                    modelFallback: row.modelFallback,
                    fallbackUsed: row.fallbackUsed === true,
                    latencyMs: Number(row.latencyMs || 0),
                    queueWaitMs: Number(row.queueWaitMs || 0),
                    processingMs: Number(row.processingMs || 0),
                    promptTokens: Number(row.promptTokens || 0),
                    completionTokens: Number(row.completionTokens || 0),
                    totalTokens: Number(row.totalTokens || 0),
                    estimatedCostUsd: Number(row.estimatedCostUsd || 0),
                    pricingSource: row.pricingSource || 'unknown',
                    verificationErrors: Array.isArray(row.verificationErrors) ? row.verificationErrors : [],
                    retrievalSummary: row.retrievalSummary || null,
                    attempts: Array.isArray(row.attempts) ? row.attempts : [],
                    promptPreview: String(row.prompt || '').slice(0, 220),
                    answerPreview: String(row.answer || '').slice(0, 220),
                    fallbackPreview: String(row.fallbackMessage || '').slice(0, 220),
                    errorMessage: row.errorMessage || null
                } as Record<string, unknown>;
                if (includeFull) {
                    mapped.prompt = row.prompt || '';
                    mapped.answer = row.answer || '';
                    mapped.fallbackMessage = row.fallbackMessage || '';
                    mapped.citations = Array.isArray(row.citations) ? row.citations : [];
                    mapped.numericClaims = Array.isArray(row.numericClaims) ? row.numericClaims : [];
                }
                return mapped;
            }),
            meta: {
                page,
                limit,
                total,
                pages: Math.max(1, Math.ceil(total / limit))
            }
        });
    } catch (error) {
        console.error('Get AI logs error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get full trace for an AI job including SSE events and interactions.
 * GET /api/v1/admin/ai/jobs/:jobId/trace
 */
export const getAiJobTrace = async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;
        if (!Types.ObjectId.isValid(jobId)) {
            return res.status(400).json({ error: 'Invalid job id' });
        }
        const jobObjectId = new Types.ObjectId(jobId);
        const job = await AiJob.findById(jobObjectId).lean();
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const [events, interactions] = await Promise.all([
            AiJobEvent.find({ jobId: jobObjectId }).sort({ createdAt: 1 }).lean(),
            AiInteraction.find({
                $or: [
                    { jobId: jobObjectId },
                    ...(job.requestId ? [{ requestId: job.requestId }] : [])
                ]
            }).sort({ createdAt: 1 }).lean()
        ]);

        return res.json({
            job: {
                id: String(job._id),
                userId: String(job.userId),
                threadId: String(job.threadId),
                userMessageId: job.userMessageId ? String(job.userMessageId) : null,
                assistantMessageId: job.assistantMessageId ? String(job.assistantMessageId) : null,
                requestId: job.requestId,
                question: job.question,
                modelId: job.modelId || null,
                streamRequested: job.streamRequested !== false,
                context: {
                    formulationId: job.context?.formulationId ? String(job.context.formulationId) : null,
                    feedType: job.context?.feedType || null,
                    stageCode: job.context?.stageCode || null
                },
                status: job.status,
                result: job.result || null,
                errorMessage: job.errorMessage || null,
                startedAt: job.startedAt || null,
                completedAt: job.completedAt || null,
                cancelledAt: job.cancelledAt || null,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt
            },
            events: events.map((event: any) => ({
                id: String(event._id),
                eventType: event.eventType,
                payload: event.payload || {},
                createdAt: event.createdAt
            })),
            interactions: interactions.map((row: any) => ({
                id: String(row._id),
                status: row.status,
                verificationStatus: row.verificationStatus,
                modelUsed: row.modelUsed || null,
                fallbackUsed: row.fallbackUsed === true,
                latencyMs: Number(row.latencyMs || 0),
                totalTokens: Number(row.totalTokens || 0),
                estimatedCostUsd: Number(row.estimatedCostUsd || 0),
                prompt: row.prompt || '',
                answer: row.answer || '',
                fallbackMessage: row.fallbackMessage || '',
                verificationErrors: Array.isArray(row.verificationErrors) ? row.verificationErrors : [],
                createdAt: row.createdAt
            }))
        });
    } catch (error) {
        console.error('Get AI job trace error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get OpenRouter model catalog for admin dropdown configuration.
 * GET /api/v1/admin/ai/openrouter-models?freeOnly=true|false
 */
export const getOpenRouterModels = async (req: Request, res: Response) => {
    try {
        const freeOnly = parseBooleanQuery(req.query.freeOnly);
        const forceRefresh = parseBooleanQuery(req.query.forceRefresh);
        const models = await openRouterService.getModels({
            ...(freeOnly !== undefined ? { freeOnly } : {}),
            ...(forceRefresh !== undefined ? { forceRefresh } : {})
        });
        return res.json({
            models
        });
    } catch (error) {
        console.error('Get OpenRouter Models Error:', error);
        return res.status(500).json({
            error: 'Failed to fetch OpenRouter models',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Admin: Get platform or per-user formulation analytics overview.
 * GET /api/v1/admin/formulations/analytics/overview
 */
export const getFormulationAnalyticsOverviewAdmin = async (req: Request, res: Response) => {
    try {
        const from = parseDateQuery(req.query.from);
        const to = parseDateQuery(req.query.to);
        const feedType = parseFeedTypeQuery(req.query.feedType);
        const stageCode = String(req.query.stageCode || '').trim().toUpperCase() || undefined;
        const userId = Types.ObjectId.isValid(String(req.query.userId || ''))
            ? String(req.query.userId)
            : undefined;

        const overview = await getAnalyticsOverview({
            userId,
            from,
            to,
            feedType,
            stageCode
        });
        return res.json(overview);
    } catch (error) {
        console.error('Admin overview analytics error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Admin: Get platform or per-user formulation trend analytics.
 * GET /api/v1/admin/formulations/analytics/trends
 */
export const getFormulationAnalyticsTrendsAdmin = async (req: Request, res: Response) => {
    try {
        const metricParam = String(req.query.metric || 'costPerKg');
        const metric = (
            metricParam === 'qualityMatch' || metricParam === 'complianceRate'
                ? metricParam
                : 'costPerKg'
        ) as 'costPerKg' | 'qualityMatch' | 'complianceRate';
        const interval = String(req.query.interval || 'week') === 'day' ? 'day' : 'week';
        const from = parseDateQuery(req.query.from);
        const to = parseDateQuery(req.query.to);
        const feedType = parseFeedTypeQuery(req.query.feedType);
        const stageCode = String(req.query.stageCode || '').trim().toUpperCase() || undefined;
        const userId = Types.ObjectId.isValid(String(req.query.userId || ''))
            ? String(req.query.userId)
            : undefined;

        const points = await getAnalyticsTrends({
            userId,
            metric,
            interval,
            from,
            to,
            feedType,
            stageCode
        });

        return res.json({
            metric,
            interval,
            points
        });
    } catch (error) {
        console.error('Admin trend analytics error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Admin: Get calculation ledger for any formulation
 * GET /api/v1/admin/formulations/:id/calculation-ledger
 */
export const getFormulationCalculationLedgerAdmin = async (req: Request, res: Response) => {
    try {
        const formulation = await getFormulationWithStandard(req.params.id);
        if (!formulation) {
            return res.status(404).json({ error: 'Formulation not found' });
        }
        const ledger = buildCalculationLedger(formulation);
        return res.json(ledger);
    } catch (error) {
        console.error('Admin get formulation calculation ledger error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Admin: Export any formulation report as CSV or PDF
 * POST /api/v1/admin/formulations/:id/export
 */
export const exportFormulationReportAdmin = async (req: Request, res: Response) => {
    try {
        const formatInput = String(req.body?.format || 'csv').toLowerCase();
        const format = (formatInput === 'pdf' ? 'pdf' : 'csv') as 'csv' | 'pdf';
        const formulation = await getFormulationWithStandard(req.params.id);
        if (!formulation) {
            return res.status(404).json({ error: 'Formulation not found' });
        }

        const ledger = buildCalculationLedger(formulation);
        const exported = buildFormulationExport(ledger, format);
        res.setHeader('Content-Type', exported.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
        return res.send(exported.data);
    } catch (error) {
        console.error('Admin export formulation report error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update user details (role, wallet, access)
 */
export const updateUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, role, walletBalance, hasFullAccess } = req.body;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (role !== undefined) updateData.role = role;
        if (walletBalance !== undefined) updateData.walletBalance = walletBalance;
        if (hasFullAccess !== undefined) updateData.hasFullAccess = hasFullAccess;

        const user = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        res.json({ message: 'User updated successfully', user });

    } catch (error) {
        console.error('Update User Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get all formulations (Admin view)
 */
export const getAllFormulations = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;
        const userId = req.query.userId as string;
        const search = req.query.search as string;
        const compliance = req.query.compliance as string;
        const status = req.query.status as string;

        const query: any = {};
        if (userId) query.userId = userId;
        if (search) query.batchName = { $regex: search, $options: 'i' };
        if (compliance) query.complianceColor = compliance;

        // Status filtering logic
        if (status === 'unlocked') {
            query.isUnlocked = true;
        } else if (status === 'demo') {
            query.isDemo = true;
        } else if (status === 'locked') {
            query.isUnlocked = false;
            query.isDemo = false;
        }

        const formulations = await Formulation.find(query)
            .populate('userId', 'name email')
            .populate('standardUsed', 'name fishType stage')
            .populate('ingredientsUsed.ingredientId', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Formulation.countDocuments(query);

        res.json({
            data: formulations,
            meta: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Get Formulations Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get all transactions (Admin view)
 */
export const getAllTransactions = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;
        const userId = req.query.userId as string;
        const type = req.query.type as string;
        const status = req.query.status as string;

        const query: any = {};
        if (userId) query.userId = userId;
        if (type) query.type = type;
        if (status) query.status = status;

        const transactions = await Transaction.find(query)
            .populate('userId', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Transaction.countDocuments(query);

        // Get totals for summary
        const totals = await Transaction.aggregate([
            { $match: { status: 'success' } },
            { $group: { _id: '$type', total: { $sum: '$amount' } } }
        ]);

        const credits = totals.find(t => t._id === 'credit')?.total || 0;
        const debits = totals.find(t => t._id === 'debit')?.total || 0;

        res.json({
            data: transactions,
            meta: { page, limit, total, pages: Math.ceil(total / limit) },
            summary: { credits, debits }
        });
    } catch (error) {
        console.error('Get Transactions Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get all farm profiles (Admin view)
 */
export const getAllFarmProfiles = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search as string;

        const query: any = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { 'location.state': { $regex: search, $options: 'i' } },
                { 'location.lga': { $regex: search, $options: 'i' } },
                // Simple location string fallback
                { location: { $regex: search, $options: 'i' } }
            ];
        }

        const farms = await FarmProfile.find(query)
            .populate('userId', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await FarmProfile.countDocuments(query);

        res.json({
            data: farms,
            meta: { page, limit, total, pages: Math.ceil(total / limit) }
        });
    } catch (error) {
        console.error('Get Farm Profiles Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Delete a formulation
 */
export const deleteFormulation = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const formulation = await Formulation.findByIdAndDelete(id);

        if (!formulation) {
            res.status(404).json({ error: 'Formulation not found' });
            return;
        }

        res.json({ message: 'Formulation deleted successfully' });
    } catch (error) {
        console.error('Delete Formulation Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Delete a transaction
 */
export const deleteTransaction = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findByIdAndDelete(id);

        if (!transaction) {
            res.status(404).json({ error: 'Transaction not found' });
            return;
        }

        res.json({ message: 'Transaction deleted successfully' });
    } catch (error) {
        console.error('Delete Transaction Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Delete a farm profile
 */
export const deleteFarmProfile = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const farm = await FarmProfile.findByIdAndDelete(id);

        if (!farm) {
            res.status(404).json({ error: 'Farm profile not found' });
            return;
        }

        res.json({ message: 'Farm profile deleted successfully' });
    } catch (error) {
        console.error('Delete Farm Profile Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Bulk Block/Unblock Users
 */
export const bulkBlockUsers = async (req: Request, res: Response) => {
    try {
        const { ids, isActive } = req.body; // ids: string[], isActive: boolean

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'No user IDs provided' });
            return;
        }

        // Update users
        await User.updateMany(
            { _id: { $in: ids } },
            { isActive }
        );

        // Update connected farms
        await FarmProfile.updateMany(
            { userId: { $in: ids } },
            { isActive }
        );

        res.json({ message: `Successfully ${isActive ? 'unblocked' : 'blocked'} ${ids.length} users` });
    } catch (error) {
        console.error('Bulk Block Users Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Bulk Delete Formulations
 */
export const bulkDeleteFormulations = async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'No formulation IDs provided' });
            return;
        }

        await Formulation.deleteMany({ _id: { $in: ids } });

        res.json({ message: `Successfully deleted ${ids.length} formulations` });
    } catch (error) {
        console.error('Bulk Delete Formulations Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Bulk Delete Transactions
 */
export const bulkDeleteTransactions = async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'No transaction IDs provided' });
            return;
        }

        await Transaction.deleteMany({ _id: { $in: ids } });

        res.json({ message: `Successfully deleted ${ids.length} transactions` });
    } catch (error) {
        console.error('Bulk Delete Transactions Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Bulk Delete Farms
 */
export const bulkDeleteFarms = async (req: Request, res: Response) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: 'No farm IDs provided' });
            return;
        }

        await FarmProfile.deleteMany({ _id: { $in: ids } });

        res.json({ message: `Successfully deleted ${ids.length} farms` });
    } catch (error) {
        console.error('Bulk Delete Farms Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
/**
 * Get all system configurations
 */
export const getConfigurations = async (_req: Request, res: Response) => {
    try {
        const rawConfigurations = await Configuration.find()
            .sort({ category: 1, key: 1 })
            .lean<ConfigurationRecord[]>();

        const canonicalUnlockFee = rawConfigurations.find(
            (config) => config.key === CANONICAL_UNLOCK_FEE_KEY
        );
        const legacyUnlockFee = rawConfigurations.find(
            (config) => config.key === LEGACY_UNLOCK_FEE_KEY
        );

        const effectiveUnlockFee = (() => {
            if (canonicalUnlockFee && legacyUnlockFee) {
                const canonicalUpdatedAt = canonicalUnlockFee.updatedAt
                    ? new Date(canonicalUnlockFee.updatedAt).getTime()
                    : 0;
                const legacyUpdatedAt = legacyUnlockFee.updatedAt
                    ? new Date(legacyUnlockFee.updatedAt).getTime()
                    : 0;

                return canonicalUpdatedAt >= legacyUpdatedAt
                    ? canonicalUnlockFee
                    : legacyUnlockFee;
            }
            return canonicalUnlockFee || legacyUnlockFee;
        })();

        const configurations = rawConfigurations
            .filter(
                (config) =>
                    config.key !== CANONICAL_UNLOCK_FEE_KEY &&
                    config.key !== LEGACY_UNLOCK_FEE_KEY
            )
            .map((config) => ({ ...config }));

        if (effectiveUnlockFee) {
            configurations.push({
                ...effectiveUnlockFee,
                key: CANONICAL_UNLOCK_FEE_KEY,
                description:
                    effectiveUnlockFee.description ||
                    'Cost to unlock a full formulation recipe in Naira'
            });
        }

        configurations.sort((a, b) => {
            const categoryCompare = a.category.localeCompare(b.category);
            if (categoryCompare !== 0) return categoryCompare;
            return a.key.localeCompare(b.key);
        });

        res.json({ configurations });
    } catch (error) {
        console.error('Get Configurations Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update a specific configuration
 */
export const updateConfiguration = async (req: Request, res: Response) => {
    try {
        const { key } = req.params;
        const { value } = req.body;
        const userId = (req as any).user?._id;
        const normalizedKey = key === LEGACY_UNLOCK_FEE_KEY ? CANONICAL_UNLOCK_FEE_KEY : key;

        const config = await Configuration.findOneAndUpdate(
            { key: normalizedKey },
            { value, updatedBy: userId },
            { new: true, upsert: true }
        );

        if (normalizedKey === CANONICAL_UNLOCK_FEE_KEY) {
            await Configuration.deleteOne({ key: LEGACY_UNLOCK_FEE_KEY });
        }

        // Ensure runtime readers get the latest values immediately.
        configService.clearCache();

        res.json({ message: 'Configuration updated successfully', configuration: config });
    } catch (error) {
        console.error('Update Configuration Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Admin: Get all feed templates
 */
export const getAllTemplatesAdmin = async (req: Request, res: Response) => {
    try {
        const { search, sortKey, sortDirection } = req.query;
        const query: Record<string, unknown> = {};

        if (
            req.query.feedCategory &&
            ['Catfish', 'Poultry'].includes(String(req.query.feedCategory))
        ) {
            query.feedCategory = String(req.query.feedCategory);
        }

        const active = parseBooleanQuery(req.query.active);
        if (active !== undefined) {
            query.isActive = active;
        }

        const normalizedSearch = String(search || '').trim();
        if (normalizedSearch) {
            const pattern = escapeRegex(normalizedSearch);
            query.$or = [
                { name: { $regex: pattern, $options: 'i' } },
                { description: { $regex: pattern, $options: 'i' } },
                { stage: { $regex: pattern, $options: 'i' } }
            ];
        }

        const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
        const page = clamp(parseInt(String(req.query.page || '1'), 10) || 1, 1, 100000);
        const limit = clamp(parseInt(String(req.query.limit || '20'), 10) || 20, 1, 200);
        const skip = (page - 1) * limit;

        const sortFieldMap: Record<string, string> = {
            name: 'name',
            feedCategory: 'feedCategory',
            stage: 'stage',
            items: 'itemCount',
            status: 'isActive',
            createdAt: 'createdAt'
        };
        const resolvedSortField = sortFieldMap[String(sortKey || '')] || 'name';
        const resolvedSortDirection = String(sortDirection || '').toLowerCase() === 'desc' ? -1 : 1;

        const basePipeline: any[] = [
            { $match: query },
            {
                $addFields: {
                    itemCount: { $size: { $ifNull: ['$ingredientNames', []] } }
                }
            }
        ];

        const [templates, filteredTotal, summaryRows] = await Promise.all([
            FeedTemplate.aggregate([
                ...basePipeline,
                { $sort: { [resolvedSortField]: resolvedSortDirection, name: 1 } },
                ...(hasPagination ? [{ $skip: skip }, { $limit: limit }] : [])
            ]),
            FeedTemplate.countDocuments(query),
            FeedTemplate.aggregate([
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        active: {
                            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
                        },
                        fish: {
                            $sum: { $cond: [{ $eq: ['$feedCategory', 'Catfish'] }, 1, 0] }
                        },
                        poultry: {
                            $sum: { $cond: [{ $eq: ['$feedCategory', 'Poultry'] }, 1, 0] }
                        }
                    }
                }
            ])
        ]);

        const uniqueIngredientNames = Array.from(new Set(
            templates.flatMap((template: any) => (template.ingredientNames as string[]) || [])
        ));

        const ingredients = await Ingredient.find({
            name: { $in: uniqueIngredientNames }
        }).select('_id name').lean();
        const ingredientIdByName = new Map<string, string>(
            ingredients.map((ingredient) => [ingredient.name, ingredient._id.toString()])
        );

        const hydrated = templates.map((template: any) => {
            const totalWeight = 100;
            const ingredientCount = (template.ingredientNames || []).length || 1;
            const ratioPerIngredient = Number((100 / ingredientCount).toFixed(4));

            return {
                ...template,
                feedType: template.feedCategory === 'Poultry' ? 'poultry' : 'fish',
                fishSubtype: template.feedCategory === 'Poultry' ? undefined : 'catfish',
                totalWeight,
                stage: template.stage || '',
                items: (template.ingredientNames || [])
                    .map((name: string) => ({
                        ingredientId: ingredientIdByName.get(name) || '',
                        ratio: ratioPerIngredient,
                        ingredientName: name
                    }))
                    .filter((item: { ingredientId: string }) => item.ingredientId !== '')
            };
        });

        const summary = summaryRows[0] || { total: 0, active: 0, fish: 0, poultry: 0 };
        const payload: Record<string, unknown> = {
            templates: hydrated,
            count: hydrated.length,
            filteredTotal,
            summary: {
                total: Number(summary.total || 0),
                active: Number(summary.active || 0),
                inactive: Math.max(0, Number(summary.total || 0) - Number(summary.active || 0)),
                fish: Number(summary.fish || 0),
                poultry: Number(summary.poultry || 0)
            },
            filterOptions: {
                feedCategories: ['Catfish', 'Poultry']
            }
        };

        if (hasPagination) {
            payload.meta = {
                page,
                limit,
                total: filteredTotal,
                pages: Math.max(1, Math.ceil(filteredTotal / limit)),
                hasNext: skip + hydrated.length < filteredTotal,
                hasPrev: page > 1
            };
        }

        res.json(payload);
    } catch (error) {
        console.error('Get All Templates Admin Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Admin: Create a new feed template
 */
export const createTemplateAdmin = async (req: Request, res: Response) => {
    try {
        const {
            items,
            ingredientNames,
            feedType,
            fishSubtype,
            feedCategory,
            ...rest
        } = req.body as {
            items?: Array<{ ingredientId: string; ratio: number }>;
            ingredientNames?: string[];
            feedType?: 'fish' | 'poultry';
            fishSubtype?: string;
            feedCategory?: 'Catfish' | 'Poultry';
            [key: string]: unknown;
        };

        let mappedIngredientNames: string[] = ingredientNames || [];
        if (Array.isArray(items) && items.length > 0) {
            const ingredientIds = items
                .map((item) => item.ingredientId)
                .filter((id): id is string => Types.ObjectId.isValid(id));
            const ingredients = await Ingredient.find({ _id: { $in: ingredientIds } })
                .select('name')
                .lean();
            mappedIngredientNames = ingredients.map((ingredient) => ingredient.name);
        }

        const normalizedFeedCategory = feedCategory
            || (feedType === 'poultry' ? 'Poultry' : 'Catfish');

        const template = await FeedTemplate.create({
            ...rest,
            feedCategory: normalizedFeedCategory,
            fishSubtype,
            ingredientNames: mappedIngredientNames
        });
        res.status(201).json({ message: 'Template created', template });
    } catch (error) {
        console.error('Create Template Admin Error:', error);
        res.status(400).json({ error: 'Failed to create template' });
    }
};

/**
 * Admin: Update a feed template
 */
export const updateTemplateAdmin = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const {
            items,
            ingredientNames,
            feedType,
            feedCategory,
            ...rest
        } = req.body as {
            items?: Array<{ ingredientId: string; ratio: number }>;
            ingredientNames?: string[];
            feedType?: 'fish' | 'poultry';
            feedCategory?: 'Catfish' | 'Poultry';
            [key: string]: unknown;
        };

        let mappedIngredientNames: string[] | undefined = ingredientNames;
        if (Array.isArray(items)) {
            const ingredientIds = items
                .map((item) => item.ingredientId)
                .filter((itemId): itemId is string => Types.ObjectId.isValid(itemId));
            const ingredients = await Ingredient.find({ _id: { $in: ingredientIds } })
                .select('name')
                .lean();
            mappedIngredientNames = ingredients.map((ingredient) => ingredient.name);
        }

        const normalizedFeedCategory = feedCategory
            || (feedType ? (feedType === 'poultry' ? 'Poultry' : 'Catfish') : undefined);

        const updatePayload = {
            ...rest,
            ...(normalizedFeedCategory ? { feedCategory: normalizedFeedCategory } : {}),
            ...(mappedIngredientNames ? { ingredientNames: mappedIngredientNames } : {})
        };

        const template = await FeedTemplate.findByIdAndUpdate(id, updatePayload, { new: true });
        if (!template) {
            res.status(404).json({ error: 'Template not found' });
            return;
        }
        res.json({ message: 'Template updated', template });
    } catch (error) {
        console.error('Update Template Admin Error:', error);
        res.status(400).json({ error: 'Failed to update template' });
    }
};

/**
 * Admin: Delete a feed template
 */
export const deleteTemplateAdmin = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const template = await FeedTemplate.findByIdAndDelete(id);
        if (!template) {
            res.status(404).json({ error: 'Template not found' });
            return;
        }
        res.json({ message: 'Template deleted' });
    } catch (error) {
        console.error('Delete Template Admin Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

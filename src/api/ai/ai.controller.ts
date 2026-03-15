import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import AiInteraction from '../../models/AiInteraction';
import AiConversation from '../../models/AiConversation';
import AiMessage from '../../models/AiMessage';
import AiJob from '../../models/AiJob';
import AiJobEvent from '../../models/AiJobEvent';
import FeedStandard from '../../models/FeedStandard';
import Formulation from '../../models/Formulation';
import Batch from '../../models/Batch';
import DailyLog from '../../models/DailyLog';
import UserInventory from '../../models/UserInventory';
import Expense from '../../models/Expense';
import Revenue from '../../models/Revenue';
import { configService } from '../../services/config.service';
import {
    buildCalculationLedger,
    buildFactPack,
    getAnalyticsOverview,
    getFormulationWithStandardForUser
} from '../../services/formulation-intelligence.service';
import { openRouterService } from '../../services/openrouter.service';
import { aiStreamService } from '../../services/ai-stream.service';
import { resolveCanonicalStageCode } from '../../utils/stage-code.util';

type NumericClaim = {
    label: string;
    value: number;
    unit?: string;
    factId: string;
};

type AiSource = {
    type?: string;
    title?: string;
    reference?: string;
};

type AiResponseBlock = {
    type: 'summary' | 'numbers_table' | 'actions' | 'warnings';
    title?: string;
    content?: string;
    rows?: Record<string, unknown>[];
};

type AiAnalystResponse = {
    answer: string;
    answerMarkdown: string;
    answerContent: string;
    thoughtProcess: string | null;
    rawContent: string;
    citations: string[];
    numericClaims: NumericClaim[];
    sources: AiSource[];
    responseBlocks: AiResponseBlock[];
    followUpPrompts: string[];
    confidence: number;
    reasoningSummary: string | null;
    toolTrace: Array<Record<string, unknown>>;
    verificationStatus: 'passed' | 'failed';
    fallbackMessage: string | null;
};

type GlobalFactPack = {
    facts: Record<string, { label: string; value: number | string; unit?: string }>;
    context: string;
};

type AskAnalystInput = {
    userId: string;
    kind: 'query' | 'what_if';
    question: string;
    formulationId?: string;
    feedType?: 'fish' | 'poultry';
    stageCode?: string;
    threadId?: string;
    modelId?: string;
    maxTokens?: number;
    requestId?: string;
    jobId?: string;
};

type ScenarioResult = {
    scenarioType: string;
    title: string;
    summary: string;
    deltas: {
        totalCost?: number;
        costPerKg?: number;
        qualityMatch?: number;
        complianceBefore?: string;
        complianceAfter?: string;
    };
    violations: string[];
    recommendations: string[];
    numericClaims: NumericClaim[];
    citations: string[];
};

type ThoughtExtraction = {
    answerContent: string;
    thoughtProcess: string | null;
    rawContent: string;
};

type MixIntentType = 'best_mix' | 'least_cost_mix' | 'improve_protein' | 'improve_compliance' | null;

const getAuthenticatedUserId = (req: Request): string | null => (
    req.userId || req.session?.userId || null
);

const normalizeClaims = (claims: unknown): NumericClaim[] => {
    if (!Array.isArray(claims)) return [];
    return claims
        .map<NumericClaim | null>((item) => {
            if (!item || typeof item !== 'object') return null;
            const typed = item as Record<string, unknown>;
            const value = Number(typed.value);
            if (!Number.isFinite(value)) return null;
            const factId = String(typed.factId || '').trim();
            if (!factId) return null;
            return {
                label: String(typed.label || 'Claim'),
                value,
                factId,
                ...(typed.unit ? { unit: String(typed.unit) } : {})
            };
        })
        .filter((item): item is NumericClaim => item !== null);
};

const verifyClaims = (
    claims: NumericClaim[],
    citations: string[],
    facts: Record<string, { label: string; value: number | string; unit?: string }>
) => {
    const errors: string[] = [];

    citations.forEach((citation) => {
        if (!facts[citation]) {
            errors.push(`Unknown citation: ${citation}`);
        }
    });

    claims.forEach((claim) => {
        const fact = facts[claim.factId];
        if (!fact) {
            errors.push(`Unknown factId for numeric claim: ${claim.factId}`);
            return;
        }
        const factValue = Number(fact.value);
        if (!Number.isFinite(factValue)) {
            errors.push(`Fact ${claim.factId} is not numeric`);
            return;
        }
        const tolerance = Math.max(0.01, Math.abs(factValue) * 0.001);
        if (Math.abs(claim.value - factValue) > tolerance) {
            errors.push(`Numeric mismatch for ${claim.factId}. expected=${factValue}, got=${claim.value}`);
        }
    });

    return {
        passed: errors.length === 0,
        errors
    };
};

const buildFallbackMessage = (ledger: ReturnType<typeof buildCalculationLedger>) => (
    [
        'Some generated numbers could not be verified, so this summary uses only verified formulation values.',
        '',
        'Verified snapshot:',
        `- Total cost: ${formatNgn(ledger.totals.totalCost)}`,
        `- Cost per kg: ${formatNgn(ledger.totals.costPerKg)}/kg`,
        `- Quality match: ${formatPercent(ledger.qualityMatchPercentage)}`,
        `- Compliance: ${ledger.complianceColor}`,
        '',
        'Ask any follow-up question normally and I will continue with verified calculations.'
    ].join('\n')
);

const buildGlobalFactPack = async (
    userId: string,
    feedType?: 'fish' | 'poultry',
    stageCode?: string
): Promise<GlobalFactPack> => {
    const overview = await getAnalyticsOverview({
        userId,
        ...(feedType ? { feedType } : {}),
        ...(stageCode ? { stageCode } : {})
    });

    const standardQuery: Record<string, unknown> = { isActive: true };
    if (feedType === 'fish') standardQuery.feedCategory = 'Catfish';
    if (feedType === 'poultry') standardQuery.feedCategory = 'Poultry';
    if (stageCode) standardQuery.stageCode = stageCode;
    const standard = await FeedStandard.findOne(standardQuery).lean();

    const facts: GlobalFactPack['facts'] = {
        'summary.total_mixes': {
            label: 'Total mixes',
            value: overview.summary.totalMixes
        },
        'summary.unlocked_mixes': {
            label: 'Unlocked mixes',
            value: overview.summary.unlockedMixes
        },
        'summary.unlock_conversion_pct': {
            label: 'Unlock conversion',
            value: overview.summary.unlockConversionPct,
            unit: '%'
        },
        'summary.compliance_rate_pct': {
            label: 'Compliance rate',
            value: overview.summary.complianceRatePct,
            unit: '%'
        },
        'summary.avg_quality_match_pct': {
            label: 'Average quality match',
            value: overview.summary.avgQualityMatch,
            unit: '%'
        },
        'summary.avg_cost_per_kg': {
            label: 'Average cost per kg',
            value: overview.summary.avgCostPerKg,
            unit: 'NGN/kg'
        },
        'summary.min_cost_per_kg': {
            label: 'Minimum cost per kg',
            value: overview.summary.minCostPerKg,
            unit: 'NGN/kg'
        },
        'summary.max_cost_per_kg': {
            label: 'Maximum cost per kg',
            value: overview.summary.maxCostPerKg,
            unit: 'NGN/kg'
        }
    };

    if (standard?.targetNutrients && typeof standard.targetNutrients === 'object') {
        Object.entries(standard.targetNutrients as Record<string, any>).forEach(([nutrient, range]) => {
            const min = Number(range?.min);
            const max = Number(range?.max);
            if (Number.isFinite(min)) {
                facts[`target.${nutrient}.min`] = {
                    label: `${nutrient} target min`,
                    value: min,
                    unit: nutrient === 'energy' ? 'kcal/kg' : '%'
                };
            }
            if (Number.isFinite(max)) {
                facts[`target.${nutrient}.max`] = {
                    label: `${nutrient} target max`,
                    value: max,
                    unit: nutrient === 'energy' ? 'kcal/kg' : '%'
                };
            }
        });
    }

    const scopeLabel = [
        feedType ? `Feed Type: ${feedType}` : 'Feed Type: all',
        stageCode ? `Stage: ${stageCode}` : 'Stage: all'
    ].join(' | ');

    const context = [
        'Global formulation analytics context',
        scopeLabel,
        `Total mixes: ${overview.summary.totalMixes}`,
        `Compliance rate: ${overview.summary.complianceRatePct}%`,
        `Avg quality match: ${overview.summary.avgQualityMatch}%`,
        `Avg cost per kg: NGN ${overview.summary.avgCostPerKg}`
    ].join('\n');

    return { facts, context };
};

const getBudgetSnapshot = async () => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [dailyRows, monthlyRows, configs] = await Promise.all([
        AiInteraction.aggregate([
            { $match: { createdAt: { $gte: startOfDay } } },
            { $group: { _id: null, total: { $sum: '$estimatedCostUsd' } } }
        ]),
        AiInteraction.aggregate([
            { $match: { createdAt: { $gte: startOfMonth } } },
            { $group: { _id: null, total: { $sum: '$estimatedCostUsd' } } }
        ]),
        configService.getAll()
    ]);

    const dailySpentUsd = Number(dailyRows[0]?.total || 0);
    const monthlySpentUsd = Number(monthlyRows[0]?.total || 0);
    const dailySoftLimitUsd = Number(configs.ai_soft_budget_daily_usd || 0);
    const monthlySoftLimitUsd = Number(configs.ai_soft_budget_monthly_usd || 0);

    return {
        dailySpentUsd,
        monthlySpentUsd,
        dailySoftLimitUsd,
        monthlySoftLimitUsd,
        dailyExceeded: dailySoftLimitUsd > 0 && dailySpentUsd >= dailySoftLimitUsd,
        monthlyExceeded: monthlySoftLimitUsd > 0 && monthlySpentUsd >= monthlySoftLimitUsd
    };
};

const parseFeedType = (value: unknown): 'fish' | 'poultry' | undefined => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'fish' || normalized === 'poultry') return normalized;
    return undefined;
};

const parseStringArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const text = String(value || '').trim();
    if (!text) return [];
    return text
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const FREE_MODEL_PRIORITY_HINTS = [
    'deepseek',
    'qwen',
    'llama-3.3-70b',
    'llama-3.1-70b',
    'mistral',
    'gemma'
];

const pickPreferredModelId = (
    candidateIds: string[],
    configuredDefault?: string
): string => {
    const unique = Array.from(new Set(candidateIds.filter(Boolean)));
    if (unique.length === 0) return '';
    const configured = String(configuredDefault || '').trim();
    if (configured && unique.includes(configured)) return configured;
    for (const hint of FREE_MODEL_PRIORITY_HINTS) {
        const matched = unique.find((id) => id.toLowerCase().includes(hint));
        if (matched) return matched;
    }
    return unique[0];
};

const getFreeModelAllowlist = async (): Promise<string[]> => {
    const configs = await configService.getAll();
    const allowlist = parseStringArray(
        configs.ai_free_model_allowlist || process.env.OPENROUTER_FREE_MODEL_ALLOWLIST
    );
    return allowlist;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const formatNgn = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'NGN 0.00';
    return `NGN ${numeric.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0.0%';
    return `${numeric.toLocaleString('en-NG', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
};

const buildGlobalFallbackMessage = (
    facts: Record<string, { label: string; value: number | string; unit?: string }>
) => {
    const totalMixes = Number(facts['summary.total_mixes']?.value || 0);
    const complianceRate = Number(facts['summary.compliance_rate_pct']?.value || 0);
    const avgCost = Number(facts['summary.avg_cost_per_kg']?.value || 0);
    const avgQuality = Number(facts['summary.avg_quality_match_pct']?.value || 0);
    return [
        'Some generated numbers could not be verified, so this summary uses only verified analytics values.',
        '',
        'Verified platform snapshot:',
        `- Total mixes: ${totalMixes.toLocaleString('en-NG')}`,
        `- Compliance rate: ${formatPercent(complianceRate)}`,
        `- Average quality match: ${formatPercent(avgQuality)}`,
        `- Average cost per kg: ${formatNgn(avgCost)}/kg`,
        '',
        'For exact ingredient recommendations, include feed type, stage, and current ingredient prices.'
    ].join('\n');
};

const buildVerifiedFallbackBlocks = (
    fallbackMessage: string,
    facts: Record<string, { label: string; value: number | string; unit?: string }>,
    formulationContext: boolean
): AiResponseBlock[] => {
    const rows = formulationContext
        ? [
            {
                metric: 'Total Cost',
                value: formatNgn(facts['eq.total_cost']?.value),
                factId: 'eq.total_cost'
            },
            {
                metric: 'Cost per kg',
                value: `${formatNgn(facts['eq.cost_per_kg']?.value)}/kg`,
                factId: 'eq.cost_per_kg'
            },
            {
                metric: 'Quality Match',
                value: formatPercent(facts['meta.quality_match']?.value),
                factId: 'meta.quality_match'
            },
            {
                metric: 'Compliance',
                value: String(facts['meta.compliance_color']?.value || 'Unknown'),
                factId: 'meta.compliance_color'
            }
        ]
        : [
            {
                metric: 'Total Mixes',
                value: String(facts['summary.total_mixes']?.value || 0),
                factId: 'summary.total_mixes'
            },
            {
                metric: 'Compliance Rate',
                value: formatPercent(facts['summary.compliance_rate_pct']?.value),
                factId: 'summary.compliance_rate_pct'
            },
            {
                metric: 'Average Quality Match',
                value: formatPercent(facts['summary.avg_quality_match_pct']?.value),
                factId: 'summary.avg_quality_match_pct'
            },
            {
                metric: 'Average Cost per kg',
                value: `${formatNgn(facts['summary.avg_cost_per_kg']?.value)}/kg`,
                factId: 'summary.avg_cost_per_kg'
            }
        ];

    return [
        {
            type: 'warnings',
            title: 'Verified Response',
            content: fallbackMessage
        },
        {
            type: 'numbers_table',
            title: 'Verified Numbers',
            rows
        },
        {
            type: 'actions',
            title: 'Recommended Next Step',
            rows: formulationContext
                ? [
                    { action: 'Ask for the best low-cost variant for this same mix.' },
                    { action: 'Ask which ingredient changes improve compliance first.' }
                ]
                : [
                    { action: 'Ask directly for a best formulation using feed type, stage, batch size, and prices.' },
                    { action: 'Ask for required inputs and the assistant will guide you step by step.' }
                ]
        }
    ];
};

const summarizeQuestion = (question: string) => question.trim().replace(/\s+/g, ' ').slice(0, 200);

const stripReasoningArtifacts = (text: string): string => {
    if (!text) return '';
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/gi, '')
        .replace(/^\s*thought process\s*:\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

const extractThoughtProcess = (text: string): ThoughtExtraction => {
    const rawContent = String(text || '').trim();
    if (!rawContent) {
        return {
            answerContent: '',
            thoughtProcess: null,
            rawContent: ''
        };
    }

    const thoughtMatches: string[] = [];
    const plainPattern = /<think>([\s\S]*?)<\/think>/gi;
    const escapedPattern = /&lt;think&gt;([\s\S]*?)&lt;\/think&gt;/gi;
    let plainMatch: RegExpExecArray | null = null;
    while ((plainMatch = plainPattern.exec(rawContent)) !== null) {
        const captured = String(plainMatch[1] || '').trim();
        if (captured) thoughtMatches.push(captured);
    }
    let escapedMatch: RegExpExecArray | null = null;
    while ((escapedMatch = escapedPattern.exec(rawContent)) !== null) {
        const captured = String(escapedMatch[1] || '').trim();
        if (captured) thoughtMatches.push(captured);
    }

    const answerContent = stripReasoningArtifacts(rawContent);
    return {
        answerContent,
        thoughtProcess: thoughtMatches.length > 0 ? thoughtMatches.join('\n\n') : null,
        rawContent
    };
};

const summarizeAssistantTurn = (text: string): string => {
    const cleaned = stripReasoningArtifacts(String(text || '').replace(/\s+/g, ' ').trim());
    if (!cleaned) return '';
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/).find((line) => line.trim().length > 0) || cleaned;
    const normalized = firstSentence.trim();
    if (normalized.length <= 160) return normalized;
    return `${normalized.slice(0, 157)}...`;
};

const detectMixIntentType = (question: string): MixIntentType => {
    const normalized = String(question || '').toLowerCase();
    if (!normalized) return null;
    if (/least\s*cost|lowest\s*cost|cheapest|least\s*cost\s*formulation/.test(normalized)) return 'least_cost_mix';
    if (/improve\s*protein|increase\s*protein|higher\s*protein/.test(normalized)) return 'improve_protein';
    if (/improve\s*compliance|fix\s*compliance|meet\s*standard/.test(normalized)) return 'improve_compliance';
    if (/best\s*(mix|feed|formulation|formula|ration)|optimal\s*(mix|formulation|feed)/.test(normalized)) return 'best_mix';
    return null;
};

const toGuideVersion = () => 'v2.3.0';

const toGuideIso = (value: unknown): string => {
    const date = new Date(value as string | number | Date);
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
};

const toGuideMessageType = (role: string): 'INPUT' | 'OUTPUT' | 'TOOL_CALL' | 'TOOL_RESULT' => {
    if (role === 'user') return 'INPUT';
    return 'OUTPUT';
};

const buildVerifiedGuidance = (
    facts: Record<string, { label: string; value: number | string; unit?: string }>,
    hasFormulationContext: boolean
): string[] => {
    if (!hasFormulationContext) {
        return [
            'Ask directly for what you need, for example: "best fish formulation for 4mm grow-out, 100kg batch."',
            'For exact calculations, include feed type, stage, target batch size, and current ingredient prices.',
            'If any input is missing, ask "what details do you need?" and I will list them clearly.'
        ];
    }

    const compliance = String(facts['meta.compliance_color']?.value || '').toLowerCase();
    const quality = Number(facts['meta.quality_match']?.value || 0);
    const proteinActual = Number(facts['nutrient.protein.actual']?.value || 0);
    const proteinMin = Number(facts['nutrient.protein.target_min']?.value || NaN);
    const costPerKg = Number(facts['eq.cost_per_kg']?.value || 0);

    const guidance: string[] = [];
    if (compliance === 'red' || quality < 80) {
        guidance.push('Improve compliance first before optimizing for cost; this mix is currently below safe target quality.');
    }
    if (Number.isFinite(proteinMin) && proteinActual < proteinMin) {
        guidance.push('Increase protein-source ingredients (e.g., soybean/fishmeal class) and rerun optimization.');
    }
    if (costPerKg > 0) {
        guidance.push(`Benchmark this mix against alternatives above ${formatNgn(costPerKg)}/kg and replace the most expensive line item first.`);
    }
    if (guidance.length === 0) {
        guidance.push('This mix is relatively stable; run a +10% ingredient price scenario to stress-test profitability.');
    }
    guidance.push('After adjustments, rerun and target amber/green compliance with minimal cost increase.');
    return guidance.slice(0, 4);
};

const buildHybridFarmContext = async (
    userId: string,
    threadId?: string,
    historyLimit = 6
): Promise<{
    facts: Record<string, { label: string; value: number | string; unit?: string }>;
    contextLines: string[];
    sources: AiSource[];
    retrievalSummary: { sourceCount: number; internalFactsCount: number; knowledgeChunkCount: number };
}> => {
    if (!Types.ObjectId.isValid(userId)) {
        return {
            facts: {},
            contextLines: [],
            sources: [],
            retrievalSummary: { sourceCount: 0, internalFactsCount: 0, knowledgeChunkCount: 0 }
        };
    }
    const userObjectId = new Types.ObjectId(userId);
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

    const [
        activeBatchCount,
        avgFcrRows,
        lowStockCount,
        expenseRows,
        revenueRows,
        waterQualityRows,
        recentMessages
    ] = await Promise.all([
        Batch.countDocuments({ userId: userObjectId, status: 'Active' }),
        Batch.aggregate([
            { $match: { userId: userObjectId } },
            { $group: { _id: null, avgFcr: { $avg: '$fcr' } } }
        ]),
        UserInventory.countDocuments({
            userId: userObjectId,
            $expr: { $lt: ['$currentStockKg', '$lowStockThreshold'] }
        }),
        Expense.aggregate([
            { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        Revenue.aggregate([
            { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]),
        DailyLog.aggregate([
            { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
            {
                $group: {
                    _id: null,
                    avgPh: { $avg: '$phLevel' },
                    avgTemp: { $avg: '$waterTemp' },
                    avgDo: { $avg: '$dissolvedOxygen' }
                }
            }
        ]),
        threadId && Types.ObjectId.isValid(threadId)
            ? AiMessage.find({ conversationId: new Types.ObjectId(threadId), userId: userObjectId })
                .sort({ createdAt: -1 })
                .limit(Math.max(1, Math.min(20, historyLimit)))
                .lean()
            : Promise.resolve([])
    ]);

    const avgFcr = Number(avgFcrRows[0]?.avgFcr || 0);
    const monthlyExpense = Number(expenseRows[0]?.total || 0);
    const monthlyRevenue = Number(revenueRows[0]?.total || 0);
    const water = waterQualityRows[0] || {};
    const avgPh = Number(water.avgPh || 0);
    const avgTemp = Number(water.avgTemp || 0);
    const avgDo = Number(water.avgDo || 0);

    const facts: Record<string, { label: string; value: number | string; unit?: string }> = {
        'farm.active_batches': { label: 'Active batches', value: activeBatchCount },
        'farm.avg_fcr': { label: 'Average FCR', value: avgFcr },
        'farm.low_stock_items': { label: 'Low stock ingredients', value: lowStockCount },
        'farm.monthly_expense_30d': { label: 'Expense last 30 days', value: monthlyExpense, unit: 'NGN' },
        'farm.monthly_revenue_30d': { label: 'Revenue last 30 days', value: monthlyRevenue, unit: 'NGN' }
    };
    if (Number.isFinite(avgPh) && avgPh > 0) facts['farm.avg_ph_30d'] = { label: 'Average pH last 30 days', value: avgPh };
    if (Number.isFinite(avgTemp) && avgTemp > 0) facts['farm.avg_temp_30d'] = { label: 'Average water temperature last 30 days', value: avgTemp, unit: '°C' };
    if (Number.isFinite(avgDo) && avgDo > 0) facts['farm.avg_do_30d'] = { label: 'Average dissolved oxygen last 30 days', value: avgDo, unit: 'mg/L' };

    const contextLines = [
        `Farm context: active batches=${activeBatchCount}, low stock items=${lowStockCount}`,
        `Last 30 days: expense=NGN ${monthlyExpense}, revenue=NGN ${monthlyRevenue}`
    ];
    if (avgFcr > 0) contextLines.push(`Average FCR=${avgFcr}`);
    if (avgPh > 0 || avgTemp > 0 || avgDo > 0) {
        contextLines.push(`Water quality averages: pH=${avgPh || 'n/a'}, temp=${avgTemp || 'n/a'}°C, DO=${avgDo || 'n/a'}mg/L`);
    }
    if (recentMessages.length > 0) {
        const timeline = recentMessages
            .reverse()
            .map((msg) => `${msg.role}: ${String(msg.text || '').slice(0, 240)}`)
            .join('\n');
        contextLines.push('Recent thread memory:\n' + timeline);
    }

    const sources: AiSource[] = [
        { type: 'internal_db', title: 'Batches', reference: 'Batch model aggregates' },
        { type: 'internal_db', title: 'Inventory', reference: 'UserInventory low stock aggregates' },
        { type: 'internal_db', title: 'Financial Summary', reference: 'Expense and Revenue 30d aggregates' },
        { type: 'internal_db', title: 'Daily Logs', reference: 'Water quality 30d aggregates' }
    ];
    if (recentMessages.length > 0) {
        sources.push({ type: 'conversation_memory', title: 'Recent Thread Messages', reference: 'AiMessage last 6 records' });
    }

    return {
        facts,
        contextLines,
        sources,
        retrievalSummary: {
            sourceCount: sources.length,
            internalFactsCount: Object.keys(facts).length,
            knowledgeChunkCount: 0
        }
    };
};

const toObjectId = (value: string): Types.ObjectId | null => (
    Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null
);

const pickStageCode = (
    rawStageCode: unknown,
    feedType?: 'fish' | 'poultry',
    fallbackStageCode?: string
): string | undefined => {
    const input = String(rawStageCode || fallbackStageCode || '').trim();
    if (!input) return undefined;
    return resolveCanonicalStageCode(input, { feedType });
};

const buildThreadTitle = (question: string) => {
    const normalized = question.trim().replace(/\s+/g, ' ');
    if (!normalized) return 'Formulation Assistant';
    return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized;
};

const normalizeSources = (value: unknown): AiSource[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const item = entry as Record<string, unknown>;
            const title = String(item.title || '').trim();
            const reference = String(item.reference || '').trim();
            const type = String(item.type || '').trim();
            if (!title && !reference) return null;
            return {
                ...(type ? { type } : {}),
                ...(title ? { title } : {}),
                ...(reference ? { reference } : {})
            };
        })
        .filter((item): item is AiSource => item !== null);
};

const normalizeResponseBlocks = (value: unknown): AiResponseBlock[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const item = entry as Record<string, unknown>;
            const type = String(item.type || '').trim() as AiResponseBlock['type'];
            if (!['summary', 'numbers_table', 'actions', 'warnings'].includes(type)) return null;
            const rows = Array.isArray(item.rows)
                ? item.rows.filter((row) => row && typeof row === 'object').map((row) => row as Record<string, unknown>)
                : undefined;
            return {
                type,
                ...(item.title ? { title: String(item.title) } : {}),
                ...(item.content ? { content: String(item.content) } : {}),
                ...(rows && rows.length > 0 ? { rows } : {})
            };
        })
        .filter((item): item is AiResponseBlock => item !== null);
};

const normalizeFollowUpPrompts = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 6);
};

const resolveBestMixOption = (
    strategyOptions: any[],
    intent: MixIntentType
) => {
    const options = Array.isArray(strategyOptions) ? strategyOptions : [];
    if (options.length === 0) return null;

    if (intent === 'least_cost_mix') {
        return options
            .slice()
            .sort((a, b) => Number(a.costPerKg || 0) - Number(b.costPerKg || 0))[0];
    }

    if (intent === 'improve_protein') {
        return options
            .slice()
            .sort((a, b) => (
                Number(b.actualNutrients?.protein || 0) - Number(a.actualNutrients?.protein || 0)
                || Number(b.qualityMatchPercentage || 0) - Number(a.qualityMatchPercentage || 0)
            ))[0];
    }

    if (intent === 'improve_compliance') {
        const rank = (value: string) => {
            const normalized = String(value || '').toLowerCase();
            if (normalized === 'green') return 3;
            if (normalized === 'blue') return 2;
            if (normalized === 'red') return 1;
            return 0;
        };
        return options
            .slice()
            .sort((a, b) => (
                rank(String(b.complianceColor || '')) - rank(String(a.complianceColor || ''))
                || Number(b.qualityMatchPercentage || 0) - Number(a.qualityMatchPercentage || 0)
                || Number(a.costPerKg || 0) - Number(b.costPerKg || 0)
            ))[0];
    }

    return options
        .slice()
        .sort((a, b) => (
            Number(b.qualityMatchPercentage || 0) - Number(a.qualityMatchPercentage || 0)
            || Number(a.costPerKg || 0) - Number(b.costPerKg || 0)
        ))[0];
};

const runBestMixOrchestration = async ({
    userId,
    question,
    formulationId,
    feedType,
    stageCode
}: {
    userId: string;
    question: string;
    formulationId?: string;
    feedType?: 'fish' | 'poultry';
    stageCode?: string;
}): Promise<{ payload: AiAnalystResponse; meta: Record<string, unknown> } | null> => {
    const intent = detectMixIntentType(question);
    if (!intent) return null;

    const startedAt = Date.now();
    let formulation: any = null;
    if (formulationId) {
        formulation = await getFormulationWithStandardForUser(formulationId, userId);
    } else if (Types.ObjectId.isValid(userId)) {
        const query: Record<string, unknown> = {
            userId: new Types.ObjectId(userId),
            isUnlocked: true
        };
        formulation = await Formulation.findOne(query)
            .populate('standardUsed', 'feedCategory stage stageCode targetNutrients tolerance')
            .sort({ createdAt: -1 })
            .lean();
    }

    if (!formulation) {
        const missingResponse = [
            'I can generate a full best formulation, but I need core inputs first.',
            '',
            'Please send:',
            '1. Feed type (fish or poultry)',
            '2. Stage (for example: FISH_CATFISH_4MM_GROW_OUT or BROILER_STARTER)',
            '3. Target batch weight (kg)',
            '4. Ingredient prices you currently buy at',
            '',
            'Then I will return ingredient %, kg, nutrient compliance, and cost per kg.'
        ].join('\n');
        return {
            payload: {
                answer: missingResponse,
                answerMarkdown: missingResponse,
                answerContent: missingResponse,
                rawContent: missingResponse,
                thoughtProcess: null,
                citations: [],
                numericClaims: [],
                sources: [
                    {
                        type: 'tool_guardrail',
                        title: 'Missing required formulation context',
                        reference: 'Need formulation context to compute best mix deterministically'
                    }
                ],
                responseBlocks: [
                    {
                        type: 'warnings',
                        title: 'Missing Inputs',
                        content: 'Best-formulation toolchain needs feed type, stage, target batch weight, and ingredient prices.'
                    },
                    {
                        type: 'actions',
                        title: 'Provide These Inputs',
                        rows: [
                            { action: 'Feed type + stage code' },
                            { action: 'Target batch weight + ingredient prices' }
                        ]
                    }
                ],
                followUpPrompts: [
                    'What inputs do you need to generate a best formulation?',
                    'Generate fish 4mm grow-out formulation for 100kg batch',
                    'Generate poultry broiler starter formulation for 50kg batch'
                ],
                confidence: 0.6,
                reasoningSummary: 'Best-mix analysis was blocked because no formulation context was available.',
                toolTrace: [
                    {
                        type: 'tool_call',
                        name: 'best_mix_orchestrator',
                        status: 'blocked',
                        arguments: {
                            feedType: feedType || null,
                            stageCode: stageCode || null,
                            hasFormulationId: Boolean(formulationId)
                        },
                        result: {
                            reason: 'missing_context'
                        }
                    }
                ],
                verificationStatus: 'passed',
                fallbackMessage: null
            },
            meta: {
                modelUsed: 'deterministic-formulation-toolchain',
                estimatedCostUsd: 0,
                estimatedCostNgn: 0,
                pricingSource: 'unknown',
                interactionLatencyMs: Date.now() - startedAt
            }
        };
    }

    const standard = formulation.standardUsed || {};
    const normalizedFeedType = String(standard.feedCategory || '').toLowerCase() === 'poultry'
        ? 'poultry'
        : 'fish';
    const normalizedStageCode = resolveCanonicalStageCode(
        String(standard.stageCode || stageCode || ''),
        { feedType: normalizedFeedType as 'fish' | 'poultry' }
    );

    if (feedType && feedType !== normalizedFeedType) {
        return null;
    }
    if (stageCode && normalizedStageCode && stageCode !== normalizedStageCode) {
        return null;
    }

    const strategyOptions = Array.isArray(formulation.strategyOptions) && formulation.strategyOptions.length > 0
        ? formulation.strategyOptions
        : [{
            strategy: formulation.selectedStrategy || 'LEAST_COST',
            totalCost: formulation.totalCost,
            costPerKg: formulation.costPerKg,
            overheadCost: formulation.overheadCost,
            complianceColor: formulation.complianceColor,
            qualityMatchPercentage: formulation.qualityMatchPercentage,
            ingredientsUsed: Array.isArray(formulation.ingredientsUsed) ? formulation.ingredientsUsed : [],
            actualNutrients: formulation.actualNutrients || {}
        }];

    const selectedOption = resolveBestMixOption(strategyOptions, intent);
    if (!selectedOption) return null;

    const targetWeightKg = Number(formulation.targetWeightKg || 0);
    const ingredients = Array.isArray(selectedOption.ingredientsUsed) ? selectedOption.ingredientsUsed : [];
    const ingredientRows = ingredients.map((row: any) => {
        const qtyKg = Number(row.qtyKg || 0);
        const inclusionPct = targetWeightKg > 0 ? (qtyKg / targetWeightKg) * 100 : 0;
        return {
            ingredient: String(row.name || ''),
            qtyKg,
            inclusionPct: Number(inclusionPct.toFixed(6)),
            priceAtMoment: Number(row.priceAtMoment || 0),
            lineCost: Number((qtyKg * Number(row.priceAtMoment || 0)).toFixed(6))
        };
    });

    const actualNutrients = selectedOption.actualNutrients || {};
    const targetNutrients = standard.targetNutrients || {};
    const nutrientRows = Object.keys(actualNutrients).sort().map((key) => {
        const actual = Number(actualNutrients[key] || 0);
        const range = targetNutrients[key] || {};
        return {
            nutrient: key,
            actual,
            targetMin: range?.min,
            targetMax: range?.max
        };
    });

    const answer = [
        `Best mix result for ${normalizedFeedType.toUpperCase()} ${normalizedStageCode || standard.stage || ''}`.trim(),
        `- Strategy: ${String(selectedOption.strategy || 'LEAST_COST')}`,
        `- Total cost: ${formatNgn(selectedOption.totalCost)}`,
        `- Cost per kg: ${formatNgn(selectedOption.costPerKg)}/kg`,
        `- Quality match: ${formatPercent(selectedOption.qualityMatchPercentage)}`,
        `- Compliance: ${String(selectedOption.complianceColor || 'Unknown')}`
    ].join('\n');

    const numericClaims: NumericClaim[] = [
        {
            label: 'Total cost',
            value: Number(selectedOption.totalCost || 0),
            unit: 'NGN',
            factId: 'tool.best_mix.total_cost'
        },
        {
            label: 'Cost per kg',
            value: Number(selectedOption.costPerKg || 0),
            unit: 'NGN/kg',
            factId: 'tool.best_mix.cost_per_kg'
        },
        {
            label: 'Quality match',
            value: Number(selectedOption.qualityMatchPercentage || 0),
            unit: '%',
            factId: 'tool.best_mix.quality_match'
        }
    ];

    const toolTrace = [
        {
            type: 'tool_call',
            name: 'formulation_strategy_selector',
            status: 'success',
            arguments: {
                intent,
                strategyCount: strategyOptions.length
            },
            result: {
                selectedStrategy: String(selectedOption.strategy || 'LEAST_COST')
            }
        },
        {
            type: 'tool_result',
            name: 'mix_table_builder',
            status: 'success',
            result: {
                ingredients: ingredientRows.length,
                nutrients: nutrientRows.length
            }
        }
    ];

    return {
        payload: {
            answer,
            answerMarkdown: answer,
            answerContent: answer,
            rawContent: answer,
            thoughtProcess: null,
            citations: numericClaims.map((claim) => claim.factId),
            numericClaims,
            sources: [
                {
                    type: 'internal_solver',
                    title: 'Formulation strategy options',
                    reference: `Formulation ${String(formulation._id)}`
                }
            ],
            responseBlocks: [
                {
                    type: 'numbers_table',
                    title: 'Best Mix Summary',
                    rows: [
                        { metric: 'Strategy', value: String(selectedOption.strategy || 'LEAST_COST') },
                        { metric: 'Total Cost', value: formatNgn(selectedOption.totalCost) },
                        { metric: 'Cost per kg', value: `${formatNgn(selectedOption.costPerKg)}/kg` },
                        { metric: 'Quality Match', value: formatPercent(selectedOption.qualityMatchPercentage) },
                        { metric: 'Compliance', value: String(selectedOption.complianceColor || 'Unknown') }
                    ]
                },
                {
                    type: 'numbers_table',
                    title: 'Ingredient Composition',
                    rows: ingredientRows.slice(0, 20)
                },
                {
                    type: 'numbers_table',
                    title: 'Nutrient Comparison',
                    rows: nutrientRows.slice(0, 20)
                }
            ],
            followUpPrompts: [
                'How can I make this formulation cheaper without losing compliance?',
                'Which ingredient swap should I try first?',
                'How can I improve protein while keeping cost under control?'
            ],
            confidence: 0.98,
            reasoningSummary: `Selected ${String(selectedOption.strategy || 'LEAST_COST')} strategy from computed formulation options and assembled ingredient/nutrient tables from stored solver outputs.`,
            toolTrace,
            verificationStatus: 'passed',
            fallbackMessage: null
        },
        meta: {
            modelUsed: 'deterministic-formulation-toolchain',
            estimatedCostUsd: 0,
            estimatedCostNgn: 0,
            pricingSource: 'unknown',
            interactionLatencyMs: Date.now() - startedAt
        }
    };
};

const runAnalystQuery = async ({
    userId,
    kind,
    question,
    formulationId,
    feedType,
    stageCode,
    threadId,
    modelId,
    maxTokens,
    requestId,
    jobId
}: AskAnalystInput): Promise<{
    payload: AiAnalystResponse;
    meta: Record<string, unknown>;
}> => {
    const configs = await configService.getAll();
    if (configs.ai_enabled === false) {
        throw Object.assign(new Error('AI formulation analyst is currently disabled by admin settings'), { statusCode: 503 });
    }

    let factPack: { facts: Record<string, { label: string; value: number | string; unit?: string }>; context: string };
    const hasFormulationContext = Boolean(formulationId);
    let fallbackMessage = '';
    if (formulationId) {
        const formulation = await getFormulationWithStandardForUser(formulationId, userId);
        if (!formulation) {
            throw Object.assign(new Error('Formulation not found'), { statusCode: 404 });
        }
        const ledger = buildCalculationLedger(formulation);
        factPack = buildFactPack(ledger);
        fallbackMessage = buildFallbackMessage(ledger);
    } else {
        factPack = await buildGlobalFactPack(userId, feedType, stageCode);
        fallbackMessage = buildGlobalFallbackMessage(factPack.facts);
    }

    const adaptiveHistoryLimit = question.length > 220 ? 12 : (question.length > 120 ? 8 : 6);
    const hybrid = await buildHybridFarmContext(userId, threadId, adaptiveHistoryLimit);
    const mergedFacts = {
        ...factPack.facts,
        ...hybrid.facts
    };
    const mergedSources: AiSource[] = [
        ...hybrid.sources
    ];

    const instruction = kind === 'what_if'
        ? 'You are AquaFeed Senior Analyst for day-to-day farmers. Use supplied facts first, then practical farm reasoning. Keep language simple. Never invent numbers.'
        : 'You are AquaFeed Senior Analyst for day-to-day farmers. Use supplied facts first, then practical farm reasoning. Keep language simple. Never invent numbers.';

    const systemPrompt = [
        instruction,
        'Return strict JSON with keys: answer, answerMarkdown, citations, numericClaims, responseBlocks, sources, followUpPrompts, confidence, reasoningSummary, toolTrace.',
        'responseBlocks is array with item shape: {type,title,content,rows?}.',
        'numericClaims must be array of {label,value,unit,factId}.',
        'toolTrace is array of {type,name,status,arguments?,result?}.',
        'confidence must be from 0 to 1.',
        'reasoningSummary must be concise and user-safe (no chain-of-thought).',
        'If unsure, keep numericClaims empty.'
    ].join('\n');

    const userPrompt = [
        `Question: ${question}`,
        '',
        'Fact context:',
        factPack.context,
        '',
        'Additional farm context:',
        hybrid.contextLines.join('\n'),
        '',
        'Facts JSON:',
        JSON.stringify(mergedFacts)
    ].join('\n');

    const startedAt = Date.now();
    console.info('[AI][run] start', {
        requestId: requestId || null,
        jobId: jobId || null,
        userId,
        kind,
        feedType: feedType || null,
        stageCode: stageCode || null,
        hasFormulationContext,
        modelId: modelId || null,
        maxTokens: maxTokens || null,
        question: summarizeQuestion(question)
    });
    try {
        const orchestrated = await runBestMixOrchestration({
            userId,
            question,
            formulationId,
            feedType,
            stageCode
        });

        if (orchestrated) {
            const deterministicToolTrace = Array.isArray(orchestrated.payload.toolTrace)
                ? orchestrated.payload.toolTrace
                : [];
            await AiInteraction.create({
                userId,
                ...(threadId ? { threadId } : {}),
                ...(formulationId ? { formulationId } : {}),
                ...(jobId ? { jobId } : {}),
                ...(requestId ? { requestId } : {}),
                kind,
                status: 'success',
                verificationStatus: 'passed',
                prompt: question,
                answer: orchestrated.payload.answerContent,
                fallbackMessage: undefined,
                citations: orchestrated.payload.citations,
                numericClaims: orchestrated.payload.numericClaims,
                verificationErrors: [],
                modelPrimary: 'deterministic-formulation-toolchain',
                modelFallback: 'deterministic-formulation-toolchain',
                modelUsed: 'deterministic-formulation-toolchain',
                fallbackUsed: false,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                estimatedCostUsd: 0,
                pricingSource: 'unknown',
                latencyMs: Date.now() - startedAt,
                queueWaitMs: 0,
                processingMs: Date.now() - startedAt,
                retrievalSummary: hybrid.retrievalSummary,
                attempts: [
                    {
                        model: 'deterministic-formulation-toolchain',
                        latencyMs: Date.now() - startedAt,
                        status: 'success'
                    }
                ],
                ...(deterministicToolTrace.length > 0 ? { toolTrace: deterministicToolTrace } : {})
            });

            return {
                payload: orchestrated.payload,
                meta: {
                    ...orchestrated.meta,
                    requestId: requestId || null
                }
            };
        }

        const adaptiveMaxTokens = maxTokens && maxTokens > 0
            ? maxTokens
            : Math.min(3200, Math.max(1200, (question.length * 4) + (hasFormulationContext ? 900 : 700)));
        const llm = await openRouterService.chatJson({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            ...(modelId ? { modelOverride: modelId } : {}),
            maxTokensOverride: adaptiveMaxTokens
        });

        const rawAnswer = String(llm.parsedJson.answer || '').trim();
        const rawAnswerMarkdown = String(llm.parsedJson.answerMarkdown || rawAnswer).trim() || rawAnswer;
        const extracted = extractThoughtProcess(rawAnswerMarkdown || rawAnswer);
        const answerContent = extracted.answerContent || stripReasoningArtifacts(rawAnswerMarkdown || rawAnswer);
        const answerMarkdown = answerContent;
        const answer = answerContent;
        const citationsRaw = llm.parsedJson.citations;
        const citations = Array.isArray(citationsRaw)
            ? citationsRaw.map((item) => String(item)).filter(Boolean)
            : [];
        const numericClaims = normalizeClaims(llm.parsedJson.numericClaims);
        const verification = verifyClaims(numericClaims, citations, mergedFacts);
        const verifiedFallbackMessage = verification.passed ? null : fallbackMessage;
        const responseBlocks = normalizeResponseBlocks(llm.parsedJson.responseBlocks);
        const followUpPrompts = normalizeFollowUpPrompts(llm.parsedJson.followUpPrompts);
        const dynamicSources = normalizeSources(llm.parsedJson.sources);
        const parsedReasoningSummary = String(llm.parsedJson.reasoningSummary || '').trim() || null;
        const reasoningSummary = parsedReasoningSummary || extracted.thoughtProcess || null;
        const confidence = clamp01(Number(llm.parsedJson.confidence ?? (verification.passed ? 0.84 : 0.5)));
        const normalizedToolTrace = Array.isArray(llm.parsedJson.toolTrace)
            ? llm.parsedJson.toolTrace
                .filter((entry) => entry && typeof entry === 'object')
                .map((entry) => entry as Record<string, unknown>)
            : [];
        const safeBlocks = verification.passed
            ? (
                responseBlocks.length > 0
                    ? responseBlocks
                    : ([
                        {
                            type: 'summary' as const,
                            title: 'Assistant Summary',
                            content: answer
                        }
                    ] as AiResponseBlock[])
            )
            : buildVerifiedFallbackBlocks(fallbackMessage, factPack.facts, hasFormulationContext);
        const verifiedGuidance = verification.passed
            ? []
            : buildVerifiedGuidance(factPack.facts, hasFormulationContext);
        const safeFollowUps = verification.passed
            ? followUpPrompts
            : verifiedGuidance.slice(0, 3);
        const safeCitations = verification.passed ? citations : [];
        const safeNumericClaims = verification.passed ? numericClaims : [];
        const safeSources = verification.passed
            ? [...mergedSources, ...dynamicSources].slice(0, 12)
            : mergedSources;
        const fallbackNarrative = verification.passed
            ? null
            : [
                fallbackMessage,
                '',
                'Actionable guidance:',
                ...verifiedGuidance.map((item, index) => `${index + 1}. ${item}`)
            ].join('\n');

        const responsePayload: AiAnalystResponse = {
            answer: verification.passed ? answer : (fallbackNarrative || fallbackMessage || answer),
            answerMarkdown: verification.passed ? answerMarkdown : (fallbackNarrative || fallbackMessage || answerMarkdown),
            answerContent: verification.passed ? answerContent : (fallbackNarrative || fallbackMessage || answerContent),
            thoughtProcess: verification.passed ? extracted.thoughtProcess : null,
            rawContent: extracted.rawContent || answerContent,
            citations: safeCitations,
            numericClaims: safeNumericClaims,
            sources: safeSources,
            responseBlocks: safeBlocks,
            followUpPrompts: safeFollowUps,
            confidence,
            reasoningSummary,
            toolTrace: normalizedToolTrace,
            verificationStatus: verification.passed ? 'passed' : 'failed',
            fallbackMessage: verifiedFallbackMessage
        };

        await AiInteraction.create({
            userId,
            ...(threadId ? { threadId } : {}),
            ...(formulationId ? { formulationId } : {}),
            ...(jobId ? { jobId } : {}),
            ...(requestId ? { requestId } : {}),
            kind,
            status: verification.passed ? 'success' : 'fallback',
            verificationStatus: verification.passed ? 'passed' : 'failed',
            prompt: question,
            answer: answerContent,
            fallbackMessage: verifiedFallbackMessage || undefined,
            citations,
            numericClaims,
            verificationErrors: verification.errors,
            modelPrimary: llm.modelPrimary,
            modelFallback: llm.modelFallback,
            modelUsed: llm.modelUsed,
            fallbackUsed: llm.fallbackUsed || !verification.passed,
            promptTokens: llm.usage.promptTokens,
            completionTokens: llm.usage.completionTokens,
            totalTokens: llm.usage.totalTokens,
            estimatedCostUsd: llm.estimatedCostUsd,
            pricingSource: llm.pricingSource,
            latencyMs: llm.latencyMs,
            queueWaitMs: 0,
            processingMs: llm.latencyMs,
            retrievalSummary: hybrid.retrievalSummary,
            attempts: [
                {
                    model: llm.modelUsed,
                    latencyMs: llm.latencyMs,
                    status: 'success'
                }
            ],
            ...(normalizedToolTrace.length > 0 ? { toolTrace: normalizedToolTrace } : {})
        });
        if (!verification.passed) {
            console.warn('[AI][run] verification_failed', {
                requestId: requestId || null,
                jobId: jobId || null,
                userId,
                modelUsed: llm.modelUsed,
                verificationErrorCount: verification.errors.length,
                verificationErrors: verification.errors.slice(0, 6),
                citationsCount: citations.length,
                numericClaimsCount: numericClaims.length
            });
        }

        const budget = await getBudgetSnapshot();
        const estimatedCostNgn = llm.estimatedCostUsd * Number(configs.currency_exchange_usd || 1600);
        console.info('[AI][run] success', {
            requestId: requestId || null,
            jobId: jobId || null,
            userId,
            modelUsed: llm.modelUsed,
            fallbackUsed: !verification.passed || llm.fallbackUsed,
            verificationStatus: responsePayload.verificationStatus,
            totalTokens: llm.usage.totalTokens,
            latencyMs: llm.latencyMs,
            estimatedCostUsd: llm.estimatedCostUsd,
            pricingSource: llm.pricingSource
        });

        return {
            payload: responsePayload,
            meta: {
                interactionLatencyMs: Date.now() - startedAt,
                modelUsed: llm.modelUsed,
                estimatedCostUsd: llm.estimatedCostUsd,
                estimatedCostNgn,
                pricingSource: llm.pricingSource,
                reasoningSummary,
                budget
            }
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'AI request failed';
        console.error('[AI][run] failed', {
            requestId: requestId || null,
            jobId: jobId || null,
            userId,
            kind,
            modelId: modelId || null,
            ...toErrorPayload(error)
        });
        await AiInteraction.create({
            userId,
            ...(threadId ? { threadId } : {}),
            ...(formulationId ? { formulationId } : {}),
            ...(jobId ? { jobId } : {}),
            ...(requestId ? { requestId } : {}),
            kind,
            status: 'error',
            verificationStatus: 'failed',
            prompt: question,
            answer: '',
            fallbackMessage,
            citations: [],
            numericClaims: [],
            verificationErrors: [message],
            modelPrimary: process.env.OPENROUTER_PRIMARY_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
            modelFallback: process.env.OPENROUTER_FALLBACK_MODEL || 'openai/gpt-4o-mini',
            ...(modelId ? { modelUsed: modelId } : {}),
            fallbackUsed: true,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            pricingSource: 'unknown',
            latencyMs: Date.now() - startedAt,
            queueWaitMs: 0,
            processingMs: Date.now() - startedAt,
            retrievalSummary: hybrid.retrievalSummary,
            attempts: [
                {
                    model: modelId || process.env.OPENROUTER_PRIMARY_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
                    status: 'failed',
                    errorMessage: message
                }
            ],
            errorMessage: message
        });

        const budget = await getBudgetSnapshot();
        const verifiedGuidance = buildVerifiedGuidance(factPack.facts, hasFormulationContext);
        const intent = detectMixIntentType(question);
        const providerFailureGuidance = (!hasFormulationContext && intent)
            ? [
                'AI model was temporarily unavailable, but I can still generate a strong formulation once inputs are provided.',
                '',
                'Please send feed type, stage, target batch weight, and ingredient prices.'
            ].join('\n')
            : [
                'AI model was temporarily unavailable. Here is a verified summary from your data.',
                '',
                fallbackMessage
            ].join('\n');
        const fallbackNarrative = [
            providerFailureGuidance,
            '',
            'What to send next:',
            ...verifiedGuidance.map((item, index) => `${index + 1}. ${item}`)
        ].join('\n');

        return {
            payload: {
                answer: fallbackNarrative,
                answerMarkdown: fallbackNarrative,
                answerContent: fallbackNarrative,
                thoughtProcess: null,
                rawContent: fallbackNarrative,
                citations: [],
                numericClaims: [],
                sources: mergedSources,
                responseBlocks: buildVerifiedFallbackBlocks(fallbackMessage, factPack.facts, hasFormulationContext),
                followUpPrompts: verifiedGuidance.slice(0, 3),
                confidence: 0.25,
                reasoningSummary: null,
                toolTrace: [],
                verificationStatus: 'failed',
                fallbackMessage: fallbackMessage || null
            },
            meta: { budget }
        };
    } finally {
        console.info('[AI][run] done', {
            requestId: requestId || null,
            jobId: jobId || null,
            userId,
            kind,
            durationMs: Date.now() - startedAt
        });
    }
};

const normalizeScenarioType = (raw: unknown): string => {
    const normalized = String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!normalized) return 'maize_price_increase';
    if (['maize_price_increase', 'maize_price_plus_10'].includes(normalized)) return 'maize_price_increase';
    if (['protein_target_increase', 'protein_target_plus_1'].includes(normalized)) return 'protein_target_increase';
    if (['sorghum_max', 'sorghum_max_set'].includes(normalized)) return 'sorghum_max';
    if (['try_alternatives_expensive', 'alternatives_expensive'].includes(normalized)) return 'try_alternatives_expensive';
    return normalized;
};

const statusForRange = (
    actual: number,
    min?: number,
    max?: number
): 'below' | 'within' | 'above' | 'no_target' => {
    if (min === undefined && max === undefined) return 'no_target';
    if (min !== undefined && actual < min) return 'below';
    if (max !== undefined && actual > max) return 'above';
    return 'within';
};

const formatScenarioLabel = (scenarioType: string) => {
    switch (scenarioType) {
        case 'maize_price_increase':
            return 'If maize price +10%';
        case 'protein_target_increase':
            return 'If protein target +1%';
        case 'sorghum_max':
            return 'If sorghum max set';
        case 'try_alternatives_expensive':
            return 'Try alternatives for expensive ingredients';
        default:
            return scenarioType.replace(/_/g, ' ');
    }
};

const runScenarioSimulation = async ({
    userId,
    scenarioType,
    formulationId,
    parameters
}: {
    userId: string;
    scenarioType: string;
    formulationId?: string;
    parameters?: Record<string, unknown>;
}): Promise<ScenarioResult> => {
    if (!formulationId) {
        const overview = await getAnalyticsOverview({ userId });
        const avgCost = overview.summary.avgCostPerKg;
        return {
            scenarioType,
            title: 'Scenario needs a selected mix',
            summary: 'Open this scenario from a specific mix result to run exact simulation deltas.',
            deltas: {
                costPerKg: 0,
                qualityMatch: 0,
                complianceBefore: 'N/A',
                complianceAfter: 'N/A'
            },
            violations: [],
            recommendations: [
                'Open a formulation result and tap Ask about this mix.',
                'Run the scenario again so cost and compliance deltas are exact.'
            ],
            numericClaims: [
                {
                    label: 'Current average cost per kg',
                    value: avgCost,
                    unit: 'NGN/kg',
                    factId: 'global.avg_cost_per_kg'
                }
            ],
            citations: ['global.avg_cost_per_kg']
        };
    }

    const formulation = await getFormulationWithStandardForUser(formulationId, userId);
    if (!formulation) {
        throw Object.assign(new Error('Formulation not found'), { statusCode: 404 });
    }

    const ledger = buildCalculationLedger(formulation);
    const ingredients = Array.isArray(formulation.ingredientsUsed) ? formulation.ingredientsUsed : [];
    const targetWeight = Number(formulation.targetWeightKg || ledger.targetWeightKg || 0);
    const baseCost = Number(ledger.totals.totalCost || 0);
    const baseCostPerKg = Number(ledger.totals.costPerKg || 0);
    const baseCompliance = String(ledger.complianceColor || '');

    if (scenarioType === 'maize_price_increase') {
        const increasePct = Number(parameters?.priceIncreasePct || 10);
        const maizeRows = ingredients.filter((row: any) => String(row?.name || '').toLowerCase().includes('maize'));
        const deltaTotal = maizeRows.reduce((sum, row: any) => {
            const qty = Number(row?.qtyKg || 0);
            const price = Number(row?.priceAtMoment || 0);
            return sum + (qty * price * (increasePct / 100));
        }, 0);
        const projectedTotal = baseCost + deltaTotal;
        const projectedCostPerKg = targetWeight > 0 ? projectedTotal / targetWeight : baseCostPerKg;

        return {
            scenarioType,
            title: 'Maize price increase simulation',
            summary: `With maize price up ${increasePct}%, projected cost per kg becomes NGN ${projectedCostPerKg}.`,
            deltas: {
                totalCost: deltaTotal,
                costPerKg: projectedCostPerKg - baseCostPerKg,
                qualityMatch: 0,
                complianceBefore: baseCompliance,
                complianceAfter: baseCompliance
            },
            violations: [],
            recommendations: [
                'Try alternatives for maize-heavy recipes.',
                'Set max maize inclusion and rerun optimization.'
            ],
            numericClaims: [
                { label: 'Baseline total cost', value: baseCost, unit: 'NGN', factId: 'scenario.baseline_total_cost' },
                { label: 'Projected total cost', value: projectedTotal, unit: 'NGN', factId: 'scenario.projected_total_cost' },
                { label: 'Projected cost per kg', value: projectedCostPerKg, unit: 'NGN/kg', factId: 'scenario.projected_cost_per_kg' },
                { label: 'Total cost delta', value: deltaTotal, unit: 'NGN', factId: 'scenario.total_cost_delta' }
            ],
            citations: [
                'scenario.baseline_total_cost',
                'scenario.projected_total_cost',
                'scenario.projected_cost_per_kg',
                'scenario.total_cost_delta'
            ]
        };
    }

    if (scenarioType === 'protein_target_increase') {
        const deltaPct = Number(parameters?.deltaPct || 1);
        const targetProtein = (formulation as any)?.standardUsed?.targetNutrients?.protein || {};
        const oldMin = Number(targetProtein.min);
        const oldMax = Number(targetProtein.max);
        const actualProtein = Number((formulation as any)?.actualNutrients?.protein || 0);
        const newMin = Number.isFinite(oldMin) ? oldMin + deltaPct : undefined;
        const newMax = Number.isFinite(oldMax) ? oldMax + deltaPct : undefined;
        const beforeStatus = statusForRange(actualProtein, Number.isFinite(oldMin) ? oldMin : undefined, Number.isFinite(oldMax) ? oldMax : undefined);
        const afterStatus = statusForRange(actualProtein, newMin, newMax);
        const complianceAfter = afterStatus === 'within' ? baseCompliance : 'Red';

        return {
            scenarioType,
            title: 'Protein target increase simulation',
            summary: `Protein target shifted by +${deltaPct}%. Current protein is ${actualProtein}%. Status moves from ${beforeStatus} to ${afterStatus}.`,
            deltas: {
                totalCost: 0,
                costPerKg: 0,
                qualityMatch: afterStatus === 'within' ? 0 : -3,
                complianceBefore: baseCompliance,
                complianceAfter
            },
            violations: afterStatus === 'within' ? [] : ['Protein target is not met after this stricter requirement.'],
            recommendations: afterStatus === 'within'
                ? ['Target remains feasible with current mix.']
                : ['Increase protein-source ingredients and rerun mix.', 'Try alternatives for protein sources with better cost efficiency.'],
            numericClaims: [
                { label: 'Actual protein', value: actualProtein, unit: '%', factId: 'scenario.actual_protein' },
                ...(Number.isFinite(oldMin) ? [{ label: 'Old protein min', value: oldMin, unit: '%', factId: 'scenario.old_protein_min' }] : []),
                ...(Number.isFinite(oldMax) ? [{ label: 'Old protein max', value: oldMax, unit: '%', factId: 'scenario.old_protein_max' }] : []),
                ...(newMin !== undefined ? [{ label: 'New protein min', value: newMin, unit: '%', factId: 'scenario.new_protein_min' }] : []),
                ...(newMax !== undefined ? [{ label: 'New protein max', value: newMax, unit: '%', factId: 'scenario.new_protein_max' }] : [])
            ],
            citations: [
                'scenario.actual_protein',
                'scenario.old_protein_min',
                'scenario.old_protein_max',
                'scenario.new_protein_min',
                'scenario.new_protein_max'
            ]
        };
    }

    if (scenarioType === 'sorghum_max') {
        const maxPct = Number(parameters?.maxPct || 15);
        const sorghumKg = ingredients
            .filter((row: any) => String(row?.name || '').toLowerCase().includes('sorghum'))
            .reduce((sum, row: any) => sum + Number(row?.qtyKg || 0), 0);
        const inclusionPct = targetWeight > 0 ? (sorghumKg / targetWeight) * 100 : 0;
        const violated = inclusionPct > maxPct;

        return {
            scenarioType,
            title: 'Sorghum max inclusion simulation',
            summary: `Current sorghum inclusion is ${inclusionPct}%. Max requested is ${maxPct}%.`,
            deltas: {
                totalCost: 0,
                costPerKg: 0,
                qualityMatch: violated ? -2 : 0,
                complianceBefore: baseCompliance,
                complianceAfter: violated ? 'Red' : baseCompliance
            },
            violations: violated
                ? [`Sorghum inclusion exceeds max by ${inclusionPct - maxPct} percentage points.`]
                : [],
            recommendations: violated
                ? ['Reduce sorghum cap and rerun optimization.', 'Use alternative energy ingredients to recover compliance.']
                : ['Sorghum cap is already satisfied.'],
            numericClaims: [
                { label: 'Current sorghum inclusion', value: inclusionPct, unit: '%', factId: 'scenario.sorghum_current_pct' },
                { label: 'Requested sorghum max', value: maxPct, unit: '%', factId: 'scenario.sorghum_max_pct' }
            ],
            citations: ['scenario.sorghum_current_pct', 'scenario.sorghum_max_pct']
        };
    }

    const alternatives = Array.isArray((formulation as any).alternatives) ? (formulation as any).alternatives : [];
    const topSuggestion = alternatives[0];
    const savings = Number(topSuggestion?.savings || 0);
    const projectedTotal = Math.max(0, baseCost - savings);
    const projectedCostPerKg = targetWeight > 0 ? projectedTotal / targetWeight : baseCostPerKg;

    return {
        scenarioType: 'try_alternatives_expensive',
        title: 'Alternative ingredient simulation',
        summary: topSuggestion?.suggestion
            ? `${topSuggestion.suggestion}. Estimated savings: NGN ${savings}.`
            : 'No precomputed alternative suggestion was found for this mix yet.',
        deltas: {
            totalCost: -savings,
            costPerKg: projectedCostPerKg - baseCostPerKg,
            qualityMatch: 0,
            complianceBefore: baseCompliance,
            complianceAfter: baseCompliance
        },
        violations: [],
        recommendations: topSuggestion?.suggestion
            ? ['Apply suggested replacement and rerun to validate compliance.']
            : ['Generate a new formulation run with more alternative ingredients enabled.'],
        numericClaims: [
            { label: 'Estimated savings', value: savings, unit: 'NGN', factId: 'scenario.estimated_savings' },
            { label: 'Projected cost per kg', value: projectedCostPerKg, unit: 'NGN/kg', factId: 'scenario.projected_cost_per_kg' }
        ],
        citations: ['scenario.estimated_savings', 'scenario.projected_cost_per_kg']
    };
};

const mapMessageDoc = (doc: any) => ({
    id: String(doc._id),
    conversationId: String(doc.conversationId),
    role: doc.role,
    text: doc.text,
    rawContent: doc.rawContent || doc.text,
    answerContent: doc.answerContent || stripReasoningArtifacts(doc.text || ''),
    thoughtProcess: doc.thoughtProcess || null,
    answerMarkdown: doc.answerContent || stripReasoningArtifacts(doc.text || ''),
    citations: doc.citations || [],
    numericClaims: doc.numericClaims || [],
    sources: doc.sources || [],
    responseBlocks: doc.responseBlocks || [],
    followUpPrompts: doc.followUpPrompts || [],
    confidence: doc.confidence ?? null,
    reasoningSummary: doc.reasoningSummary || null,
    modelId: doc.modelId || null,
    requestId: doc.requestId || null,
    jobId: doc.jobId ? String(doc.jobId) : null,
    verificationStatus: doc.verificationStatus || null,
    fallbackMessage: doc.fallbackMessage || null,
    toolTrace: doc.toolTrace || [],
    scenario: doc.scenario || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
});

const mapThreadDoc = (doc: any) => ({
    id: String(doc._id),
    title: doc.title,
    selectedModelId: doc.selectedModelId || null,
    streamEnabled: doc.streamEnabled !== false,
    contextDefaults: doc.contextDefaults
        ? {
            ...(doc.contextDefaults.feedType ? { feedType: String(doc.contextDefaults.feedType) } : {}),
            ...(doc.contextDefaults.stageCode ? { stageCode: String(doc.contextDefaults.stageCode) } : {}),
            ...(doc.contextDefaults.formulationId ? { formulationId: String(doc.contextDefaults.formulationId) } : {})
        }
        : null,
    archived: doc.archived === true,
    lastMessageAt: doc.lastMessageAt || doc.updatedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
});

const resolveThreadContext = (
    thread: any,
    body: Record<string, unknown>
): {
    formulationId?: string;
    feedType?: 'fish' | 'poultry';
    stageCode?: string;
} => {
    const requestedFeedType = parseFeedType(body.feedType);
    const defaultFeedType = parseFeedType(thread?.contextDefaults?.feedType);
    const feedType = requestedFeedType || defaultFeedType;

    const requestedFormulationId = String(body.formulationId || '').trim();
    const defaultFormulationId = String(thread?.contextDefaults?.formulationId || '').trim();
    const formulationId = requestedFormulationId || defaultFormulationId || undefined;

    const stageCode = pickStageCode(body.stageCode, feedType, thread?.contextDefaults?.stageCode);

    return {
        ...(formulationId ? { formulationId } : {}),
        ...(feedType ? { feedType } : {}),
        ...(stageCode ? { stageCode } : {})
    };
};

const toErrorPayload = (error: unknown) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack
        };
    }
    return { message: String(error) };
};

const splitTextForStreaming = (text: string): string[] => {
    const cleaned = String(text || '').trim();
    if (!cleaned) return [];
    const words = cleaned.split(/\s+/);
    const chunks: string[] = [];
    let current = '';
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length >= 42) {
            chunks.push(candidate);
            current = '';
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
};

const persistJobEvent = async (
    jobId: string,
    userId: string,
    requestId: string,
    eventType: 'status' | 'delta' | 'sources' | 'reasoning_summary' | 'thought_delta' | 'answer_delta' | 'tool_trace' | 'done' | 'error',
    payload: Record<string, unknown>
) => {
    if (!Types.ObjectId.isValid(jobId) || !Types.ObjectId.isValid(userId)) return;
    try {
        await AiJobEvent.create({
            jobId: new Types.ObjectId(jobId),
            userId: new Types.ObjectId(userId),
            requestId,
            eventType,
            payload
        });
    } catch (error) {
        console.error('[AI][job.event] persist failed', toErrorPayload(error));
    }
};

const emitJobEvent = async (
    jobId: string,
    userId: string,
    requestId: string,
    eventType: 'status' | 'delta' | 'sources' | 'reasoning_summary' | 'thought_delta' | 'answer_delta' | 'tool_trace' | 'done' | 'error',
    payload: Record<string, unknown>
) => {
    aiStreamService.publish(jobId, eventType, payload);
    await persistJobEvent(jobId, userId, requestId, eventType, payload);
};

const resolveThreadModelId = async (
    requestedModelId: unknown,
    threadModelId: unknown
): Promise<string | undefined> => {
    const allowlist = await getFreeModelAllowlist();
    const freeModels = await openRouterService.getModels({ freeOnly: true }).catch(() => []);
    const availableIds = freeModels.map((model) => model.id);
    const availableSet = new Set(availableIds);
    const isUsable = (id: string) => Boolean(id) && availableSet.has(id);

    const requested = String(requestedModelId || '').trim();
    const fromThread = String(threadModelId || '').trim();
    if (requested && isUsable(requested)) return requested;
    if (fromThread && isUsable(fromThread)) return fromThread;

    const configs = await configService.getAll();
    const defaultModel = String(configs.ai_default_free_model || process.env.OPENROUTER_DEFAULT_FREE_MODEL || '').trim();
    if (defaultModel && isUsable(defaultModel)) return defaultModel;

    const preferredAvailable = allowlist.filter((id) => availableSet.has(id));
    if (preferredAvailable.length > 0) return preferredAvailable[0];
    if (availableIds.length > 0) return availableIds[0];

    if (requested) return requested;
    if (fromThread) return fromThread;
    if (defaultModel) return defaultModel;
    return allowlist[0];
};

const mapJobDoc = (doc: any) => ({
    id: String(doc._id),
    requestId: doc.requestId,
    threadId: String(doc.threadId),
    userMessageId: doc.userMessageId ? String(doc.userMessageId) : null,
    assistantMessageId: doc.assistantMessageId ? String(doc.assistantMessageId) : null,
    question: doc.question,
    modelId: doc.modelId || null,
    streamRequested: doc.streamRequested !== false,
    context: {
        ...(doc.context?.formulationId ? { formulationId: String(doc.context.formulationId) } : {}),
        ...(doc.context?.feedType ? { feedType: String(doc.context.feedType) } : {}),
        ...(doc.context?.stageCode ? { stageCode: String(doc.context.stageCode) } : {})
    },
    status: doc.status,
    result: doc.result || null,
    errorMessage: doc.errorMessage || null,
    startedAt: doc.startedAt || null,
    completedAt: doc.completedAt || null,
    cancelledAt: doc.cancelledAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
});

const processAnalystJob = async (jobId: string) => {
    if (!Types.ObjectId.isValid(jobId)) return;
    const job = await AiJob.findById(jobId);
    if (!job || job.status !== 'queued') return;

    const startedAt = Date.now();
    job.status = 'processing';
    job.startedAt = new Date();
    await job.save();
    await emitJobEvent(jobId, String(job.userId), job.requestId, 'status', { status: 'processing' });

    try {
        const thread = await AiConversation.findById(job.threadId);
        if (!thread) {
            throw new Error('AI thread not found for job');
        }

        const askResult = await runAnalystQuery({
            userId: String(job.userId),
            threadId: String(job.threadId),
            kind: 'query',
            question: job.question,
            ...(job.context?.formulationId ? { formulationId: String(job.context.formulationId) } : {}),
            ...(job.context?.feedType ? { feedType: job.context.feedType } : {}),
            ...(job.context?.stageCode ? { stageCode: job.context.stageCode } : {}),
            ...(job.modelId ? { modelId: job.modelId } : {}),
            requestId: job.requestId,
            jobId
        });

        const thoughtChunks = splitTextForStreaming(askResult.payload.thoughtProcess || '');
        let emittedThought = '';
        for (const chunk of thoughtChunks) {
            emittedThought = emittedThought ? `${emittedThought} ${chunk}` : chunk;
            await emitJobEvent(jobId, String(job.userId), job.requestId, 'thought_delta', {
                textDelta: chunk,
                currentText: emittedThought
            });
        }

        const answerChunks = splitTextForStreaming(
            askResult.payload.answerContent || askResult.payload.answerMarkdown || askResult.payload.answer
        );
        let emittedAnswer = '';
        for (const chunk of answerChunks) {
            emittedAnswer = emittedAnswer ? `${emittedAnswer} ${chunk}` : chunk;
            await emitJobEvent(jobId, String(job.userId), job.requestId, 'answer_delta', {
                textDelta: chunk,
                currentText: emittedAnswer
            });
            // Backward compatibility for old mobile stream consumers.
            await emitJobEvent(jobId, String(job.userId), job.requestId, 'delta', {
                textDelta: chunk,
                currentText: emittedAnswer
            });
        }

        if (askResult.payload.sources.length > 0) {
            await emitJobEvent(jobId, String(job.userId), job.requestId, 'sources', {
                sources: askResult.payload.sources
            });
        }
        if (askResult.payload.toolTrace.length > 0) {
            await emitJobEvent(jobId, String(job.userId), job.requestId, 'tool_trace', {
                toolTrace: askResult.payload.toolTrace
            });
        }
        if (askResult.payload.reasoningSummary) {
            await emitJobEvent(jobId, String(job.userId), job.requestId, 'reasoning_summary', {
                reasoningSummary: askResult.payload.reasoningSummary
            });
        }

        const assistantMessage = await AiMessage.create({
            conversationId: job.threadId,
            userId: job.userId,
            requestId: job.requestId,
            jobId: job._id,
            role: 'assistant',
            text: askResult.payload.answerContent || askResult.payload.answer,
            rawContent: askResult.payload.rawContent || askResult.payload.answer,
            answerContent: askResult.payload.answerContent || askResult.payload.answer,
            thoughtProcess: askResult.payload.thoughtProcess || undefined,
            modelId: job.modelId,
            citations: askResult.payload.citations,
            numericClaims: askResult.payload.numericClaims,
            sources: askResult.payload.sources,
            responseBlocks: askResult.payload.responseBlocks,
            followUpPrompts: askResult.payload.followUpPrompts,
            toolTrace: askResult.payload.toolTrace,
            confidence: askResult.payload.confidence,
            reasoningSummary: askResult.payload.reasoningSummary || undefined,
            verificationStatus: askResult.payload.verificationStatus,
            fallbackMessage: askResult.payload.fallbackMessage || undefined
        });

        thread.lastMessageAt = assistantMessage.createdAt;
        if (job.modelId) thread.selectedModelId = job.modelId;
        await thread.save();

        job.status = 'completed';
        job.assistantMessageId = assistantMessage._id;
        job.result = {
            payload: askResult.payload,
            meta: askResult.meta
        };
        job.completedAt = new Date();
        await job.save();

        await emitJobEvent(jobId, String(job.userId), job.requestId, 'done', {
            status: 'completed',
            assistantMessage: mapMessageDoc(assistantMessage),
            meta: askResult.meta
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'AI job failed';
        job.status = 'failed';
        job.errorMessage = message;
        job.completedAt = new Date();
        await job.save();
        await emitJobEvent(jobId, String(job.userId), job.requestId, 'error', {
            status: 'failed',
            error: message
        });
    } finally {
        const total = Date.now() - startedAt;
        console.info('[AI][job] processed', {
            jobId,
            status: job.status,
            durationMs: total
        });
    }
};

const mapGuideConversationListItem = (
    doc: any,
    firstQuestion: string | null,
    firstAnswer: string | null
) => ({
    uuid: String(doc._id),
    id: String(doc._id),
    title: String(doc.title || 'Formulation Assistant'),
    selectedModelId: doc.selectedModelId || null,
    streamEnabled: doc.streamEnabled !== false,
    contextDefaults: doc.contextDefaults
        ? {
            ...(doc.contextDefaults.feedType ? { feedType: String(doc.contextDefaults.feedType) } : {}),
            ...(doc.contextDefaults.stageCode ? { stageCode: String(doc.contextDefaults.stageCode) } : {}),
            ...(doc.contextDefaults.formulationId ? { formulationId: String(doc.contextDefaults.formulationId) } : {})
        }
        : null,
    lastMessageAt: toGuideIso(doc.lastMessageAt || doc.updatedAt),
    is_deleted: doc.archived === true,
    is_bookmarked: false,
    created_at: toGuideIso(doc.createdAt),
    updated_at: toGuideIso(doc.updatedAt),
    first_question: firstQuestion,
    first_answer: firstAnswer
});

const mapGuideMessage = (
    doc: any,
    turnId: number,
    interactionByRequestId: Map<string, any>
) => {
    const messageType = toGuideMessageType(String(doc.role || 'assistant'));
    const requestId = String(doc.requestId || '').trim();
    const interaction = requestId ? interactionByRequestId.get(requestId) : null;
    const rawContent = String(doc.rawContent || doc.text || '').trim();
    const thoughtExtraction = extractThoughtProcess(rawContent);
    const answerContent = String(doc.answerContent || thoughtExtraction.answerContent || doc.text || '').trim();
    const thoughtProcess = String(doc.thoughtProcess || thoughtExtraction.thoughtProcess || '').trim() || null;
    const toolTrace = Array.isArray(doc.toolTrace) ? doc.toolTrace : [];

    const base = {
        type: messageType,
        id: turnId,
        conversation_uuid: String(doc.conversationId),
        content: rawContent || String(doc.text || ''),
        tag: 'PRODUCTION',
        source: 'AquaFeed API',
        version: toGuideVersion(),
        created_at: toGuideIso(doc.createdAt),
        answer_content: answerContent,
        thought_process: thoughtProcess,
        tool_trace: toolTrace
    } as Record<string, unknown>;

    if (messageType === 'OUTPUT') {
        const toolCalls = toolTrace.filter((trace: any) => String(trace?.type || '').toLowerCase() === 'tool_call');
        base.context = JSON.stringify([
            { role: 'assistant', content: answerContent }
        ]);
        base.tool_calls = JSON.stringify(toolCalls);
        base.total_tokens = Number(interaction?.totalTokens || 0);
        base.rating = 0;
        base.detected_districts = null;
        base.detected_postcodes = null;
        base.verification_status = doc.verificationStatus || null;
        base.fallback_message = doc.fallbackMessage || null;
    }

    return base;
};

const createGuideAssistantMessage = async ({
    threadObjectId,
    userObjectId,
    requestId,
    resolvedModelId,
    askResult
}: {
    threadObjectId: Types.ObjectId;
    userObjectId: Types.ObjectId;
    requestId: string;
    resolvedModelId?: string;
    askResult: {
        payload: AiAnalystResponse;
        meta: Record<string, unknown>;
    };
}) => (
    AiMessage.create({
        conversationId: threadObjectId,
        userId: userObjectId,
        requestId,
        role: 'assistant',
        text: askResult.payload.answerContent || askResult.payload.answer,
        rawContent: askResult.payload.rawContent || askResult.payload.answer,
        answerContent: askResult.payload.answerContent || askResult.payload.answer,
        thoughtProcess: askResult.payload.thoughtProcess || undefined,
        modelId: resolvedModelId,
        citations: askResult.payload.citations,
        numericClaims: askResult.payload.numericClaims,
        sources: askResult.payload.sources,
        responseBlocks: askResult.payload.responseBlocks,
        followUpPrompts: askResult.payload.followUpPrompts,
        toolTrace: askResult.payload.toolTrace,
        confidence: askResult.payload.confidence,
        reasoningSummary: askResult.payload.reasoningSummary || undefined,
        verificationStatus: askResult.payload.verificationStatus,
        fallbackMessage: askResult.payload.fallbackMessage || undefined
    })
);

export const getAiConversations = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user context' });
        }
        const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '40'), 10) || 40));
        const conversations = await AiConversation.find({ userId: userObjectId })
            .sort({ updatedAt: -1 })
            .limit(limit)
            .lean();

        const conversationIds = conversations.map((conversation) => conversation._id);
        const firstMessages = await AiMessage.aggregate([
            { $match: { conversationId: { $in: conversationIds } } },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: {
                        conversationId: '$conversationId',
                        role: '$role'
                    },
                    text: { $first: '$text' },
                    rawContent: { $first: '$rawContent' }
                }
            }
        ]);

        const firstByConversation = new Map<string, { user?: string; assistant?: string }>();
        firstMessages.forEach((row) => {
            const conversationId = String(row._id?.conversationId || '');
            const role = String(row._id?.role || '');
            if (!conversationId) return;
            const existing = firstByConversation.get(conversationId) || {};
            if (role === 'user') existing.user = String(row.text || '').trim();
            if (role === 'assistant') existing.assistant = String(row.rawContent || row.text || '').trim();
            firstByConversation.set(conversationId, existing);
        });

        return res.json({
            status: 'success',
            data: conversations.map((conversation) => {
                const first = firstByConversation.get(String(conversation._id));
                const firstAssistant = first?.assistant ? String(first.assistant) : '';
                const firstQuestion = firstAssistant ? summarizeAssistantTurn(firstAssistant) : null;
                const firstAnswer = firstAssistant ? stripReasoningArtifacts(firstAssistant) : null;
                return mapGuideConversationListItem(conversation, firstQuestion, firstAnswer);
            })
        });
    } catch (error) {
        console.error('[AI][conversations.list] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to load conversations' });
    }
};

export const getAiConversationByUuid = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        const conversationObjectId = toObjectId(req.params.uuid);
        if (!userObjectId || !conversationObjectId) {
            return res.status(400).json({ error: 'Invalid conversation id' });
        }

        const conversation = await AiConversation.findOne({
            _id: conversationObjectId,
            userId: userObjectId
        }).lean();
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const messages = await AiMessage.find({
            conversationId: conversationObjectId,
            userId: userObjectId
        })
            .sort({ createdAt: 1 })
            .lean();

        const requestIds = Array.from(new Set(
            messages
                .map((message) => String(message.requestId || '').trim())
                .filter(Boolean)
        ));
        const interactions = requestIds.length > 0
            ? await AiInteraction.find({
                userId: userObjectId,
                requestId: { $in: requestIds }
            }).lean()
            : [];
        const interactionByRequestId = new Map(
            interactions.map((interaction: any) => [String(interaction.requestId), interaction])
        );

        const firstAssistant = messages.find((message: any) => message.role === 'assistant');
        const firstQuestion = firstAssistant
            ? summarizeAssistantTurn(String(firstAssistant.rawContent || firstAssistant.text || ''))
            : null;
        const firstAnswer = firstAssistant
            ? stripReasoningArtifacts(String(firstAssistant.rawContent || firstAssistant.text || ''))
            : null;

        return res.json({
            status: 'success',
            data: {
                uuid: String(conversation._id),
                user_uuid: String(conversation.userId),
                is_deleted: conversation.archived === true,
                is_bookmarked: false,
                created_at: toGuideIso(conversation.createdAt),
                messages: messages.map((message, index) => mapGuideMessage(message, index + 1, interactionByRequestId))
            },
            meta: {
                first_question: firstQuestion,
                first_answer: firstAnswer
            }
        });
    } catch (error) {
        console.error('[AI][conversations.detail] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to load conversation' });
    }
};

export const createAiConversation = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user context' });
        }

        const title = String(req.body?.title || '').trim() || 'Formulation Assistant';
        const feedType = parseFeedType(req.body?.feedType);
        const stageCode = pickStageCode(req.body?.stageCode, feedType);
        const formulationId = String(req.body?.formulationId || '').trim();
        const initialInput = String(req.body?.content || req.body?.message || '').trim();
        if (!initialInput) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['content']
            });
        }

        const thread = await AiConversation.create({
            userId: userObjectId,
            title,
            contextDefaults: {
                ...(feedType ? { feedType } : {}),
                ...(stageCode ? { stageCode } : {}),
                ...(formulationId && Types.ObjectId.isValid(formulationId)
                    ? { formulationId: new Types.ObjectId(formulationId) }
                    : {})
            },
            archived: false,
            streamEnabled: true,
            lastMessageAt: new Date()
        });

        await AiMessage.create({
            conversationId: thread._id,
            userId: userObjectId,
            role: 'user',
            text: initialInput
        });

        return res.status(201).json({
            status: 'success',
            data: {
                uuid: String(thread._id),
                user_uuid: String(userObjectId),
                is_deleted: false,
                is_bookmarked: false,
                created_at: toGuideIso(thread.createdAt),
                updated_at: toGuideIso(thread.updatedAt)
            }
        });
    } catch (error) {
        console.error('[AI][conversations.create] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to create conversation' });
    }
};

export const postAiConversationMessage = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        const conversationObjectId = toObjectId(req.params.uuid);
        if (!userObjectId || !conversationObjectId) {
            return res.status(400).json({ error: 'Invalid conversation id' });
        }
        const thread = await AiConversation.findOne({
            _id: conversationObjectId,
            userId: userObjectId
        });
        if (!thread) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const question = String(req.body?.message || req.body?.content || '').trim();
        if (!question) {
            return res.status(400).json({ error: 'Missing required fields', required: ['message'] });
        }

        const context = resolveThreadContext(thread, req.body || {});
        const requestId = randomUUID();
        const resolvedModelId = await resolveThreadModelId(req.body?.modelId, thread.selectedModelId);

        const userMessage = await AiMessage.create({
            conversationId: conversationObjectId,
            userId: userObjectId,
            requestId,
            role: 'user',
            text: question
        });

        const askResult = await runAnalystQuery({
            userId,
            threadId: String(conversationObjectId),
            kind: 'query',
            question,
            ...context,
            ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
            ...(req.body?.maxTokens ? { maxTokens: Number(req.body.maxTokens) } : {}),
            requestId
        });

        const assistantMessage = await createGuideAssistantMessage({
            threadObjectId: conversationObjectId,
            userObjectId,
            requestId,
            resolvedModelId,
            askResult
        });
        thread.lastMessageAt = assistantMessage.createdAt;
        if (resolvedModelId) thread.selectedModelId = resolvedModelId;
        await thread.save();

        const interactions = await AiInteraction.find({
            userId: userObjectId,
            requestId: { $in: [requestId] }
        }).lean();
        const interactionByRequestId = new Map(
            interactions.map((interaction: any) => [String(interaction.requestId), interaction])
        );

        const messages = [userMessage, assistantMessage];
        return res.json({
            status: 'success',
            data: {
                uuid: String(thread._id),
                user_uuid: String(userObjectId),
                is_deleted: thread.archived === true,
                is_bookmarked: false,
                created_at: toGuideIso(thread.createdAt),
                messages: messages.map((message, index) => mapGuideMessage(message, index + 1, interactionByRequestId))
            }
        });
    } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 500);
        console.error('[AI][conversations.message] failed', {
            conversationId: req.params.uuid,
            statusCode,
            ...toErrorPayload(error)
        });
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : 'Failed to send conversation message'
        });
    }
};

export const queryFormulationAnalyst = async (req: Request, res: Response) => {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }

    const question = String(req.body?.question || req.body?.prompt || '').trim();
    if (!question) {
        return res.status(400).json({ error: 'Missing required fields', required: ['question'] });
    }

    const feedType = parseFeedType(req.body?.feedType);
    const stageCode = pickStageCode(req.body?.stageCode, feedType);
    const formulationId = String(req.body?.formulationId || '').trim() || undefined;

    console.info('[AI][query] request', {
        userId,
        hasFormulationId: Boolean(formulationId),
        feedType: feedType || null,
        stageCode: stageCode || null
    });

    const requestId = randomUUID();
    try {
        const result = await runAnalystQuery({
            userId,
            kind: 'query',
            question,
            ...(formulationId ? { formulationId } : {}),
            ...(feedType ? { feedType } : {}),
            ...(stageCode ? { stageCode } : {}),
            ...(req.body?.modelId ? { modelId: String(req.body.modelId).trim() } : {}),
            ...(req.body?.maxTokens ? { maxTokens: Number(req.body.maxTokens) } : {}),
            requestId
        });
        return res.json({ ...result.payload, meta: { ...result.meta, requestId } });
    } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 500);
        console.error('[AI][query] failed', {
            userId,
            statusCode,
            ...toErrorPayload(error)
        });
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : 'AI request failed'
        });
    }
};

export const whatIfFormulationAnalyst = async (req: Request, res: Response) => {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }

    const question = String(req.body?.question || req.body?.prompt || '').trim();
    if (!question) {
        return res.status(400).json({ error: 'Missing required fields', required: ['question'] });
    }

    const feedType = parseFeedType(req.body?.feedType);
    const stageCode = pickStageCode(req.body?.stageCode, feedType);
    const formulationId = String(req.body?.formulationId || '').trim() || undefined;

    console.info('[AI][what-if] request', {
        userId,
        hasFormulationId: Boolean(formulationId),
        feedType: feedType || null,
        stageCode: stageCode || null
    });

    const requestId = randomUUID();
    try {
        const result = await runAnalystQuery({
            userId,
            kind: 'what_if',
            question,
            ...(formulationId ? { formulationId } : {}),
            ...(feedType ? { feedType } : {}),
            ...(stageCode ? { stageCode } : {}),
            ...(req.body?.modelId ? { modelId: String(req.body.modelId).trim() } : {}),
            ...(req.body?.maxTokens ? { maxTokens: Number(req.body.maxTokens) } : {}),
            requestId
        });
        return res.json({ ...result.payload, meta: { ...result.meta, requestId } });
    } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 500);
        console.error('[AI][what-if] failed', {
            userId,
            statusCode,
            ...toErrorPayload(error)
        });
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : 'AI request failed'
        });
    }
};

export const createFormulationAnalystThread = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const userObjectId = toObjectId(userId);
        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user context' });
        }

        const feedType = parseFeedType(req.body?.contextDefaults?.feedType);
        const stageCode = pickStageCode(req.body?.contextDefaults?.stageCode, feedType);
        const formulationIdRaw = String(req.body?.contextDefaults?.formulationId || '').trim();
        const formulationObjectId = formulationIdRaw && Types.ObjectId.isValid(formulationIdRaw)
            ? new Types.ObjectId(formulationIdRaw)
            : undefined;
        const title = String(req.body?.title || '').trim() || 'Formulation Assistant';
        const defaultModelId = await resolveThreadModelId(undefined, undefined);
        const streamEnabled = req.body?.streamEnabled === false ? false : true;

        const thread = await AiConversation.create({
            userId: userObjectId,
            title,
            contextDefaults: {
                ...(feedType ? { feedType } : {}),
                ...(stageCode ? { stageCode } : {}),
                ...(formulationObjectId ? { formulationId: formulationObjectId } : {})
            },
            ...(defaultModelId ? { selectedModelId: defaultModelId } : {}),
            streamEnabled,
            archived: false,
            lastMessageAt: new Date()
        });

        console.info('[AI][thread.create] success', {
            userId,
            threadId: String(thread._id),
            feedType: feedType || null,
            stageCode: stageCode || null,
            hasFormulationId: Boolean(formulationObjectId),
            selectedModelId: defaultModelId || null,
            streamEnabled
        });

        return res.status(201).json({ thread: mapThreadDoc(thread) });
    } catch (error) {
        console.error('[AI][thread.create] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to create analyst thread' });
    }
};

export const getFormulationAnalystThreads = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const userObjectId = toObjectId(userId);
        if (!userObjectId) {
            return res.status(400).json({ error: 'Invalid user context' });
        }

        const includeArchived = String(req.query.includeArchived || '').trim().toLowerCase() === 'true';
        const limit = Math.max(1, Math.min(100, Number.parseInt(String(req.query.limit || '40'), 10) || 40));

        const threads = await AiConversation.find({
            userId: userObjectId,
            ...(includeArchived ? {} : { archived: false })
        })
            .sort({ lastMessageAt: -1, updatedAt: -1 })
            .limit(limit)
            .lean();

        const threadIds = threads.map((thread) => thread._id);
        const lastMessages = await AiMessage.aggregate([
            { $match: { conversationId: { $in: threadIds } } },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$conversationId',
                    text: { $first: '$text' },
                    role: { $first: '$role' },
                    createdAt: { $first: '$createdAt' }
                }
            }
        ]);
        const lastMessageByThread = new Map(lastMessages.map((item) => [String(item._id), item]));

        const firstMessages = await AiMessage.aggregate([
            { $match: { conversationId: { $in: threadIds } } },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: {
                        conversationId: '$conversationId',
                        role: '$role'
                    },
                    text: { $first: '$text' },
                    createdAt: { $first: '$createdAt' }
                }
            }
        ]);

        const firstMessageByThread = new Map<string, { user?: string; assistant?: string }>();
        firstMessages.forEach((item) => {
            const conversationId = String(item._id?.conversationId || '');
            const role = String(item._id?.role || '');
            if (!conversationId || !role) return;
            const existing = firstMessageByThread.get(conversationId) || {};
            if (role === 'user') existing.user = String(item.text || '').trim();
            if (role === 'assistant') existing.assistant = String(item.text || '').trim();
            firstMessageByThread.set(conversationId, existing);
        });

        console.info('[AI][thread.list] success', {
            userId,
            count: threads.length,
            includeArchived
        });

        return res.json({
            threads: threads.map((thread) => {
                const last = lastMessageByThread.get(String(thread._id));
                const first = firstMessageByThread.get(String(thread._id));
                const firstAssistant = first?.assistant ? String(first.assistant) : '';
                const firstQuestionSummary = firstAssistant ? summarizeAssistantTurn(firstAssistant) : null;
                const firstAnswer = firstAssistant ? stripReasoningArtifacts(firstAssistant) : null;
                return {
                    ...mapThreadDoc(thread),
                    first_question: firstQuestionSummary,
                    first_answer: firstAnswer,
                    lastMessage: last
                        ? {
                            text: String(last.text || ''),
                            role: String(last.role || ''),
                            createdAt: last.createdAt
                        }
                        : null
                };
            })
        });
    } catch (error) {
        console.error('[AI][thread.list] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to load analyst threads' });
    }
};

export const getFormulationAnalystThreadMessages = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const userObjectId = toObjectId(userId);
        const threadObjectId = toObjectId(req.params.threadId);
        if (!userObjectId || !threadObjectId) {
            return res.status(400).json({ error: 'Invalid thread id' });
        }

        const thread = await AiConversation.findOne({
            _id: threadObjectId,
            userId: userObjectId
        }).lean();
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit || '80'), 10) || 80));
        const before = String(req.query.before || '').trim();
        const beforeDate = before ? new Date(before) : null;

        const messages = await AiMessage.find({
            conversationId: threadObjectId,
            userId: userObjectId,
            ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { $lt: beforeDate } } : {})
        })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const ordered = messages.reverse();
        console.info('[AI][thread.messages] success', {
            userId,
            threadId: String(threadObjectId),
            count: ordered.length
        });

        return res.json({
            thread: mapThreadDoc(thread),
            messages: ordered.map(mapMessageDoc)
        });
    } catch (error) {
        console.error('[AI][thread.messages] failed', {
            threadId: req.params.threadId,
            ...toErrorPayload(error)
        });
        return res.status(500).json({ error: 'Failed to load analyst messages' });
    }
};

export const getFormulationAnalystModels = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const allowlist = await getFreeModelAllowlist();
        const models = await openRouterService.getModels({ freeOnly: true });
        const preferred = allowlist.length > 0
            ? models.filter((model) => allowlist.includes(model.id))
            : [];
        const preferredIds = new Set(preferred.map((model) => model.id));
        const extras = models.filter((model) => !preferredIds.has(model.id));
        const filtered = preferred.length > 0 ? [...preferred, ...extras] : models;

        const configs = await configService.getAll();
        const configuredDefault = String(configs.ai_default_free_model || process.env.OPENROUTER_DEFAULT_FREE_MODEL || '').trim();
        const defaultModelId = pickPreferredModelId(
            (preferred.length > 0 ? preferred : filtered).map((model) => model.id),
            configuredDefault
        );

        return res.json({
            defaultModelId,
            models: filtered
        });
    } catch (error) {
        console.error('[AI][models] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to load AI models' });
    }
};

export const updateFormulationAnalystThreadSettings = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const userObjectId = toObjectId(userId);
        const threadObjectId = toObjectId(req.params.threadId);
        if (!userObjectId || !threadObjectId) {
            return res.status(400).json({ error: 'Invalid thread id' });
        }

        const thread = await AiConversation.findOne({ _id: threadObjectId, userId: userObjectId });
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const resolvedModelId = await resolveThreadModelId(req.body?.modelId, thread.selectedModelId);
        if (resolvedModelId) thread.selectedModelId = resolvedModelId;
        if (typeof req.body?.streamEnabled === 'boolean') {
            thread.streamEnabled = req.body.streamEnabled;
        }
        await thread.save();

        return res.json({ thread: mapThreadDoc(thread) });
    } catch (error) {
        console.error('[AI][thread.settings] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to update thread settings' });
    }
};

export const submitFormulationAnalystThreadMessage = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        const threadObjectId = toObjectId(req.params.threadId);
        if (!userObjectId || !threadObjectId) {
            return res.status(400).json({ error: 'Invalid thread id' });
        }
        const thread = await AiConversation.findOne({ _id: threadObjectId, userId: userObjectId });
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const question = String(req.body?.message || req.body?.question || '').trim();
        if (!question) {
            return res.status(400).json({ error: 'Missing required fields', required: ['message'] });
        }

        const resolvedModelId = await resolveThreadModelId(req.body?.modelId, thread.selectedModelId);
        const streamRequested = req.body?.stream === false ? false : (thread.streamEnabled !== false);
        const context = resolveThreadContext(thread, req.body || {});
        const requestId = randomUUID();

        if (resolvedModelId) {
            thread.selectedModelId = resolvedModelId;
        }
        thread.streamEnabled = streamRequested;
        await thread.save();

        const userMessage = await AiMessage.create({
            conversationId: threadObjectId,
            userId: userObjectId,
            requestId,
            role: 'user',
            text: question
        });

        const job = await AiJob.create({
            userId: userObjectId,
            threadId: threadObjectId,
            userMessageId: userMessage._id,
            requestId,
            question,
            ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
            streamRequested,
            context: {
                ...(context.formulationId && Types.ObjectId.isValid(context.formulationId)
                    ? { formulationId: new Types.ObjectId(context.formulationId) }
                    : {}),
                ...(context.feedType ? { feedType: context.feedType } : {}),
                ...(context.stageCode ? { stageCode: context.stageCode } : {})
            },
            status: 'queued'
        });

        await emitJobEvent(String(job._id), userId, requestId, 'status', { status: 'queued' });
        setImmediate(() => {
            processAnalystJob(String(job._id)).catch((error) => {
                console.error('[AI][job] unhandled', { jobId: String(job._id), ...toErrorPayload(error) });
            });
        });

        return res.status(202).json({
            status: 'queued',
            requestId,
            job: mapJobDoc(job),
            thread: mapThreadDoc(thread),
            userMessage: mapMessageDoc(userMessage)
        });
    } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 500);
        console.error('[AI][thread.submit] failed', {
            threadId: req.params.threadId,
            statusCode,
            ...toErrorPayload(error)
        });
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : 'Failed to submit analyst message'
        });
    }
};

export const getFormulationAnalystJobStatus = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        const jobObjectId = toObjectId(req.params.jobId);
        if (!userObjectId || !jobObjectId) {
            return res.status(400).json({ error: 'Invalid job id' });
        }

        const job = await AiJob.findOne({ _id: jobObjectId, userId: userObjectId }).lean();
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        const assistantMessage = job.assistantMessageId
            ? await AiMessage.findOne({ _id: job.assistantMessageId, userId: userObjectId }).lean()
            : null;

        return res.json({
            job: mapJobDoc(job),
            assistantMessage: assistantMessage ? mapMessageDoc(assistantMessage) : null
        });
    } catch (error) {
        console.error('[AI][job.status] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to fetch AI job status' });
    }
};

export const streamFormulationAnalystJob = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        const jobObjectId = toObjectId(req.params.jobId);
        if (!userObjectId || !jobObjectId) {
            return res.status(400).json({ error: 'Invalid job id' });
        }

        const job = await AiJob.findOne({ _id: jobObjectId, userId: userObjectId }).lean();
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const writeEvent = (eventType: string, payload: Record<string, unknown>) => {
            res.write(`event: ${eventType}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        writeEvent('status', { status: job.status, jobId: String(job._id), requestId: job.requestId });

        const history = await AiJobEvent.find({ jobId: jobObjectId }).sort({ createdAt: 1 }).lean();
        history.forEach((event) => {
            writeEvent(event.eventType, event.payload || {});
        });

        const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
        if (terminalStatuses.has(String(job.status))) {
            writeEvent('done', { status: job.status, terminal: true });
            res.end();
            return;
        }

        let heartbeat: NodeJS.Timeout | null = null;
        const unsubscribe = aiStreamService.subscribe(String(jobObjectId), (event) => {
            writeEvent(event.type, event.payload);
            if (event.type === 'done' || event.type === 'error') {
                unsubscribe();
                if (heartbeat) clearInterval(heartbeat);
                res.end();
            }
        });

        heartbeat = setInterval(() => {
            res.write(': keep-alive\n\n');
        }, 15000);

        req.on('close', () => {
            unsubscribe();
            if (heartbeat) clearInterval(heartbeat);
        });
    } catch (error) {
        console.error('[AI][job.stream] failed', toErrorPayload(error));
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Failed to stream AI job events' });
        }
        return res.end();
    }
};

export const cancelFormulationAnalystJob = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const userObjectId = toObjectId(userId);
        const jobObjectId = toObjectId(req.params.jobId);
        if (!userObjectId || !jobObjectId) {
            return res.status(400).json({ error: 'Invalid job id' });
        }

        const job = await AiJob.findOne({ _id: jobObjectId, userId: userObjectId });
        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }
        if (job.status === 'completed' || job.status === 'failed') {
            return res.status(409).json({ error: 'Job already completed' });
        }

        job.status = 'cancelled';
        job.cancelledAt = new Date();
        await job.save();
        await emitJobEvent(String(job._id), userId, job.requestId, 'status', { status: 'cancelled' });
        await emitJobEvent(String(job._id), userId, job.requestId, 'error', { status: 'cancelled', error: 'Cancelled by user' });

        return res.json({ status: 'cancelled', job: mapJobDoc(job) });
    } catch (error) {
        console.error('[AI][job.cancel] failed', toErrorPayload(error));
        return res.status(500).json({ error: 'Failed to cancel AI job' });
    }
};

export const postFormulationAnalystThreadMessage = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const userObjectId = toObjectId(userId);
        const threadObjectId = toObjectId(req.params.threadId);
        if (!userObjectId || !threadObjectId) {
            return res.status(400).json({ error: 'Invalid thread id' });
        }

        const thread = await AiConversation.findOne({
            _id: threadObjectId,
            userId: userObjectId
        });
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const question = String(req.body?.message || req.body?.question || '').trim();
        if (!question) {
            return res.status(400).json({ error: 'Missing required fields', required: ['message'] });
        }

        const context = resolveThreadContext(thread, req.body || {});
        const requestId = randomUUID();
        const resolvedModelId = await resolveThreadModelId(req.body?.modelId, thread.selectedModelId);
        const streamEnabled = req.body?.stream === false ? false : (thread.streamEnabled !== false);
        console.info('[AI][thread.message] request', {
            userId,
            threadId: String(threadObjectId),
            hasFormulationId: Boolean(context.formulationId),
            feedType: context.feedType || null,
            stageCode: context.stageCode || null,
            modelId: resolvedModelId || null,
            streamEnabled
        });

        const userMessage = await AiMessage.create({
            conversationId: threadObjectId,
            userId: userObjectId,
            requestId,
            role: 'user',
            text: question
        });

        const askResult = await runAnalystQuery({
            userId,
            threadId: String(threadObjectId),
            kind: 'query',
            question,
            ...context,
            ...(resolvedModelId ? { modelId: resolvedModelId } : {}),
            requestId
        });

        const assistantMessage = await AiMessage.create({
            conversationId: threadObjectId,
            userId: userObjectId,
            requestId,
            role: 'assistant',
            text: askResult.payload.answerContent || askResult.payload.answer,
            rawContent: askResult.payload.rawContent || askResult.payload.answer,
            answerContent: askResult.payload.answerContent || askResult.payload.answer,
            thoughtProcess: askResult.payload.thoughtProcess || undefined,
            modelId: resolvedModelId,
            citations: askResult.payload.citations,
            numericClaims: askResult.payload.numericClaims,
            sources: askResult.payload.sources,
            responseBlocks: askResult.payload.responseBlocks,
            followUpPrompts: askResult.payload.followUpPrompts,
            toolTrace: askResult.payload.toolTrace,
            confidence: askResult.payload.confidence,
            reasoningSummary: askResult.payload.reasoningSummary || undefined,
            verificationStatus: askResult.payload.verificationStatus,
            fallbackMessage: askResult.payload.fallbackMessage || undefined
        });

        if (thread.title === 'Formulation Assistant') {
            thread.title = buildThreadTitle(question);
        }
        if (resolvedModelId) {
            thread.selectedModelId = resolvedModelId;
        }
        thread.streamEnabled = streamEnabled;
        thread.lastMessageAt = assistantMessage.createdAt;
        await thread.save();

        console.info('[AI][thread.message] success', {
            userId,
            threadId: String(threadObjectId),
            verificationStatus: askResult.payload.verificationStatus
        });

        return res.json({
            thread: mapThreadDoc(thread),
            userMessage: mapMessageDoc(userMessage),
            assistantMessage: mapMessageDoc(assistantMessage),
            meta: { ...askResult.meta, requestId }
        });
    } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 500);
        console.error('[AI][thread.message] failed', {
            threadId: req.params.threadId,
            statusCode,
            ...toErrorPayload(error)
        });
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : 'Failed to send analyst message'
        });
    }
};

export const postFormulationAnalystScenario = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const userObjectId = toObjectId(userId);
        const threadObjectId = toObjectId(req.params.threadId);
        if (!userObjectId || !threadObjectId) {
            return res.status(400).json({ error: 'Invalid thread id' });
        }

        const thread = await AiConversation.findOne({
            _id: threadObjectId,
            userId: userObjectId
        });
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        const scenarioType = normalizeScenarioType(req.body?.scenarioType);
        const context = resolveThreadContext(thread, req.body || {});
        const requestId = randomUUID();
        const startedAt = Date.now();

        console.info('[AI][thread.scenario] request', {
            userId,
            threadId: String(threadObjectId),
            scenarioType,
            hasFormulationId: Boolean(context.formulationId)
        });

        const scenarioResult = await runScenarioSimulation({
            userId,
            scenarioType,
            formulationId: context.formulationId,
            parameters: req.body?.parameters
        });

        const userScenarioText = formatScenarioLabel(scenarioType);
        const userMessage = await AiMessage.create({
            conversationId: threadObjectId,
            userId: userObjectId,
            requestId,
            role: 'user',
            text: userScenarioText
        });
        const assistantText = [
            scenarioResult.title,
            scenarioResult.summary,
            scenarioResult.recommendations.length > 0
                ? `Next actions: ${scenarioResult.recommendations.join(' ')}`
                : ''
        ].filter(Boolean).join('\n\n');

        const assistantMessage = await AiMessage.create({
            conversationId: threadObjectId,
            userId: userObjectId,
            requestId,
            role: 'assistant',
            text: assistantText,
            rawContent: assistantText,
            answerContent: assistantText,
            citations: scenarioResult.citations,
            numericClaims: scenarioResult.numericClaims,
            toolTrace: [
                {
                    type: 'tool_call',
                    name: 'scenario_simulation',
                    status: 'success',
                    arguments: {
                        scenarioType,
                        parameters: req.body?.parameters || {}
                    }
                },
                {
                    type: 'tool_result',
                    name: 'scenario_simulation',
                    status: 'success',
                    result: scenarioResult
                }
            ],
            verificationStatus: 'passed',
            scenario: {
                scenarioType,
                inputs: req.body?.parameters || {},
                result: scenarioResult
            }
        });

        thread.lastMessageAt = assistantMessage.createdAt;
        await thread.save();

        await AiInteraction.create({
            userId,
            threadId: threadObjectId,
            requestId,
            ...(context.formulationId ? { formulationId: context.formulationId } : {}),
            kind: 'what_if',
            status: 'success',
            verificationStatus: 'passed',
            prompt: userScenarioText,
            answer: assistantText,
            citations: scenarioResult.citations,
            numericClaims: scenarioResult.numericClaims,
            verificationErrors: [],
            modelPrimary: 'deterministic-simulation',
            modelFallback: 'deterministic-simulation',
            modelUsed: 'deterministic-simulation',
            fallbackUsed: false,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            pricingSource: 'unknown',
            latencyMs: Date.now() - startedAt,
            attempts: [
                {
                    model: 'deterministic-simulation',
                    latencyMs: Date.now() - startedAt,
                    status: 'success'
                }
            ]
        });

        console.info('[AI][thread.scenario] success', {
            userId,
            threadId: String(threadObjectId),
            scenarioType
        });

        return res.json({
            thread: mapThreadDoc(thread),
            userMessage: mapMessageDoc(userMessage),
            assistantMessage: mapMessageDoc(assistantMessage),
            scenario: scenarioResult
        });
    } catch (error) {
        const statusCode = Number((error as any)?.statusCode || 500);
        console.error('[AI][thread.scenario] failed', {
            threadId: req.params.threadId,
            statusCode,
            ...toErrorPayload(error)
        });
        return res.status(statusCode).json({
            error: error instanceof Error ? error.message : 'Failed to run analyst scenario'
        });
    }
};

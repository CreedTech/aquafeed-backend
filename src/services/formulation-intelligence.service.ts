import { Types } from 'mongoose';
import Formulation from '../models/Formulation';
import FeedStandard from '../models/FeedStandard';
import { normalizeStageCode, resolveCanonicalStageCode } from '../utils/stage-code.util';

type FeedType = 'fish' | 'poultry';
type TrendMetric = 'costPerKg' | 'qualityMatch' | 'complianceRate';
type TrendInterval = 'day' | 'week';

type AnalyticsQuery = {
    userId?: string;
    from?: Date;
    to?: Date;
    feedType?: FeedType;
    stageCode?: string;
};

type StageAggregate = {
    count: number;
    qualityTotal: number;
    costTotal: number;
    compliantCount: number;
};

type CostDriverAggregate = {
    usageCount: number;
    qtyKgTotal: number;
    lineCostTotal: number;
    avgPriceAccumulator: number;
};

type NutrientMissAggregate = {
    evaluatedCount: number;
    belowCount: number;
    aboveCount: number;
};

type TrendAggregate = {
    count: number;
    compliantCount: number;
    costTotal: number;
    qualityTotal: number;
};

type NutrientRange = {
    min?: number;
    max?: number;
};

const NUTRIENT_UNITS: Record<string, string> = {
    energy: 'kcal/kg',
    protein: '%',
    fat: '%',
    carbohydrate: '%',
    fiber: '%',
    ash: '%',
    lysine: '%',
    methionine: '%',
    calcium: '%',
    phosphorous: '%'
};

const toNumber = (value: unknown, fallback = 0): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

    const toObjectId = (id: string): Types.ObjectId => new Types.ObjectId(id);

const normalizeFeedType = (feedCategory: unknown): FeedType => (
    String(feedCategory || '').toLowerCase() === 'poultry' ? 'poultry' : 'fish'
);

const toNutrientRange = (raw: unknown): NutrientRange => {
    if (!raw || typeof raw !== 'object') return {};
    const typed = raw as Record<string, unknown>;
    const min = typed.min !== undefined ? toNumber(typed.min, NaN) : undefined;
    const max = typed.max !== undefined ? toNumber(typed.max, NaN) : undefined;
    return {
        ...(min !== undefined && Number.isFinite(min) ? { min } : {}),
        ...(max !== undefined && Number.isFinite(max) ? { max } : {})
    };
};

const getDateBucket = (date: Date, interval: TrendInterval): string => {
    if (interval === 'day') {
        return date.toISOString().slice(0, 10);
    }

    // ISO week bucket: YYYY-WNN
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const getFormulationFilters = (query: AnalyticsQuery) => {
    const match: Record<string, unknown> = {};
    if (query.userId && Types.ObjectId.isValid(query.userId)) {
        match.userId = toObjectId(query.userId);
    }
    if (query.from || query.to) {
        const createdAt: Record<string, Date> = {};
        if (query.from) createdAt.$gte = query.from;
        if (query.to) createdAt.$lte = query.to;
        match.createdAt = createdAt;
    }
    return match;
};

const applyStandardFilters = (
    rows: any[],
    feedType?: FeedType,
    stageCode?: string
) => rows.filter((row) => {
    const standard = row.standardUsed || {};
    const normalizedFeedType = normalizeFeedType(standard.feedCategory);
    const normalizedStageCode = normalizedFeedType === 'fish'
        ? resolveCanonicalStageCode(standard.stageCode, {
            feedType: 'fish',
            stageLabel: standard.stage
        })
        : normalizeStageCode(standard.stageCode);
    const requestedStageCode = stageCode
        ? resolveCanonicalStageCode(stageCode, {
            feedType: feedType || normalizedFeedType
        })
        : undefined;
    if (feedType && normalizedFeedType !== feedType) return false;
    if (requestedStageCode && normalizedStageCode !== requestedStageCode) return false;
    return true;
});

export interface AnalyticsOverview {
    summary: {
        totalMixes: number;
        unlockedMixes: number;
        unlockConversionPct: number;
        compliantMixes: number;
        complianceRatePct: number;
        avgQualityMatch: number;
        minCostPerKg: number;
        avgCostPerKg: number;
        maxCostPerKg: number;
        totalCost: number;
    };
    feedTypeBreakdown: {
        fish: number;
        poultry: number;
    };
    stagePerformance: Array<{
        stageCode: string;
        stageLabel: string;
        count: number;
        avgQualityMatch: number;
        avgCostPerKg: number;
        complianceRatePct: number;
    }>;
    topCostDrivers: Array<{
        ingredientName: string;
        usageCount: number;
        qtyKgTotal: number;
        lineCostTotal: number;
        avgPriceAtMoment: number;
        costSharePct: number;
    }>;
    nutrientMissFrequency: Array<{
        nutrient: string;
        evaluatedCount: number;
        belowCount: number;
        aboveCount: number;
        missRatePct: number;
    }>;
}

export interface TrendPoint {
    bucket: string;
    value: number;
    sampleCount: number;
}

export interface CalculationEquationRow {
    factId: string;
    label: string;
    equation: string;
    value: number;
    unit: string;
}

export interface CalculationNutrientRow {
    nutrient: string;
    unit: string;
    targetMin?: number;
    targetMax?: number;
    actual: number;
    deltaToMin?: number;
    deltaToMax?: number;
    status: 'below' | 'within' | 'above' | 'no_target';
    factIds: {
        actual: string;
        targetMin?: string;
        targetMax?: string;
    };
}

export interface CalculationLedger {
    formulationId: string;
    batchName: string;
    feedType: FeedType;
    stageCode?: string;
    stageLabel?: string;
    strategy?: string;
    targetWeightKg: number;
    qualityMatchPercentage: number;
    complianceColor: string;
    equationRows: CalculationEquationRow[];
    nutrientRows: CalculationNutrientRow[];
    totals: {
        totalIngredientCost: number;
        overheadCost: number;
        totalCost: number;
        costPerKg: number;
    };
}

export interface FactPack {
    facts: Record<string, { label: string; value: number | string; unit?: string }>;
    context: string;
}

export const getAnalyticsOverview = async (query: AnalyticsQuery): Promise<AnalyticsOverview> => {
    const rows = await Formulation.find(getFormulationFilters(query))
        .select(
            'isUnlocked complianceColor qualityMatchPercentage costPerKg totalCost ingredientsUsed actualNutrients standardUsed createdAt'
        )
        .populate('standardUsed', 'feedCategory stage stageCode targetNutrients')
        .lean();

    const filteredRows = applyStandardFilters(rows, query.feedType, query.stageCode);
    const totalMixes = filteredRows.length;
    if (totalMixes === 0) {
        return {
            summary: {
                totalMixes: 0,
                unlockedMixes: 0,
                unlockConversionPct: 0,
                compliantMixes: 0,
                complianceRatePct: 0,
                avgQualityMatch: 0,
                minCostPerKg: 0,
                avgCostPerKg: 0,
                maxCostPerKg: 0,
                totalCost: 0
            },
            feedTypeBreakdown: { fish: 0, poultry: 0 },
            stagePerformance: [],
            topCostDrivers: [],
            nutrientMissFrequency: []
        };
    }

    let unlockedMixes = 0;
    let compliantMixes = 0;
    let qualityTotal = 0;
    let totalCost = 0;
    let costPerKgTotal = 0;
    let minCostPerKg = Number.POSITIVE_INFINITY;
    let maxCostPerKg = 0;

    const feedTypeBreakdown = { fish: 0, poultry: 0 };
    const stagePerformanceMap = new Map<string, StageAggregate>();
    const costDriversMap = new Map<string, CostDriverAggregate>();
    const nutrientMissMap = new Map<string, NutrientMissAggregate>();

    filteredRows.forEach((row: any) => {
        const isUnlocked = row.isUnlocked === true;
        const isCompliant = String(row.complianceColor || '').toLowerCase() === 'green';
        const quality = toNumber(row.qualityMatchPercentage);
        const costPerKg = toNumber(row.costPerKg);
        const rowTotalCost = toNumber(row.totalCost);
        const standard = row.standardUsed || {};
        const feedType = normalizeFeedType(standard.feedCategory);
        const stageCode = String(standard.stageCode || '').trim().toUpperCase() || 'UNSPECIFIED';
        const stageLabel = String(standard.stage || standard.stageCode || 'Unspecified');
        const stageKey = `${stageCode}::${stageLabel}`;

        if (isUnlocked) unlockedMixes += 1;
        if (isCompliant) compliantMixes += 1;
        qualityTotal += quality;
        totalCost += rowTotalCost;
        costPerKgTotal += costPerKg;
        minCostPerKg = Math.min(minCostPerKg, costPerKg);
        maxCostPerKg = Math.max(maxCostPerKg, costPerKg);
        feedTypeBreakdown[feedType] += 1;

        const stageAgg = stagePerformanceMap.get(stageKey) || {
            count: 0,
            qualityTotal: 0,
            costTotal: 0,
            compliantCount: 0
        };
        stageAgg.count += 1;
        stageAgg.qualityTotal += quality;
        stageAgg.costTotal += costPerKg;
        if (isCompliant) stageAgg.compliantCount += 1;
        stagePerformanceMap.set(stageKey, stageAgg);

        const ingredients = Array.isArray(row.ingredientsUsed) ? row.ingredientsUsed : [];
        ingredients.forEach((ingredient: any) => {
            const name = String(ingredient.name || 'Unknown Ingredient').trim() || 'Unknown Ingredient';
            const qtyKg = toNumber(ingredient.qtyKg);
            const price = toNumber(ingredient.priceAtMoment);
            const lineCost = qtyKg * price;
            const agg = costDriversMap.get(name) || {
                usageCount: 0,
                qtyKgTotal: 0,
                lineCostTotal: 0,
                avgPriceAccumulator: 0
            };
            agg.usageCount += 1;
            agg.qtyKgTotal += qtyKg;
            agg.lineCostTotal += lineCost;
            agg.avgPriceAccumulator += price;
            costDriversMap.set(name, agg);
        });

        const targetNutrients = standard?.targetNutrients || {};
        const actualNutrients = row.actualNutrients || {};
        const nutrientKeys = new Set<string>([
            ...Object.keys(targetNutrients),
            ...Object.keys(actualNutrients)
        ]);
        nutrientKeys.forEach((nutrient) => {
            const range = toNutrientRange((targetNutrients as any)[nutrient]);
            const hasTarget = range.min !== undefined || range.max !== undefined;
            if (!hasTarget) return;
            const actual = toNumber((actualNutrients as any)[nutrient], NaN);
            if (!Number.isFinite(actual)) return;

            const agg = nutrientMissMap.get(nutrient) || {
                evaluatedCount: 0,
                belowCount: 0,
                aboveCount: 0
            };
            agg.evaluatedCount += 1;
            if (range.min !== undefined && actual < range.min) agg.belowCount += 1;
            if (range.max !== undefined && actual > range.max) agg.aboveCount += 1;
            nutrientMissMap.set(nutrient, agg);
        });
    });

    const stagePerformance = Array.from(stagePerformanceMap.entries())
        .map(([key, agg]) => {
            const [stageCode, stageLabel] = key.split('::');
            const count = Math.max(1, agg.count);
            return {
                stageCode,
                stageLabel,
                count: agg.count,
                avgQualityMatch: agg.qualityTotal / count,
                avgCostPerKg: agg.costTotal / count,
                complianceRatePct: (agg.compliantCount / count) * 100
            };
        })
        .sort((a, b) => b.count - a.count);

    const totalIngredientLineCost = Array.from(costDriversMap.values()).reduce((sum, item) => (
        sum + item.lineCostTotal
    ), 0);

    const topCostDrivers = Array.from(costDriversMap.entries())
        .map(([ingredientName, agg]) => ({
            ingredientName,
            usageCount: agg.usageCount,
            qtyKgTotal: agg.qtyKgTotal,
            lineCostTotal: agg.lineCostTotal,
            avgPriceAtMoment: agg.avgPriceAccumulator / Math.max(1, agg.usageCount),
            costSharePct: totalIngredientLineCost > 0
                ? ((agg.lineCostTotal / totalIngredientLineCost) * 100)
                : 0
        }))
        .sort((a, b) => b.lineCostTotal - a.lineCostTotal)
        .slice(0, 10);

    const nutrientMissFrequency = Array.from(nutrientMissMap.entries())
        .map(([nutrient, agg]) => ({
            nutrient,
            evaluatedCount: agg.evaluatedCount,
            belowCount: agg.belowCount,
            aboveCount: agg.aboveCount,
            missRatePct: agg.evaluatedCount > 0
                ? (((agg.belowCount + agg.aboveCount) / agg.evaluatedCount) * 100)
                : 0
        }))
        .sort((a, b) => b.missRatePct - a.missRatePct);

    return {
        summary: {
            totalMixes,
            unlockedMixes,
            unlockConversionPct: (unlockedMixes / totalMixes) * 100,
            compliantMixes,
            complianceRatePct: (compliantMixes / totalMixes) * 100,
            avgQualityMatch: qualityTotal / totalMixes,
            minCostPerKg: minCostPerKg === Number.POSITIVE_INFINITY ? 0 : minCostPerKg,
            avgCostPerKg: costPerKgTotal / totalMixes,
            maxCostPerKg,
            totalCost
        },
        feedTypeBreakdown,
        stagePerformance,
        topCostDrivers,
        nutrientMissFrequency
    };
};

export const getAnalyticsTrends = async (
    query: AnalyticsQuery & {
        metric: TrendMetric;
        interval: TrendInterval;
    }
): Promise<TrendPoint[]> => {
    const rows = await Formulation.find(getFormulationFilters(query))
        .select('createdAt complianceColor qualityMatchPercentage costPerKg standardUsed')
        .populate('standardUsed', 'feedCategory stageCode')
        .lean();

    const filteredRows = applyStandardFilters(rows, query.feedType, query.stageCode);
    const buckets = new Map<string, TrendAggregate>();

    filteredRows.forEach((row: any) => {
        const createdAt = row.createdAt ? new Date(row.createdAt) : null;
        if (!createdAt || Number.isNaN(createdAt.getTime())) return;
        const bucket = getDateBucket(createdAt, query.interval);
        const agg = buckets.get(bucket) || {
            count: 0,
            compliantCount: 0,
            costTotal: 0,
            qualityTotal: 0
        };
        agg.count += 1;
        if (String(row.complianceColor || '').toLowerCase() === 'green') agg.compliantCount += 1;
        agg.costTotal += toNumber(row.costPerKg);
        agg.qualityTotal += toNumber(row.qualityMatchPercentage);
        buckets.set(bucket, agg);
    });

    return Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, agg]) => {
            const divisor = Math.max(1, agg.count);
            const value = query.metric === 'complianceRate'
                ? (agg.compliantCount / divisor) * 100
                : query.metric === 'qualityMatch'
                    ? (agg.qualityTotal / divisor)
                    : (agg.costTotal / divisor);
            return {
                bucket,
                value,
                sampleCount: agg.count
            };
        });
};

export const getFormulationWithStandardForUser = async (
    formulationId: string,
    userId: string
) => {
    if (!Types.ObjectId.isValid(formulationId) || !Types.ObjectId.isValid(userId)) {
        return null;
    }

    return Formulation.findOne({ _id: formulationId, userId: toObjectId(userId) })
        .populate('standardUsed', 'feedCategory stage stageCode targetNutrients tolerance')
        .lean();
};

export const getFormulationWithStandard = async (formulationId: string) => {
    if (!Types.ObjectId.isValid(formulationId)) {
        return null;
    }
    return Formulation.findById(formulationId)
        .populate('standardUsed', 'feedCategory stage stageCode targetNutrients tolerance')
        .lean();
};

export const buildCalculationLedger = (formulation: any): CalculationLedger => {
    const standard = formulation?.standardUsed || {};
    const feedType = normalizeFeedType(standard.feedCategory);
    const strategy = formulation.selectedStrategy || formulation.strategyOptions?.[0]?.strategy;
    const targetWeightKg = toNumber(formulation.targetWeightKg);
    const ingredients = Array.isArray(formulation.ingredientsUsed) ? formulation.ingredientsUsed : [];

    const equationRows: CalculationEquationRow[] = ingredients.map((ingredient: any, index: number) => {
        const name = String(ingredient.name || `Ingredient ${index + 1}`);
        const qtyKg = toNumber(ingredient.qtyKg);
        const priceAtMoment = toNumber(ingredient.priceAtMoment);
        const lineCost = qtyKg * priceAtMoment;
        return {
            factId: `eq.ingredient.${index + 1}.line_cost`,
            label: `${name} line cost`,
            equation: `${qtyKg} * ${priceAtMoment}`,
            value: lineCost,
            unit: 'NGN'
        };
    });

    const totalIngredientCost = equationRows.reduce((sum, row) => sum + row.value, 0);
    const inferredOverhead = Math.max(0, toNumber(formulation.totalCost) - totalIngredientCost);
    const overheadCost = toNumber(formulation.overheadCost, inferredOverhead);
    const totalCost = toNumber(formulation.totalCost, totalIngredientCost + overheadCost);
    const computedCostPerKg = targetWeightKg > 0 ? totalCost / targetWeightKg : 0;
    const costPerKg = toNumber(formulation.costPerKg, computedCostPerKg);

    equationRows.push(
        {
            factId: 'eq.total_ingredient_cost',
            label: 'Total ingredient cost',
            equation: 'Σ ingredient line costs',
            value: totalIngredientCost,
            unit: 'NGN'
        },
        {
            factId: 'eq.overhead_cost',
            label: 'Overhead cost',
            equation: 'Provided overhead',
            value: overheadCost,
            unit: 'NGN'
        },
        {
            factId: 'eq.total_cost',
            label: 'Total cost',
            equation: 'total ingredient cost + overhead',
            value: totalCost,
            unit: 'NGN'
        },
        {
            factId: 'eq.cost_per_kg',
            label: 'Cost per kg',
            equation: targetWeightKg > 0
                ? `${totalCost} / ${targetWeightKg}`
                : 'total cost / target weight',
            value: costPerKg,
            unit: 'NGN/kg'
        }
    );

    const targetNutrients = standard?.targetNutrients || {};
    const actualNutrients = formulation?.actualNutrients || {};
    const nutrientKeys = Array.from(new Set<string>([
        ...Object.keys(targetNutrients),
        ...Object.keys(actualNutrients)
    ])).sort();

    const nutrientRows: CalculationNutrientRow[] = nutrientKeys.map((nutrient) => {
        const range = toNutrientRange((targetNutrients as any)[nutrient]);
        const actual = toNumber((actualNutrients as any)[nutrient], 0);
        const targetMin = range.min;
        const targetMax = range.max;

        let status: CalculationNutrientRow['status'] = 'no_target';
        if (targetMin !== undefined || targetMax !== undefined) {
            if (targetMin !== undefined && actual < targetMin) status = 'below';
            else if (targetMax !== undefined && actual > targetMax) status = 'above';
            else status = 'within';
        }

        return {
            nutrient,
            unit: NUTRIENT_UNITS[nutrient] || '%',
            ...(targetMin !== undefined ? { targetMin } : {}),
            ...(targetMax !== undefined ? { targetMax } : {}),
            actual,
            ...(targetMin !== undefined ? { deltaToMin: actual - targetMin } : {}),
            ...(targetMax !== undefined ? { deltaToMax: actual - targetMax } : {}),
            status,
            factIds: {
                actual: `nutrient.${nutrient}.actual`,
                ...(targetMin !== undefined ? { targetMin: `nutrient.${nutrient}.target_min` } : {}),
                ...(targetMax !== undefined ? { targetMax: `nutrient.${nutrient}.target_max` } : {})
            }
        };
    });

    return {
        formulationId: String(formulation._id),
        batchName: String(formulation.batchName || 'Feed Mix'),
        feedType,
        stageCode: standard.stageCode ? String(standard.stageCode) : undefined,
        stageLabel: standard.stage ? String(standard.stage) : undefined,
        strategy: strategy ? String(strategy) : undefined,
        targetWeightKg,
        qualityMatchPercentage: toNumber(formulation.qualityMatchPercentage),
        complianceColor: String(formulation.complianceColor || ''),
        equationRows,
        nutrientRows,
        totals: {
            totalIngredientCost,
            overheadCost,
            totalCost,
            costPerKg
        }
    };
};

export const buildFactPack = (ledger: CalculationLedger): FactPack => {
    const facts: FactPack['facts'] = {
        'meta.formulation_id': {
            label: 'Formulation ID',
            value: ledger.formulationId
        },
        'meta.batch_name': {
            label: 'Batch name',
            value: ledger.batchName
        },
        'meta.feed_type': {
            label: 'Feed type',
            value: ledger.feedType
        },
        'meta.quality_match': {
            label: 'Quality match percentage',
            value: ledger.qualityMatchPercentage,
            unit: '%'
        },
        'meta.target_weight_kg': {
            label: 'Target weight',
            value: ledger.targetWeightKg,
            unit: 'kg'
        },
        'meta.compliance_color': {
            label: 'Compliance color',
            value: ledger.complianceColor
        }
    };

    ledger.equationRows.forEach((row) => {
        facts[row.factId] = {
            label: row.label,
            value: row.value,
            unit: row.unit
        };
    });

    ledger.nutrientRows.forEach((row) => {
        facts[row.factIds.actual] = {
            label: `${row.nutrient} actual`,
            value: row.actual,
            unit: row.unit
        };
        if (row.factIds.targetMin && row.targetMin !== undefined) {
            facts[row.factIds.targetMin] = {
                label: `${row.nutrient} target min`,
                value: row.targetMin,
                unit: row.unit
            };
        }
        if (row.factIds.targetMax && row.targetMax !== undefined) {
            facts[row.factIds.targetMax] = {
                label: `${row.nutrient} target max`,
                value: row.targetMax,
                unit: row.unit
            };
        }
    });

    const contextLines = [
        `Formulation: ${ledger.batchName} (${ledger.formulationId})`,
        `Feed type: ${ledger.feedType}`,
        `Target weight: ${ledger.targetWeightKg} kg`,
        `Total cost: NGN ${ledger.totals.totalCost}`,
        `Cost per kg: NGN ${ledger.totals.costPerKg}/kg`,
        `Quality match: ${ledger.qualityMatchPercentage}%`,
        `Compliance color: ${ledger.complianceColor}`
    ];

    return {
        facts,
        context: contextLines.join('\n')
    };
};

const escapeCsv = (value: unknown): string => {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

const buildCsv = (ledger: CalculationLedger): string => {
    const lines: string[] = [];
    lines.push('section,key,value,unit,equation,status');
    lines.push(`meta,formulationId,${escapeCsv(ledger.formulationId)},,,`);
    lines.push(`meta,batchName,${escapeCsv(ledger.batchName)},,,`);
    lines.push(`meta,feedType,${escapeCsv(ledger.feedType)},,,`);
    lines.push(`meta,targetWeightKg,${ledger.targetWeightKg},kg,,`);
    lines.push(`meta,qualityMatchPercentage,${ledger.qualityMatchPercentage},%,,`);
    lines.push(`meta,complianceColor,${escapeCsv(ledger.complianceColor)},,,`);

    ledger.equationRows.forEach((row) => {
        lines.push(`equation,${escapeCsv(row.label)},${row.value},${escapeCsv(row.unit)},${escapeCsv(row.equation)},`);
    });

    ledger.nutrientRows.forEach((row) => {
        lines.push(
            [
                'nutrient',
                escapeCsv(row.nutrient),
                row.actual,
                escapeCsv(row.unit),
                escapeCsv(
                    `${row.targetMin ?? ''} <= actual <= ${row.targetMax ?? ''}`
                ),
                row.status
            ].join(',')
        );
    });

    return lines.join('\n');
};

const escapePdfText = (text: string) => (
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
);

const buildMinimalPdf = (lines: string[]): Buffer => {
    const yStart = 770;
    const lineHeight = 14;
    const streamLines = ['BT', '/F1 10 Tf', `50 ${yStart} Td`];
    lines.forEach((line, index) => {
        if (index === 0) {
            streamLines.push(`(${escapePdfText(line)}) Tj`);
        } else {
            streamLines.push(`0 -${lineHeight} Td (${escapePdfText(line)}) Tj`);
        }
    });
    streamLines.push('ET');
    const stream = `${streamLines.join('\n')}\n`;

    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
        `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((obj) => {
        offsets.push(Buffer.byteLength(pdf, 'utf8'));
        pdf += obj;
    });

    const xrefStart = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i += 1) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
};

const buildPdf = (ledger: CalculationLedger): Buffer => {
    const lines: string[] = [
        'AquaFeed Formulation Report',
        `Batch: ${ledger.batchName}`,
        `Formulation ID: ${ledger.formulationId}`,
        `Feed Type: ${ledger.feedType} | Stage: ${ledger.stageCode || ledger.stageLabel || 'N/A'}`,
        `Target Weight: ${ledger.targetWeightKg} kg`,
        `Quality Match: ${ledger.qualityMatchPercentage}%`,
        `Compliance: ${ledger.complianceColor}`,
        `Total Cost: NGN ${ledger.totals.totalCost}`,
        `Cost per kg: NGN ${ledger.totals.costPerKg}`,
        '',
        'Calculation Ledger'
    ];

    ledger.equationRows.forEach((row) => {
        lines.push(`- ${row.label}: ${row.equation} = ${row.value} ${row.unit}`);
    });

    lines.push('');
    lines.push('Nutrient Checks');
    ledger.nutrientRows.forEach((row) => {
        lines.push(
            `- ${row.nutrient}: actual ${row.actual}${row.unit}, target ${row.targetMin ?? '-'} to ${row.targetMax ?? '-'} (${row.status})`
        );
    });

    return buildMinimalPdf(lines.slice(0, 45));
};

export const buildFormulationExport = (
    ledger: CalculationLedger,
    format: 'csv' | 'pdf'
): {
    filename: string;
    mimeType: string;
    data: string | Buffer;
} => {
    const safeBatchName = ledger.batchName.replace(/[^a-zA-Z0-9-_]/g, '_');
    if (format === 'pdf') {
        return {
            filename: `${safeBatchName || 'formulation'}-report.pdf`,
            mimeType: 'application/pdf',
            data: buildPdf(ledger)
        };
    }

    return {
        filename: `${safeBatchName || 'formulation'}-report.csv`,
        mimeType: 'text/csv; charset=utf-8',
        data: buildCsv(ledger)
    };
};

export const getStandardById = async (id: string) => {
    if (!Types.ObjectId.isValid(id)) return null;
    return FeedStandard.findById(id).lean();
};

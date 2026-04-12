import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Ingredient from '../../models/Ingredient';
import FeedStandard, { IFeedStandard } from '../../models/FeedStandard';
import Formulation from '../../models/Formulation';
import Transaction from '../../models/Transaction';
import User from '../../models/User';
import AlternativeRule from '../../models/AlternativeRule';
import Configuration from '../../models/Configuration';
import solverService, {
    ConstraintViolation,
    FormulationStrategy,
    InfeasibilityAnalysis,
    RecommendedAction
} from '../../services/solver.service';
import complianceService from '../../services/compliance.service';
import { configService } from '../../services/config.service';
import { alternativeCacheService } from '../../services/alternative-cache.service';
import {
    buildCalculationLedger,
    buildFormulationExport,
    getAnalyticsOverview,
    getAnalyticsTrends,
    getFormulationWithStandardForUser
} from '../../services/formulation-intelligence.service';
import { resolveCanonicalStageCode } from '../../utils/stage-code.util';

interface SelectedIngredientInput {
    ingredientId: string;
    customPrice?: number;
    volumeLiters?: number;
    minInclusionPct?: number;
    maxInclusionPct?: number;
    alternativeIngredientId?: string;
    exactQtyKg?: number;
}

interface FormulationRequestBody {
    targetWeightKg: number;
    standardId?: string;
    stageCode?: string;
    feedType?: 'fish' | 'poultry';
    selectedIngredients: SelectedIngredientInput[];
    batchName?: string;
    overheadCost?: number;
    targetOverrides?: Record<string, { min?: number; max?: number }>;
    globalTargetRelaxationPct?: number;
}

interface StructuredInfeasibleResponse {
    status: 'infeasible';
    error: string;
    message: string;
    suggestion: string;
    violations: ConstraintViolation[];
    recommendedActions: RecommendedAction[];
    feedType: 'fish' | 'poultry';
    fishSubtype?: string;
    poultryType?: string;
}

interface StructuredNonCompliantResponse {
    status: 'non_compliant';
    error: string;
    message: string;
    suggestion: string;
    bestQualityMatch: number;
    feedType: 'fish' | 'poultry';
    fishSubtype?: string;
    poultryType?: string;
}

interface FormulationOption {
    strategy: FormulationStrategy | 'EXACT_MIX';
    feasible: true;
    complianceColor: 'Red' | 'Blue' | 'Green';
    qualityMatch: number;
    nutrientStatuses: unknown[];
    totalCost: number;
    costPerKg: number;
    actualNutrients: Record<string, number>;
    requestedTargetWeightKg: number;
    actualOutputWeightKg: number;
    evaluationMode: 'optimized' | 'exact';
    recipe: Array<{
        name: string;
        qtyKg: number;
        bags: number;
        priceAtMoment: number;
        isAutoCalculated?: boolean;
    }>;
    appliedAlternatives: AppliedAlternativeSelection[];
    overheadCost: number;
}

interface InfeasibleStrategyOption {
    strategy: FormulationStrategy;
    feasible: false;
    message?: string;
    infeasibility?: InfeasibilityAnalysis;
}

interface BuildComputationResult {
    feasibleOptions: FormulationOption[];
    infeasibility?: InfeasibilityAnalysis;
    standard: IFeedStandard;
    effectiveWeightKg: number;
}

interface ResolvedSelectedIngredient extends SelectedIngredientInput {
    originalIngredientId: string;
    originalIngredientName?: string;
    selectionMode: 'original' | 'explicit' | 'auto';
    alternativeRuleMaxBlendPercent?: number;
    alternativeRuleNotes?: string;
    alternativeEstimatedCostDeltaPerKg?: number;
}

interface AppliedAlternativeSelection {
    originalIngredientId: string;
    originalIngredientName: string;
    alternativeIngredientId: string;
    alternativeIngredientName: string;
    selectionMode: 'explicit' | 'auto';
    maxBlendPercent: number;
    notes?: string;
    estimatedCostDeltaPerKg?: number;
}

type CatfishStageGuidance = {
    stageLabel: string;
    estimatedMaizePct?: number;
    fishmeal72EquivalentPct?: { min: number; max: number };
};

type AlternativeSuggestionGroup = {
    originalIngredient: {
        id?: string;
        name: string;
        price: number;
        category?: string;
    };
    alternatives: Array<{
        ruleId: string;
        id?: string;
        name: string;
        price: number;
        category?: string;
        estimatedCostDeltaPerKg: number;
        maxBlendPercent: number;
        notes?: string;
    }>;
};

class FormulationRequestError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = 'FormulationRequestError';
        this.statusCode = statusCode;
    }
}

const getFeedType = (feedCategory: string): 'fish' | 'poultry' => (
    feedCategory.toLowerCase() === 'poultry' ? 'poultry' : 'fish'
);

const getAuthenticatedUserId = (req: Request): string | null => (
    req.userId || req.session?.userId || null
);

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

const FORMULATION_FEE_KEYS = ['formulation_fee', 'formulation_unlock_fee'];

const getConfiguredFormulationFee = async (): Promise<number> => {
    const configs = await Configuration.find({
        key: { $in: FORMULATION_FEE_KEYS }
    })
        .sort({ updatedAt: -1 })
        .lean();

    for (const config of configs) {
        const numericValue = Number(config.value);
        if (Number.isFinite(numericValue) && numericValue > 0) {
            return numericValue;
        }
    }

    return 10000;
};

const getFishSubtype = (standard: IFeedStandard): string | undefined => {
    if (getFeedType(standard.feedCategory) !== 'fish') return undefined;
    return standard.fishType ? standard.fishType.toLowerCase() : 'catfish';
};

const getCatfishStageGuidance = (standard: IFeedStandard): CatfishStageGuidance | undefined => {
    if (getFeedType(standard.feedCategory) !== 'fish') return undefined;

    const normalizedStageCode = resolveCanonicalStageCode(String(standard.stageCode || ''), {
        feedType: 'fish',
        stageLabel: String(standard.stage || ''),
        standardName: String(standard.name || '')
    });
    const stageLabel = String(standard.stage || standard.name || 'Catfish').trim();

    if (normalizedStageCode.includes('FINGERLING')) {
        return {
            stageLabel,
            estimatedMaizePct: 9,
            fishmeal72EquivalentPct: { min: 40, max: 50 }
        };
    }

    if (normalizedStageCode.includes('JUVENILE')) {
        return {
            stageLabel,
            estimatedMaizePct: 12,
            fishmeal72EquivalentPct: { min: 25, max: 35 }
        };
    }

    if (normalizedStageCode.includes('GROW_OUT') || normalizedStageCode.includes('GROW-OUT')) {
        return {
            stageLabel,
            estimatedMaizePct: 15,
            fishmeal72EquivalentPct: { min: 10, max: 20 }
        };
    }

    return undefined;
};

const objectIdToString = (value: unknown): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'toString' in value) {
        return value.toString();
    }
    return String(value);
};

const clampNonNegative = (value: number | undefined): number | undefined => {
    if (value === undefined || Number.isNaN(value)) return undefined;
    return Math.max(0, value);
};

const mergeTargets = (
    target: Record<string, unknown>,
    overrides?: Record<string, { min?: number; max?: number }>
): Record<string, unknown> => {
    if (!overrides) return target;

    const merged: Record<string, unknown> = JSON.parse(JSON.stringify(target));

    Object.entries(overrides).forEach(([nutrient, range]) => {
        const existing = (merged[nutrient] as { min?: number; max?: number } | undefined) || {};
        merged[nutrient] = {
            ...existing,
            ...(range.min !== undefined ? { min: clampNonNegative(range.min) } : {}),
            ...(range.max !== undefined ? { max: clampNonNegative(range.max) } : {})
        };
    });

    return merged;
};

const applyGlobalTargetRelaxation = (
    target: Record<string, unknown>,
    relaxationPct?: number
): Record<string, unknown> => {
    if (!relaxationPct || relaxationPct <= 0) return target;

    const relaxed: Record<string, unknown> = JSON.parse(JSON.stringify(target));
    Object.entries(relaxed).forEach(([nutrient, range]) => {
        if (!range || typeof range !== 'object') return;
        const typedRange = range as { min?: number; max?: number };
        relaxed[nutrient] = {
            ...(typedRange.min !== undefined ? { min: Math.max(0, typedRange.min - relaxationPct) } : {}),
            ...(typedRange.max !== undefined ? { max: typedRange.max + relaxationPct } : {})
        };
    });

    return relaxed;
};

const coerceFormulationRequest = (body: unknown): FormulationRequestBody => {
    const raw = body as Partial<FormulationRequestBody>;
    return {
        targetWeightKg: Number(raw.targetWeightKg),
        standardId: raw.standardId ? String(raw.standardId) : undefined,
        stageCode: raw.stageCode ? String(raw.stageCode) : undefined,
        feedType: raw.feedType === 'poultry' ? 'poultry' : raw.feedType === 'fish' ? 'fish' : undefined,
        selectedIngredients: Array.isArray(raw.selectedIngredients)
            ? raw.selectedIngredients.map((i) => ({
                ingredientId: String(i.ingredientId),
                customPrice: i.customPrice !== undefined ? Number(i.customPrice) : undefined,
                volumeLiters: i.volumeLiters !== undefined ? Number(i.volumeLiters) : undefined,
                minInclusionPct: i.minInclusionPct !== undefined ? Number(i.minInclusionPct) : undefined,
                maxInclusionPct: i.maxInclusionPct !== undefined ? Number(i.maxInclusionPct) : undefined,
                alternativeIngredientId: i.alternativeIngredientId,
                exactQtyKg: i.exactQtyKg !== undefined ? Number(i.exactQtyKg) : undefined
            }))
            : [],
        batchName: raw.batchName,
        overheadCost: raw.overheadCost !== undefined ? Number(raw.overheadCost) : 0,
        targetOverrides: raw.targetOverrides,
        globalTargetRelaxationPct: raw.globalTargetRelaxationPct !== undefined
            ? Number(raw.globalTargetRelaxationPct)
            : undefined
    };
};

const chooseAutoAlternativeRule = (
    sourceIngredient: { alternatives?: Array<unknown> },
    candidateRules: Array<{
        originalIngredientId: unknown;
        alternativeIngredientId: unknown;
        maxBlendPercent?: number;
        notes?: string;
    }>
) => {
    const preferredOrder = Array.isArray(sourceIngredient.alternatives)
        ? sourceIngredient.alternatives.map((item) => objectIdToString(item))
        : [];

    for (const alternativeId of preferredOrder) {
        const matchedRule = candidateRules.find(
            (rule) =>
                objectIdToString(rule.alternativeIngredientId) === alternativeId,
        );
        if (matchedRule) return matchedRule;
    }

    return candidateRules[0];
};

const buildAlternativeSuggestionGroups = (
    ingredientIds: string[],
    rules: Array<{
        _id: unknown;
        originalIngredientId: {
            _id?: unknown;
            name: string;
            defaultPrice?: number;
            category?: string;
        };
        alternativeIngredientId: {
            _id?: unknown;
            name: string;
            defaultPrice?: number;
            category?: string;
        };
        maxBlendPercent?: number;
        notes?: string;
    }>
): AlternativeSuggestionGroup[] => {
    const grouped = new Map<string, AlternativeSuggestionGroup>();

    rules.forEach((rule) => {
        const originalId = objectIdToString(rule.originalIngredientId?._id);
        if (!originalId) return;

        const current =
            grouped.get(originalId) ||
            {
                originalIngredient: {
                    id: originalId,
                    name: rule.originalIngredientId?.name || 'Unknown ingredient',
                    price: Number(rule.originalIngredientId?.defaultPrice || 0),
                    category: rule.originalIngredientId?.category,
                },
                alternatives: [],
            };

        current.alternatives.push({
            ruleId: objectIdToString(rule._id),
            id: objectIdToString(rule.alternativeIngredientId?._id),
            name: rule.alternativeIngredientId?.name || 'Unknown ingredient',
            price: Number(rule.alternativeIngredientId?.defaultPrice || 0),
            category: rule.alternativeIngredientId?.category,
            estimatedCostDeltaPerKg:
                Number(rule.alternativeIngredientId?.defaultPrice || 0) -
                Number(rule.originalIngredientId?.defaultPrice || 0),
            maxBlendPercent: Number(rule.maxBlendPercent || 100),
            notes: rule.notes,
        });

        grouped.set(originalId, current);
    });

    return ingredientIds
        .map((ingredientId) => grouped.get(ingredientId))
        .filter((group): group is AlternativeSuggestionGroup => {
            if (!group) return false;
            return group.alternatives.length > 0;
        })
        .map((group) => ({
            ...group,
            alternatives: group.alternatives
                .slice()
                .sort((a, b) => {
                    if (a.estimatedCostDeltaPerKg !== b.estimatedCostDeltaPerKg) {
                        return a.estimatedCostDeltaPerKg - b.estimatedCostDeltaPerKg;
                    }
                    return a.name.localeCompare(b.name, undefined, {
                        sensitivity: 'base',
                        numeric: true,
                    });
                }),
        }));
};

const applyActionPatchToRequest = (
    request: FormulationRequestBody,
    action: { actionType?: string; patch?: Record<string, unknown> }
): FormulationRequestBody => {
    if (!action.patch) return request;

    const nextRequest: FormulationRequestBody = {
        ...request,
        selectedIngredients: request.selectedIngredients.map((ing) => ({ ...ing }))
    };
    const patch = action.patch;
    const operation = typeof patch.operation === 'string' ? patch.operation : undefined;

    if (operation === 'relax_min') {
        const nutrient = typeof patch.nutrient === 'string' ? patch.nutrient : undefined;
        const delta = typeof patch.delta === 'number' ? patch.delta : 0;
        if (nutrient) {
            const existing = nextRequest.targetOverrides?.[nutrient] || {};
            const currentMin = existing.min;
            nextRequest.targetOverrides = {
                ...(nextRequest.targetOverrides || {}),
                [nutrient]: {
                    ...existing,
                    min: currentMin !== undefined ? Math.max(0, currentMin - delta) : undefined
                }
            };
        }
    }

    if (operation === 'try_alternatives') {
        const ingredientIds = Array.isArray(patch.ingredientIds)
            ? patch.ingredientIds.filter((id): id is string => typeof id === 'string')
            : [];
        nextRequest.selectedIngredients = nextRequest.selectedIngredients.map((selected) => (
            ingredientIds.includes(selected.ingredientId)
                ? { ...selected, alternativeIngredientId: selected.alternativeIngredientId || 'AUTO' }
                : selected
        ));
    }

    if (operation === 'relax_ingredient_max') {
        const ingredientIds = Array.isArray(patch.ingredientIds)
            ? patch.ingredientIds.filter((id): id is string => typeof id === 'string')
            : [];
        const deltaPercent = typeof patch.deltaPercent === 'number' ? patch.deltaPercent : 0;
        nextRequest.selectedIngredients = nextRequest.selectedIngredients.map((selected) => {
            if (!ingredientIds.includes(selected.ingredientId)) return selected;
            const existingMax = selected.maxInclusionPct ?? 0;
            return { ...selected, maxInclusionPct: existingMax + deltaPercent };
        });
    }

    if (operation === 'adjust_target') {
        if (typeof patch.targetWeightKg === 'number') {
            nextRequest.targetWeightKg = patch.targetWeightKg;
        }
        if (typeof patch.nutrientDeltaPct === 'number') {
            const delta = patch.nutrientDeltaPct;
            nextRequest.globalTargetRelaxationPct = Math.max(
                0,
                (nextRequest.globalTargetRelaxationPct || 0) + delta
            );
            const nutrientOverrides: Record<string, { min?: number; max?: number }> = {};
            Object.entries(nextRequest.targetOverrides || {}).forEach(([nutrient, range]) => {
                nutrientOverrides[nutrient] = {
                    ...(range.min !== undefined ? { min: Math.max(0, range.min - delta) } : {}),
                    ...(range.max !== undefined ? { max: range.max + delta } : {})
                };
            });
            nextRequest.targetOverrides = nutrientOverrides;
        }
    }

    return nextRequest;
};

const hasStandardSelector = (request: FormulationRequestBody) => (
    Boolean(request.standardId && request.standardId.trim())
    || Boolean(request.stageCode && request.stageCode.trim())
);

const resolveStandardForRequest = async (payload: FormulationRequestBody) => {
    if (payload.standardId && payload.standardId.trim()) {
        const byId = await FeedStandard.findById(payload.standardId.trim());
        if (byId) return byId;
    }

    if (!payload.stageCode || !payload.stageCode.trim()) {
        return null;
    }

    const feedType = payload.feedType;
    const canonicalStageCode = resolveCanonicalStageCode(payload.stageCode, {
        feedType: feedType || 'fish'
    });
    const query: Record<string, unknown> = {
        stageCode: canonicalStageCode,
        isActive: true
    };
    if (feedType === 'fish') query.feedCategory = 'Catfish';
    if (feedType === 'poultry') query.feedCategory = 'Poultry';

    const byStageCode = await FeedStandard.findOne(query).sort({ updatedAt: -1 });
    if (byStageCode) return byStageCode;

    const rawStageCode = String(payload.stageCode || '').trim();
    const stageFallbackQuery: Record<string, unknown> = {
        isActive: true,
        $or: [
            { stageCode: rawStageCode.toUpperCase() },
            { stage: { $regex: `^${rawStageCode}$`, $options: 'i' } }
        ]
    };
    if (feedType === 'fish') stageFallbackQuery.feedCategory = 'Catfish';
    if (feedType === 'poultry') stageFallbackQuery.feedCategory = 'Poultry';
    return FeedStandard.findOne(stageFallbackQuery).sort({ updatedAt: -1 });
};

/**
 * Calculate Feed Formulation (The "Joggler")
 * POST /api/v1/formulations/calculate
 * 
 * Access Control:
 * - Users get 1 FREE trial formula
 * - After that, must pay ₦10,000 for full access
 * - Admins have unlimited access
 */
const toStructuredInfeasibleResponse = (
    standard: IFeedStandard,
    infeasibility?: InfeasibilityAnalysis
): StructuredInfeasibleResponse => {
    const fallbackSummary = 'Try selecting more ingredients with stronger protein and energy values, or relax one constraint slightly.';
    return {
        status: 'infeasible',
        error: 'Cannot create a balanced formulation',
        message: 'The selected ingredients cannot meet the nutritional targets.',
        suggestion: infeasibility?.summary || fallbackSummary,
        violations: infeasibility?.violations || [],
        recommendedActions: infeasibility?.recommendedActions || [],
        feedType: getFeedType(standard.feedCategory),
        fishSubtype: getFishSubtype(standard),
        poultryType: standard.poultryType?.toLowerCase()
    };
};

const toStructuredNonCompliantResponse = (
    standard: IFeedStandard,
    options: FormulationOption[]
): StructuredNonCompliantResponse => {
    const bestOption = options
        .slice()
        .sort((a, b) => b.qualityMatch - a.qualityMatch)[0];

    return {
        status: 'non_compliant',
        error: 'No compliant formulation available',
        message: 'A mathematical mix was generated, but every option failed compliance checks.',
        suggestion: 'Add stronger ingredients, widen the ingredient set, or use Check Existing Mix to evaluate a fixed spreadsheet formula without optimization.',
        bestQualityMatch: Number(bestOption?.qualityMatch || 0),
        feedType: getFeedType(standard.feedCategory),
        fishSubtype: getFishSubtype(standard),
        poultryType: standard.poultryType?.toLowerCase()
    };
};

const runFormulationComputation = async (
    payload: FormulationRequestBody
): Promise<BuildComputationResult> => {
    const { targetWeightKg, selectedIngredients, overheadCost = 0, targetOverrides } = payload;
    const effectiveWeightKg = Number(targetWeightKg);

    const standard = await resolveStandardForRequest(payload);
    if (!standard) {
        throw new FormulationRequestError('Feed standard not found', 404);
    }

    const originalIngredientIds = selectedIngredients.map((ing) => ing.ingredientId);
    const originalIngredients = await Ingredient.find({
        _id: { $in: originalIngredientIds },
        isActive: true
    });

    const originalById = new Map<string, (typeof originalIngredients)[number]>();
    originalIngredients.forEach((ingredient) => {
        originalById.set(ingredient._id.toString(), ingredient);
    });

    const feedType = getFeedType(standard.feedCategory);
    const alternativeRules = await AlternativeRule.find({
        originalIngredientId: { $in: originalIngredientIds },
        isActive: true,
        feedType: { $in: [feedType, 'both'] }
    }).lean();

    const alternativeRulesByOriginalId = new Map<
        string,
        Array<{
            originalIngredientId: unknown;
            alternativeIngredientId: unknown;
            maxBlendPercent?: number;
            notes?: string;
        }>
    >();
    alternativeRules.forEach((rule) => {
        const key = objectIdToString(rule.originalIngredientId);
        const current = alternativeRulesByOriginalId.get(key) || [];
        current.push(rule);
        alternativeRulesByOriginalId.set(key, current);
    });

    const resolvedSelections: ResolvedSelectedIngredient[] = selectedIngredients.map((selection) => {
        const sourceIngredient = originalById.get(selection.ingredientId);
        if (!sourceIngredient) {
            return {
                ...selection,
                originalIngredientId: selection.ingredientId,
                selectionMode: 'original',
            };
        }
        const candidateRules = alternativeRulesByOriginalId.get(selection.ingredientId) || [];

        if (selection.alternativeIngredientId && selection.alternativeIngredientId !== 'AUTO') {
            const explicitRule = candidateRules.find(
                (rule) =>
                    objectIdToString(rule.alternativeIngredientId) ===
                    selection.alternativeIngredientId,
            );
            if (!explicitRule) {
                throw new FormulationRequestError(
                    `Selected alternative is not valid for ${sourceIngredient.name}.`,
                );
            }

            return {
                ...selection,
                ingredientId: selection.alternativeIngredientId,
                originalIngredientId: sourceIngredient._id.toString(),
                originalIngredientName: sourceIngredient.name,
                selectionMode: 'explicit',
                alternativeRuleMaxBlendPercent: Number(
                    explicitRule.maxBlendPercent ?? 100,
                ),
                alternativeRuleNotes: explicitRule.notes,
            };
        }

        if (selection.alternativeIngredientId === 'AUTO') {
            const autoRule = chooseAutoAlternativeRule(sourceIngredient, candidateRules);
            const firstAlternative = objectIdToString(autoRule?.alternativeIngredientId);
            if (firstAlternative) {
                return {
                    ...selection,
                    ingredientId: firstAlternative,
                    originalIngredientId: sourceIngredient._id.toString(),
                    originalIngredientName: sourceIngredient.name,
                    selectionMode: 'auto',
                    alternativeRuleMaxBlendPercent: Number(
                        autoRule?.maxBlendPercent ?? 100,
                    ),
                    alternativeRuleNotes: autoRule?.notes,
                };
            }
        }

        return {
            ...selection,
            originalIngredientId: sourceIngredient._id.toString(),
            originalIngredientName: sourceIngredient.name,
            selectionMode: 'original',
        };
    });

    const resolvedSelectionIds = resolvedSelections.map(
        (selection) => selection.ingredientId,
    );
    const duplicateResolvedSelectionIds = Array.from(
        new Set(
            resolvedSelectionIds.filter(
                (id, index) => resolvedSelectionIds.indexOf(id) !== index,
            ),
        ),
    );
    if (duplicateResolvedSelectionIds.length > 0) {
        const duplicateNames = duplicateResolvedSelectionIds
            .map((ingredientId) => {
                const selection = resolvedSelections.find(
                    (item) => item.ingredientId === ingredientId,
                );
                return selection?.originalIngredientName || ingredientId;
            })
            .join(', ');
        throw new FormulationRequestError(
            `Multiple selected ingredients resolve to the same ingredient (${duplicateNames}). Remove duplicates or choose different alternatives.`,
        );
    }

    const resolvedIngredientIds = resolvedSelections.map((ing) => ing.ingredientId);
    const ingredients = await Ingredient.find({
        _id: { $in: resolvedIngredientIds },
        isActive: true
    });

    if (ingredients.length === 0) {
        throw new FormulationRequestError('No valid ingredients selected');
    }

    if (ingredients.length !== resolvedIngredientIds.length) {
        throw new FormulationRequestError(
            'One or more selected alternative ingredients are unavailable or inactive.',
        );
    }

    const selectedByIngredientId = new Map<string, ResolvedSelectedIngredient>();
    resolvedSelections.forEach((selected) => {
        selectedByIngredientId.set(selected.ingredientId, selected);
    });

    const ingredientById = new Map(
        ingredients.map((ingredient) => [ingredient._id.toString(), ingredient]),
    );

    const appliedAlternatives = resolvedSelections
        .reduce<AppliedAlternativeSelection[]>((accumulator, selection) => {
            if (
                selection.selectionMode !== 'explicit' &&
                selection.selectionMode !== 'auto'
            ) {
                return accumulator;
            }

                const alternativeIngredient = ingredientById.get(selection.ingredientId);
                if (!alternativeIngredient || !selection.originalIngredientName) {
                    return accumulator;
                }
                const originalIngredient = originalById.get(selection.originalIngredientId);
                accumulator.push({
                    originalIngredientId: selection.originalIngredientId,
                    originalIngredientName: selection.originalIngredientName,
                    alternativeIngredientId: alternativeIngredient._id.toString(),
                    alternativeIngredientName: alternativeIngredient.name,
                    selectionMode: selection.selectionMode as 'explicit' | 'auto',
                    maxBlendPercent: Number(
                        selection.alternativeRuleMaxBlendPercent ?? 100,
                    ),
                    notes: selection.alternativeRuleNotes,
                    estimatedCostDeltaPerKg:
                        Number(alternativeIngredient.defaultPrice || 0) -
                        Number(originalIngredient?.defaultPrice || 0),
                });
                return accumulator;
            }, []);

    const ingredientsForSolver = ingredients
        .filter((ing) => !ing.isAutoCalculated)
        .map((ing) => {
            const selectedIng = selectedByIngredientId.get(ing._id.toString());
            const minInclusion =
                selectedIng?.minInclusionPct ?? ing.constraints.min_inclusion;
            const maxCandidates = [
                selectedIng?.maxInclusionPct,
                ing.constraints.max_inclusion,
                selectedIng?.alternativeRuleMaxBlendPercent,
            ].filter(
                (value): value is number =>
                    typeof value === 'number' && Number.isFinite(value),
            );
            const maxInclusion =
                maxCandidates.length > 0 ? Math.min(...maxCandidates) : undefined;

            if (
                minInclusion !== undefined &&
                maxInclusion !== undefined &&
                minInclusion > maxInclusion
            ) {
                throw new FormulationRequestError(
                    `${ing.name} minimum inclusion (${minInclusion}%) exceeds the allowed maximum (${maxInclusion}%).`,
                );
            }

            return {
                id: ing._id.toString(),
                name: ing.name,
                price: selectedIng?.customPrice ?? ing.defaultPrice ?? 0,
                nutrients: ing.nutrients,
                constraints: {
                    ...(minInclusion !== undefined ? { min_inclusion: minInclusion } : {}),
                    ...(maxInclusion !== undefined ? { max_inclusion: maxInclusion } : {})
                },
                bagWeight: ing.bagWeight,
                specificGravity: ing.specificGravity,
                tags: ing.tags,
                alternatives: (ing.alternatives || []).map((alt) => alt.toString())
            };
        });

    const autoCalculatedIngredients = ingredients.filter(
        (ing) => ing.isAutoCalculated && ing.autoCalcRatio
    );

    const rawTarget = standard.targetNutrients as unknown as {
        toObject?: () => Record<string, unknown>;
        _doc?: Record<string, unknown>;
    };
    const baseTarget = rawTarget.toObject ? rawTarget.toObject() : rawTarget._doc || rawTarget as unknown as Record<string, unknown>;
    const relaxedBaseTarget = applyGlobalTargetRelaxation(
        baseTarget,
        payload.globalTargetRelaxationPct
    );
    const targetNutrients = mergeTargets(relaxedBaseTarget, targetOverrides);
    const catfishStageGuidance = getCatfishStageGuidance(standard);

    const strategies: FormulationStrategy[] = [
        FormulationStrategy.LEAST_COST,
        FormulationStrategy.BALANCED,
        FormulationStrategy.PREMIUM
    ];

    const options: Array<FormulationOption | InfeasibleStrategyOption> = await Promise.all(strategies.map(async (strategy) => {
        const solverResult = await solverService.optimizeFormulation({
            targetWeightKg: effectiveWeightKg,
            ingredients: ingredientsForSolver,
            nutritionalTarget: targetNutrients as unknown as Parameters<typeof solverService.optimizeFormulation>[0]['nutritionalTarget'],
            tolerance: standard.tolerance,
            strategy,
            feedCategory: standard.feedCategory,
            poultryType: standard.poultryType,
            catfishStageGuidance
        });

        if (!solverResult.feasible) {
            return {
                strategy,
                feasible: false as const,
                message: solverResult.message,
                infeasibility: solverResult.infeasibility
            };
        }

        const looseQuantitiesKg = { ...solverResult.ingredientQuantities };

        let totalCostWithBags = 0;
        Object.keys(looseQuantitiesKg).forEach((ingId) => {
            const solverIngredient = ingredientsForSolver.find((i) => i.id === ingId);
            if (solverIngredient) {
                totalCostWithBags += looseQuantitiesKg[ingId] * solverIngredient.price;
            }
        });

        const autoCalcRecipe: FormulationOption['recipe'] = [];
        autoCalculatedIngredients.forEach((autoIng) => {
            const qty = effectiveWeightKg * (autoIng.autoCalcRatio || 0);
            const price = autoIng.defaultPrice || 0;
            totalCostWithBags += qty * price;
            autoCalcRecipe.push({
                name: autoIng.name,
                qtyKg: qty,
                bags: 0,
                priceAtMoment: price,
                isAutoCalculated: true
            });
        });

        const looseBaseWeightKg = Object.values(looseQuantitiesKg)
            .reduce((sum, qty) => sum + Number(qty || 0), 0);
        const autoCalculatedWeightKg = autoCalcRecipe
            .reduce((sum, item) => sum + Number(item.qtyKg || 0), 0);
        const actualOutputWeightKg = looseBaseWeightKg + autoCalculatedWeightKg;

        const roundedActualNutrients = await solverService.calculateActualNutrients(
            looseQuantitiesKg,
            ingredientsForSolver,
            actualOutputWeightKg > 0 ? actualOutputWeightKg : effectiveWeightKg
        );

        totalCostWithBags += Number(overheadCost);

        const recipeSnapshot = Object.keys(solverResult.ingredientQuantities).map((ingId) => {
            const ingredient = ingredients.find((i) => i._id.toString() === ingId);
            const priceAtMoment = ingredientsForSolver.find((i) => i.id === ingId)?.price || 0;
            return {
                name: ingredient?.name || 'Unknown Ingredient',
                qtyKg: Number(looseQuantitiesKg[ingId] || 0),
                bags: 0,
                priceAtMoment
            };
        });

        const complianceResult = complianceService.checkCompliance(
            roundedActualNutrients,
            targetNutrients as unknown as Parameters<typeof complianceService.checkCompliance>[1],
            standard.tolerance,
            recipeSnapshot.map((recipeItem) => ({
                name: recipeItem.name,
                qtyKg: recipeItem.qtyKg,
                tags: ingredients.find((i) => i.name === recipeItem.name)?.tags
            })),
            actualOutputWeightKg > 0 ? actualOutputWeightKg : effectiveWeightKg,
            {
                feedCategory: standard.feedCategory,
                poultryType: standard.poultryType
            }
        );

        return {
            strategy,
            feasible: true as const,
            complianceColor: complianceResult.color,
            qualityMatch: complianceResult.qualityMatch,
            nutrientStatuses: complianceResult.deviations,
            totalCost: totalCostWithBags,
            costPerKg: totalCostWithBags / (actualOutputWeightKg > 0 ? actualOutputWeightKg : effectiveWeightKg),
            actualNutrients: roundedActualNutrients as unknown as Record<string, number>,
            requestedTargetWeightKg: effectiveWeightKg,
            actualOutputWeightKg: actualOutputWeightKg > 0 ? actualOutputWeightKg : effectiveWeightKg,
            evaluationMode: 'optimized',
            recipe: [...recipeSnapshot, ...autoCalcRecipe],
            appliedAlternatives,
            overheadCost: Number(overheadCost)
        };
    }));

    const feasibleOptions = options.filter((option): option is FormulationOption => option.feasible);
    const infeasibility = options.find((option) => !option.feasible)?.infeasibility;

    return {
        feasibleOptions,
        infeasibility,
        standard,
        effectiveWeightKg
    };
};

const evaluateExistingMix = async (
    payload: FormulationRequestBody
): Promise<{ standard: IFeedStandard; option: FormulationOption }> => {
    const standard = await resolveStandardForRequest(payload);
    if (!standard) {
        throw new FormulationRequestError('Feed standard not found', 404);
    }

    if (payload.selectedIngredients.length === 0) {
        throw new FormulationRequestError(
            'Select at least one ingredient to check an existing mix.'
        );
    }

    if (
        payload.selectedIngredients.some(
            (item) => item.exactQtyKg === undefined || Number(item.exactQtyKg) <= 0
        )
    ) {
        throw new FormulationRequestError(
            'Every selected ingredient needs an exact quantity in kg for Check Existing Mix mode.'
        );
    }

    const ingredientIds = payload.selectedIngredients.map((item) => item.ingredientId);
    const ingredients = await Ingredient.find({
        _id: { $in: ingredientIds },
        isActive: true
    });

    if (ingredients.length !== ingredientIds.length) {
        throw new FormulationRequestError(
            'One or more selected ingredients are unavailable or inactive.'
        );
    }

    const ingredientById = new Map(
        ingredients.map((ingredient) => [ingredient._id.toString(), ingredient])
    );

    const quantities: Record<string, number> = {};
    const recipe: FormulationOption['recipe'] = [];
    const reportIngredients: Array<{ name: string; qtyKg: number; tags?: string[] }> = [];
    let totalCost = 0;
    let actualOutputWeightKg = 0;

    payload.selectedIngredients.forEach((selection) => {
        const ingredient = ingredientById.get(selection.ingredientId);
        if (!ingredient) return;

        const qtyKg = Number(selection.exactQtyKg || 0);
        const priceAtMoment = Number(
            selection.customPrice !== undefined
                ? selection.customPrice
                : ingredient.defaultPrice || 0
        );
        quantities[selection.ingredientId] = qtyKg;
        actualOutputWeightKg += qtyKg;
        totalCost += qtyKg * priceAtMoment;
        recipe.push({
            name: ingredient.name,
            qtyKg,
            bags: 0,
            priceAtMoment,
            isAutoCalculated: Boolean(ingredient.isAutoCalculated)
        });
        reportIngredients.push({
            name: ingredient.name,
            qtyKg,
            tags: ingredient.tags
        });
    });

    if (actualOutputWeightKg <= 0) {
        throw new FormulationRequestError(
            'The exact mix total must be greater than 0 kg.'
        );
    }

    const rawTarget = standard.targetNutrients as unknown as {
        toObject?: () => Record<string, unknown>;
        _doc?: Record<string, unknown>;
    };
    const targetNutrients = rawTarget.toObject
        ? rawTarget.toObject()
        : rawTarget._doc || rawTarget as unknown as Record<string, unknown>;

    const actualNutrients = await solverService.calculateActualNutrients(
        quantities,
        ingredients.map((ingredient) => ({
            id: ingredient._id.toString(),
            name: ingredient.name,
            price: Number(ingredient.defaultPrice || 0),
            nutrients: ingredient.nutrients,
            constraints: ingredient.constraints,
            bagWeight: ingredient.bagWeight,
            tags: ingredient.tags,
            alternatives: (ingredient.alternatives || []).map((alt) => alt.toString())
        })),
        actualOutputWeightKg
    );

    const complianceResult = complianceService.checkCompliance(
        actualNutrients,
        targetNutrients as unknown as Parameters<typeof complianceService.checkCompliance>[1],
        standard.tolerance,
        reportIngredients,
        actualOutputWeightKg,
        {
            feedCategory: standard.feedCategory,
            poultryType: standard.poultryType
        }
    );

    return {
        standard,
        option: {
            strategy: 'EXACT_MIX',
            feasible: true,
            complianceColor: complianceResult.color,
            qualityMatch: complianceResult.qualityMatch,
            nutrientStatuses: complianceResult.deviations,
            totalCost,
            costPerKg: totalCost / actualOutputWeightKg,
            actualNutrients: actualNutrients as unknown as Record<string, number>,
            requestedTargetWeightKg:
                payload.targetWeightKg > 0
                    ? Number(payload.targetWeightKg)
                    : actualOutputWeightKg,
            actualOutputWeightKg,
            evaluationMode: 'exact',
            recipe,
            appliedAlternatives: [],
            overheadCost: Number(payload.overheadCost || 0)
        }
    };
};

export const calculateFormulation = async (req: Request, res: Response) => {
    try {
        const payload = coerceFormulationRequest(req.body);

        if (!payload.targetWeightKg || !hasStandardSelector(payload) || payload.selectedIngredients.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['targetWeightKg', 'standardId or stageCode', 'selectedIngredients']
            });
        }

        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const computation = await runFormulationComputation(payload);
        if (computation.feasibleOptions.length === 0) {
            return res.json(toStructuredInfeasibleResponse(computation.standard, computation.infeasibility));
        }

        if (computation.feasibleOptions.every((option) => option.complianceColor === 'Red')) {
            return res.json(
                toStructuredNonCompliantResponse(
                    computation.standard,
                    computation.feasibleOptions
                )
            );
        }

        const allRecipeNames = Array.from(new Set(
            computation.feasibleOptions.flatMap((option) => option.recipe.map((item) => item.name))
        ));
        const snapshotIngredients = await Ingredient.find({
            name: { $in: allRecipeNames }
        });
        const ingredientByName = new Map(snapshotIngredients.map((ing) => [ing.name, ing]));

        const mapOptionIngredients = (option: FormulationOption) => (
            option.recipe
                .map((recipeItem) => {
                    const ingredient = ingredientByName.get(recipeItem.name);
                    if (!ingredient) return null;
                    return {
                        ...recipeItem,
                        ingredientId: ingredient._id,
                        nutrientsAtMoment: ingredient.nutrients
                    };
                })
                .filter((item): item is {
                    name: string;
                    qtyKg: number;
                    bags: number;
                    priceAtMoment: number;
                    ingredientId: typeof snapshotIngredients[number]['_id'];
                    nutrientsAtMoment: typeof snapshotIngredients[number]['nutrients'];
                } => item !== null)
        );

        const strategyOptions = computation.feasibleOptions
            .map((option) => {
                const ingredientsUsed = mapOptionIngredients(option);
                if (ingredientsUsed.length === 0) return null;
                return {
                    strategy: option.strategy,
                    totalCost: option.totalCost,
                    costPerKg: option.costPerKg,
                    overheadCost: option.overheadCost,
                    complianceColor: option.complianceColor,
                    qualityMatchPercentage: option.qualityMatch,
                    actualNutrients: option.actualNutrients,
                    ingredientsUsed,
                    appliedAlternatives: option.appliedAlternatives
                };
            })
            .filter((option): option is {
                strategy: FormulationStrategy;
                totalCost: number;
                costPerKg: number;
                overheadCost: number;
                complianceColor: 'Red' | 'Blue' | 'Green';
                qualityMatchPercentage: number;
                actualNutrients: Record<string, number>;
                ingredientsUsed: Array<{
                    name: string;
                    qtyKg: number;
                    bags: number;
                    priceAtMoment: number;
                    ingredientId: typeof snapshotIngredients[number]['_id'];
                    nutrientsAtMoment: typeof snapshotIngredients[number]['nutrients'];
                }>;
                appliedAlternatives: AppliedAlternativeSelection[];
            } => option !== null);

        if (strategyOptions.length === 0) {
            return res.status(400).json({
                error: 'Unable to persist formulation snapshot',
                details: 'No recipe ingredients could be resolved in the ingredient catalog.'
            });
        }

        const referenceOption = strategyOptions[0];

        const summary = new Formulation({
            userId,
            farmId: req.body.farmId,
            batchName: payload.batchName || `Mix Search ${new Date().toLocaleDateString()}`,
            targetWeightKg: computation.effectiveWeightKg,
            standardUsed: computation.standard._id,
            totalCost: referenceOption.totalCost,
            costPerKg: referenceOption.costPerKg,
            overheadCost: referenceOption.overheadCost,
            complianceColor: referenceOption.complianceColor,
            qualityMatchPercentage: referenceOption.qualityMatchPercentage,
            actualNutrients: referenceOption.actualNutrients,
            appliedAlternatives: referenceOption.appliedAlternatives,
            isDemo: false,
            ingredientsUsed: referenceOption.ingredientsUsed,
            strategyOptions,
            configSnapshot: await configService.getAll(),
            isUnlocked: false
        });

        await summary.save();
        const formulationId = summary._id.toString();

        await User.findByIdAndUpdate(userId, {
            $inc: { formulaCount: 1 },
            $set: { freeTrialUsed: true }
        });

        return res.json({
            formulationId,
            status: 'feasible',
            feedType: getFeedType(computation.standard.feedCategory),
            fishSubtype: getFishSubtype(computation.standard),
            poultryType: computation.standard.poultryType?.toLowerCase(),
            options: computation.feasibleOptions,
            isDemo: false,
            effectiveWeightKg: computation.effectiveWeightKg,
            message: 'Multi-strategy formulations calculated. Compare and unlock your preferred mix.'
        });
    } catch (error) {
        if (error instanceof FormulationRequestError) {
            return res.status(error.statusCode).json({
                error: error.message,
                message: error.message
            });
        }
        console.error('Error calculating formulation:', error);
        return res.status(500).json({
            error: 'Failed to calculate formulation',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

export const checkExistingMix = async (req: Request, res: Response) => {
    try {
        const payload = coerceFormulationRequest(req.body);

        if (!hasStandardSelector(payload) || payload.selectedIngredients.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['standardId or stageCode', 'selectedIngredients']
            });
        }

        const evaluation = await evaluateExistingMix(payload);

        return res.json({
            status: 'evaluated',
            feedType: getFeedType(evaluation.standard.feedCategory),
            fishSubtype: getFishSubtype(evaluation.standard),
            poultryType: evaluation.standard.poultryType?.toLowerCase(),
            options: [evaluation.option],
            isDemo: false,
            effectiveWeightKg: evaluation.option.actualOutputWeightKg,
            requestedTargetWeightKg: evaluation.option.requestedTargetWeightKg,
            message: 'Existing mix evaluated against the selected standard.'
        });
    } catch (error) {
        if (error instanceof FormulationRequestError) {
            return res.status(error.statusCode).json({
                error: error.message,
                message: error.message
            });
        }
        console.error('Error evaluating existing mix:', error);
        return res.status(500).json({
            error: 'Failed to evaluate existing mix',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Preview one-tap fix for infeasible requests without persisting a formulation.
 * POST /api/v1/formulations/preview-fix
 */
export const previewFormulationFix = async (req: Request, res: Response) => {
    try {
        const input = req.body as {
            originalRequest?: FormulationRequestBody;
            action?: { actionType?: string; patch?: Record<string, unknown> };
        };
        const baseRequest = coerceFormulationRequest(input.originalRequest || req.body);
        const patchedRequest = applyActionPatchToRequest(baseRequest, input.action || {});

        if (!baseRequest.targetWeightKg || !hasStandardSelector(baseRequest) || baseRequest.selectedIngredients.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['targetWeightKg', 'standardId or stageCode', 'selectedIngredients']
            });
        }

        const [baseline, preview] = await Promise.all([
            runFormulationComputation(baseRequest),
            runFormulationComputation(patchedRequest)
        ]);

        if (preview.feasibleOptions.length === 0) {
            return res.json({
                ...toStructuredInfeasibleResponse(preview.standard, preview.infeasibility),
                status: 'preview_infeasible',
                baselineFeasible: baseline.feasibleOptions.length > 0
            });
        }

        if (preview.feasibleOptions.every((option) => option.complianceColor === 'Red')) {
            return res.json({
                ...toStructuredNonCompliantResponse(preview.standard, preview.feasibleOptions),
                status: 'preview_non_compliant',
                baselineFeasible: baseline.feasibleOptions.length > 0
            });
        }

        const bestPreview = preview.feasibleOptions
            .slice()
            .sort((a, b) => a.totalCost - b.totalCost)[0];
        const bestBaseline = baseline.feasibleOptions
            .slice()
            .sort((a, b) => a.totalCost - b.totalCost)[0];

        return res.json({
            status: 'preview',
            feedType: getFeedType(preview.standard.feedCategory),
            fishSubtype: getFishSubtype(preview.standard),
            poultryType: preview.standard.poultryType?.toLowerCase(),
            action: input.action || null,
            preview: {
                feasible: true,
                bestOption: bestPreview,
                options: preview.feasibleOptions,
                estimatedCostDelta: bestBaseline ? bestPreview.totalCost - bestBaseline.totalCost : null,
                estimatedComplianceDelta: bestBaseline
                    ? bestPreview.qualityMatch - bestBaseline.qualityMatch
                    : null
            }
        });
    } catch (error) {
        if (error instanceof FormulationRequestError) {
            return res.status(error.statusCode).json({
                error: error.message,
                message: error.message
            });
        }
        console.error('Error previewing formulation fix:', error);
        return res.status(500).json({
            error: 'Failed to preview formulation fix',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Evaluate alternative ingredient mappings with short-lived cache.
 * POST /api/v1/formulations/alternatives/evaluate
 */
export const evaluateAlternativeOptions = async (req: Request, res: Response) => {
    try {
        const payload = req.body as {
            standardId?: string;
            selectedIngredients?: Array<{ ingredientId: string }>;
        };

        if (!payload.standardId || !Array.isArray(payload.selectedIngredients)) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['standardId', 'selectedIngredients']
            });
        }

        const standard = await FeedStandard.findById(payload.standardId).lean();
        if (!standard) {
            return res.status(404).json({ error: 'Feed standard not found' });
        }

        const feedType = getFeedType(standard.feedCategory);
        const ingredientIds = payload.selectedIngredients.map((item) => item.ingredientId);

        const cacheKey = alternativeCacheService.createKey({
            feedType,
            ingredientIds: ingredientIds.sort()
        });
        const cached = await alternativeCacheService.get<{
            suggestions: unknown[];
            groups?: AlternativeSuggestionGroup[];
            feedType: string;
            generatedAt: string;
        }>(cacheKey);
        if (cached) {
            const cachedGroups = Array.isArray(cached.groups)
                ? cached.groups
                : buildAlternativeSuggestionGroups(
                    ingredientIds,
                    (Array.isArray(cached.suggestions) ? cached.suggestions : [])
                        .filter(
                            (item): item is {
                                ruleId: string;
                                originalIngredient: {
                                    id?: string;
                                    name: string;
                                    price: number;
                                    category?: string;
                                };
                                alternativeIngredient: {
                                    id?: string;
                                    name: string;
                                    price: number;
                                    category?: string;
                                };
                                estimatedCostDeltaPerKg: number;
                                maxBlendPercent: number;
                                notes?: string;
                            } =>
                                typeof item === 'object' &&
                                item !== null &&
                                'originalIngredient' in item &&
                                'alternativeIngredient' in item,
                        )
                        .map((item, index) => ({
                            _id: item.ruleId || `cached-${index}`,
                            originalIngredientId: {
                                _id: item.originalIngredient.id,
                                name: item.originalIngredient.name,
                                defaultPrice: item.originalIngredient.price,
                                category: item.originalIngredient.category,
                            },
                            alternativeIngredientId: {
                                _id: item.alternativeIngredient.id,
                                name: item.alternativeIngredient.name,
                                defaultPrice: item.alternativeIngredient.price,
                                category: item.alternativeIngredient.category,
                            },
                            maxBlendPercent: item.maxBlendPercent,
                            notes: item.notes,
                        })),
                );
            return res.json({
                status: 'cached',
                cacheKey,
                ...cached,
                groups: cachedGroups,
            });
        }

        const rules = await AlternativeRule.find({
            originalIngredientId: { $in: ingredientIds },
            isActive: true,
            feedType: { $in: [feedType, 'both'] }
        })
            .populate('originalIngredientId', 'name defaultPrice category')
            .populate('alternativeIngredientId', 'name defaultPrice category')
            .lean();

        const suggestions = rules.map((rule) => {
            const originalIngredient = rule.originalIngredientId as unknown as {
                _id: unknown;
                name: string;
                defaultPrice?: number;
                category?: string;
            };
            const alternativeIngredient = rule.alternativeIngredientId as unknown as {
                _id: unknown;
                name: string;
                defaultPrice?: number;
                category?: string;
            };

            const originalPrice = originalIngredient.defaultPrice || 0;
            const alternativePrice = alternativeIngredient.defaultPrice || 0;
            return {
                ruleId: rule._id.toString(),
                originalIngredient: {
                    id: originalIngredient._id?.toString(),
                    name: originalIngredient.name,
                    price: originalPrice,
                    category: originalIngredient.category
                },
                alternativeIngredient: {
                    id: alternativeIngredient._id?.toString(),
                    name: alternativeIngredient.name,
                    price: alternativePrice,
                    category: alternativeIngredient.category
                },
                estimatedCostDeltaPerKg: alternativePrice - originalPrice,
                maxBlendPercent: rule.maxBlendPercent || 100,
                notes: rule.notes
            };
        });

        const groups = buildAlternativeSuggestionGroups(ingredientIds, rules as unknown as Array<{
            _id: unknown;
            originalIngredientId: {
                _id?: unknown;
                name: string;
                defaultPrice?: number;
                category?: string;
            };
            alternativeIngredientId: {
                _id?: unknown;
                name: string;
                defaultPrice?: number;
                category?: string;
            };
            maxBlendPercent?: number;
            notes?: string;
        }>);

        const responsePayload = {
            suggestions,
            groups,
            feedType,
            generatedAt: new Date().toISOString()
        };
        await alternativeCacheService.set(cacheKey, responsePayload);

        return res.json({
            status: 'computed',
            cacheKey,
            ...responsePayload
        });
    } catch (error) {
        console.error('Error evaluating alternative options:', error);
        return res.status(500).json({
            error: 'Failed to evaluate alternatives',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Fetch cached alternative evaluation.
 * GET /api/v1/formulations/alternatives/cache/:cacheKey
 */
export const getAlternativeCacheResult = async (req: Request, res: Response) => {
    const { cacheKey } = req.params;
    const cached = await alternativeCacheService.get<unknown>(cacheKey);
    if (!cached) {
        return res.status(404).json({ error: 'Cache key not found or expired' });
    }
    return res.json({ status: 'cached', cacheKey, data: cached });
};

/**
 * Get formulation pricing metadata.
 * GET /api/v1/formulations/unlock-fee
 */
export const getFormulationPricing = async (_req: Request, res: Response) => {
    try {
        const formulationFee = await getConfiguredFormulationFee();
        return res.json({ formulationFee });
    } catch (error) {
        console.error('Error fetching formulation pricing:', error);
        return res.status(500).json({
            error: 'Failed to fetch formulation pricing',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get formulation summary for dashboard cards.
 * GET /api/v1/formulations/summary
 */
export const getFormulationSummary = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const recentLimit = Math.max(
            1,
            Math.min(20, Number.parseInt(String(req.query.recentLimit || '8'), 10) || 8)
        );

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.json({
                summary: {
                    total: 0,
                    unlocked: 0,
                    locked: 0,
                    compliant: 0,
                    avgQualityMatch: 0,
                    totalCost: 0,
                    feedTypeCounts: { fish: 0, poultry: 0 }
                },
                recentMixes: []
            });
        }

        const objectUserId = new mongoose.Types.ObjectId(userId);

        const [summaryRows, feedTypeRows, recentFormulations] = await Promise.all([
            Formulation.aggregate([
                { $match: { userId: objectUserId } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        unlocked: {
                            $sum: { $cond: [{ $eq: ['$isUnlocked', true] }, 1, 0] }
                        },
                        green: {
                            $sum: { $cond: [{ $eq: ['$complianceColor', 'Green'] }, 1, 0] }
                        },
                        avgQualityMatch: { $avg: '$qualityMatchPercentage' },
                        totalCost: { $sum: '$totalCost' }
                    }
                }
            ]),
            Formulation.aggregate([
                { $match: { userId: objectUserId } },
                {
                    $lookup: {
                        from: 'feedstandards',
                        localField: 'standardUsed',
                        foreignField: '_id',
                        as: 'standardUsed'
                    }
                },
                {
                    $unwind: {
                        path: '$standardUsed',
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $group: {
                        _id: {
                            $cond: [
                                { $eq: [{ $toLower: '$standardUsed.feedCategory' }, 'poultry'] },
                                'poultry',
                                'fish'
                            ]
                        },
                        count: { $sum: 1 }
                    }
                }
            ]),
            Formulation.find({ userId })
                .sort({ createdAt: -1 })
                .limit(recentLimit)
                .populate('standardUsed', 'name feedCategory fishType poultryType')
                .select(
                    '_id batchName complianceColor qualityMatchPercentage totalCost costPerKg isUnlocked createdAt standardUsed'
                )
                .lean()
        ]);

        const rawSummary = summaryRows[0] || {
            total: 0,
            unlocked: 0,
            green: 0,
            avgQualityMatch: 0,
            totalCost: 0
        };
        const total = Number(rawSummary.total || 0);
        const unlocked = Number(rawSummary.unlocked || 0);
        const green = Number(rawSummary.green || 0);
        const avgQualityMatch = Number(rawSummary.avgQualityMatch || 0);
        const totalCost = Number(rawSummary.totalCost || 0);

        const feedTypeCounts = feedTypeRows.reduce<Record<string, number>>((acc, row) => {
            const type = row?._id;
            if (type === 'fish' || type === 'poultry') {
                acc[type] = Number(row.count || 0);
            }
            return acc;
        }, { fish: 0, poultry: 0 });

        const recentMixes = recentFormulations.map((formulation: any) => {
            const standard = formulation.standardUsed || {};
            const standardName = typeof standard.name === 'string' ? standard.name : '';

            return {
                _id: formulation._id,
                batchName: formulation.batchName,
                title: formulation.batchName || standardName || 'Feed Mix',
                complianceColor: formulation.complianceColor,
                qualityMatchPercentage: Number(formulation.qualityMatchPercentage || 0),
                totalCost: Number(formulation.totalCost || 0),
                costPerKg: Number(formulation.costPerKg || 0),
                isUnlocked: formulation.isUnlocked === true,
                createdAt: formulation.createdAt,
                standardUsed: {
                    name: standardName,
                    feedCategory: standard.feedCategory,
                    fishType: standard.fishType,
                    poultryType: standard.poultryType
                }
            };
        });

        return res.json({
            summary: {
                total,
                unlocked,
                locked: Math.max(0, total - unlocked),
                compliant: green,
                avgQualityMatch,
                totalCost,
                feedTypeCounts
            },
            recentMixes
        });
    } catch (error) {
        console.error('Error fetching formulation summary:', error);
        return res.status(500).json({
            error: 'Failed to fetch formulation summary',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get data-dense formulation analytics overview.
 * GET /api/v1/formulations/analytics/overview
 */
export const getFormulationAnalyticsOverview = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const from = parseDateQuery(req.query.from);
        const to = parseDateQuery(req.query.to);
        const feedType = parseFeedTypeQuery(req.query.feedType);
        const stageCode = String(req.query.stageCode || '').trim().toUpperCase() || undefined;

        const overview = await getAnalyticsOverview({
            userId,
            from,
            to,
            feedType,
            stageCode
        });

        return res.json(overview);
    } catch (error) {
        console.error('Error fetching formulation analytics overview:', error);
        return res.status(500).json({
            error: 'Failed to fetch formulation analytics overview',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get formulation analytics trend points.
 * GET /api/v1/formulations/analytics/trends
 */
export const getFormulationAnalyticsTrends = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const metricParam = String(req.query.metric || 'costPerKg');
        const metric = (
            metricParam === 'qualityMatch' || metricParam === 'complianceRate'
                ? metricParam
                : 'costPerKg'
        ) as 'costPerKg' | 'qualityMatch' | 'complianceRate';
        const intervalParam = String(req.query.interval || 'week');
        const interval = (intervalParam === 'day' ? 'day' : 'week') as 'day' | 'week';
        const from = parseDateQuery(req.query.from);
        const to = parseDateQuery(req.query.to);
        const feedType = parseFeedTypeQuery(req.query.feedType);
        const stageCode = String(req.query.stageCode || '').trim().toUpperCase() || undefined;

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
        console.error('Error fetching formulation analytics trends:', error);
        return res.status(500).json({
            error: 'Failed to fetch formulation analytics trends',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get explicit calculation ledger for a formulation.
 * GET /api/v1/formulations/:id/calculation-ledger
 */
export const getCalculationLedger = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const formulation = await getFormulationWithStandardForUser(req.params.id, userId);
        if (!formulation) {
            return res.status(404).json({ error: 'Formulation not found' });
        }

        const ledger = buildCalculationLedger(formulation);
        return res.json(ledger);
    } catch (error) {
        console.error('Error fetching formulation calculation ledger:', error);
        return res.status(500).json({
            error: 'Failed to fetch formulation calculation ledger',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Export formulation report as CSV or PDF.
 * POST /api/v1/formulations/:id/export
 */
export const exportFormulationReport = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const formatInput = String(req.body?.format || 'csv').toLowerCase();
        const format = (formatInput === 'pdf' ? 'pdf' : 'csv') as 'csv' | 'pdf';
        const formulation = await getFormulationWithStandardForUser(req.params.id, userId);
        if (!formulation) {
            return res.status(404).json({ error: 'Formulation not found' });
        }

        const ledger = buildCalculationLedger(formulation);
        const exported = buildFormulationExport(ledger, format);

        res.setHeader('Content-Type', exported.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);

        if (Buffer.isBuffer(exported.data)) {
            return res.send(exported.data);
        }
        return res.send(exported.data);
    } catch (error) {
        console.error('Error exporting formulation report:', error);
        return res.status(500).json({
            error: 'Failed to export formulation report',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

type StrategySnapshot = {
    strategy: string;
    totalCost: number;
    costPerKg: number;
    overheadCost?: number;
    complianceColor: 'Red' | 'Blue' | 'Green';
    qualityMatchPercentage: number;
    actualNutrients: Record<string, number>;
    ingredientsUsed: unknown[];
    appliedAlternatives: AppliedAlternativeSelection[];
};

const normalizeStrategy = (value?: string): string | undefined => {
    if (!value) return undefined;
    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : undefined;
};

const getStrategySnapshots = (formulation: any): StrategySnapshot[] => {
    const snapshots = Array.isArray(formulation.strategyOptions)
        ? formulation.strategyOptions
        : [];
    if (snapshots.length > 0) {
        return snapshots.map((snapshot: any) => ({
            strategy: normalizeStrategy(snapshot.strategy) || 'LEAST_COST',
            totalCost: Number(snapshot.totalCost || 0),
            costPerKg: Number(snapshot.costPerKg || 0),
            overheadCost: Number(snapshot.overheadCost || 0),
            complianceColor: snapshot.complianceColor || 'Blue',
            qualityMatchPercentage: Number(snapshot.qualityMatchPercentage || 0),
            actualNutrients: snapshot.actualNutrients || {},
            ingredientsUsed: snapshot.ingredientsUsed || [],
            appliedAlternatives: Array.isArray(snapshot.appliedAlternatives)
                ? snapshot.appliedAlternatives
                : []
        }));
    }

    return [{
        strategy: normalizeStrategy(formulation.selectedStrategy) || 'LEAST_COST',
        totalCost: Number(formulation.totalCost || 0),
        costPerKg: Number(formulation.costPerKg || 0),
        overheadCost: Number(formulation.overheadCost || 0),
        complianceColor: formulation.complianceColor || 'Blue',
        qualityMatchPercentage: Number(formulation.qualityMatchPercentage || 0),
        actualNutrients: formulation.actualNutrients || {},
        ingredientsUsed: formulation.ingredientsUsed || [],
        appliedAlternatives: Array.isArray(formulation.appliedAlternatives)
            ? formulation.appliedAlternatives
            : []
    }];
};

const resolveStrategySnapshot = (
    formulation: any,
    requestedStrategy?: string
): StrategySnapshot | null => {
    const snapshots = getStrategySnapshots(formulation);
    if (snapshots.length === 0) return null;

    const normalizedRequested = normalizeStrategy(requestedStrategy);
    if (!normalizedRequested) return snapshots[0];

    const matched = snapshots.find((snapshot) => (
        normalizeStrategy(snapshot.strategy) === normalizedRequested
    ));
    return matched || null;
};

const toUnlockResponsePayload = (
    formulation: any,
    snapshot: StrategySnapshot
) => ({
    formulationId: formulation._id,
    strategy: snapshot.strategy,
    isUnlocked: true,
    ingredientsUsed: snapshot.ingredientsUsed,
    recipe: snapshot.ingredientsUsed,
    appliedAlternatives: snapshot.appliedAlternatives,
    totalCost: snapshot.totalCost,
    costPerKg: snapshot.costPerKg,
    complianceColor: snapshot.complianceColor,
    qualityMatch: snapshot.qualityMatchPercentage,
    actualNutrients: snapshot.actualNutrients
});

/**
 * Unlock Formulation (Pay to see full recipe)
 * POST /api/v1/formulations/:id/unlock
 */
export const unlockFormulation = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = getAuthenticatedUserId(req);
        const requestedStrategy = typeof req.body?.strategy === 'string'
            ? req.body.strategy
            : (typeof req.query.strategy === 'string' ? req.query.strategy : undefined);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }

        const unlockFee = await getConfiguredFormulationFee();
        let responsePayload: Record<string, unknown> | null = null;
        let alreadyUnlocked = false;
        let newBalance: number | null = null;

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const formulation = await Formulation.findById(id).session(session);
                if (!formulation) {
                    throw {
                        statusCode: 404,
                        body: { error: 'Formulation not found' }
                    };
                }

                if (formulation.userId.toString() !== userId) {
                    throw {
                        statusCode: 403,
                        body: { error: 'Unauthorized' }
                    };
                }

                const selectedSnapshot = resolveStrategySnapshot(
                    formulation,
                    requestedStrategy
                );
                if (!selectedSnapshot) {
                    const availableStrategies = getStrategySnapshots(formulation)
                        .map((snapshot) => snapshot.strategy);
                    throw {
                        statusCode: 400,
                        body: {
                            error: 'Invalid strategy selection',
                            availableStrategies
                        }
                    };
                }

                if (formulation.isUnlocked) {
                    alreadyUnlocked = true;
                    responsePayload = toUnlockResponsePayload(formulation, selectedSnapshot);
                    return;
                }

                const user = await User.findById(userId).session(session);
                if (!user) {
                    throw {
                        statusCode: 404,
                        body: { error: 'User not found' }
                    };
                }

                if (user.walletBalance < unlockFee) {
                    throw {
                        statusCode: 403,
                        body: {
                            error: 'Insufficient balance',
                            message: `You need ₦${unlockFee.toLocaleString()} to unlock this formulation. Your current balance is ₦${user.walletBalance.toLocaleString()}.`,
                            requiresDeposit: true,
                            requiredAmount: unlockFee - user.walletBalance
                        }
                    };
                }

                user.walletBalance -= unlockFee;
                newBalance = user.walletBalance;
                await user.save({ session });

                await Transaction.create([{
                    userId: user._id,
                    type: 'debit',
                    amount: unlockFee,
                    description: `Formulation Unlock (${selectedSnapshot.strategy})`,
                    status: 'success',
                    balanceAfter: user.walletBalance,
                    formulationId: formulation._id
                }], { session });

                formulation.totalCost = selectedSnapshot.totalCost;
                formulation.costPerKg = selectedSnapshot.costPerKg;
                formulation.overheadCost = Number(selectedSnapshot.overheadCost || 0);
                formulation.complianceColor = selectedSnapshot.complianceColor;
                formulation.qualityMatchPercentage = selectedSnapshot.qualityMatchPercentage;
                formulation.actualNutrients = selectedSnapshot.actualNutrients as any;
                formulation.ingredientsUsed = selectedSnapshot.ingredientsUsed as any;
                formulation.appliedAlternatives = selectedSnapshot.appliedAlternatives as any;
                formulation.selectedStrategy = selectedSnapshot.strategy;
                formulation.isUnlocked = true;
                formulation.unlockedAt = new Date();
                await formulation.save({ session });

                responsePayload = toUnlockResponsePayload(formulation, selectedSnapshot);
            });
        } catch (error: unknown) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
                const apiError = error as { statusCode: number; body: unknown };
                return res.status(apiError.statusCode).json(apiError.body);
            }
            throw error;
        } finally {
            await session.endSession();
        }

        return res.json({
            message: alreadyUnlocked ? 'Formulation already unlocked' : 'Formulation unlocked successfully',
            alreadyUnlocked,
            ...(newBalance !== null ? { newBalance } : {}),
            formulation: responsePayload
        });

    } catch (error) {
        console.error('Error unlocking formulation:', error);
        res.status(500).json({
            error: 'Failed to unlock formulation',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get formulation history
 * GET /api/v1/formulations
 */
export const getFormulations = async (req: Request, res: Response) => {
    try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized. Please log in.' });
        }
        const { limit = 20, skip = 0 } = req.query;

        const formulations = await Formulation
            .find({ userId })
            .lean()
            .sort({ createdAt: -1 })
            .limit(Number(limit))
            .skip(Number(skip))
            .populate('standardUsed', 'name brand pelletSize');

        // Redact ingredients for locked formulations (Teaser Mode)
        const redactedFormulations = formulations.map((f: any) => {
            if (f.isUnlocked) return f;

            return {
                ...f,
                ingredientsUsed: f.ingredientsUsed.map((ing: any) => ({
                    ...ing,
                    qtyKg: 0,
                    bags: 0,
                    priceAtMoment: 0
                }))
            };
        });

        res.json({
            count: formulations.length,
            formulations: redactedFormulations
        });

    } catch (error) {
        console.error('Error fetching formulations:', error);
        res.status(500).json({
            error: 'Failed to fetch formulations',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

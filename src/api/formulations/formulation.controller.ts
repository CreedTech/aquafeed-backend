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

interface SelectedIngredientInput {
    ingredientId: string;
    customPrice?: number;
    volumeLiters?: number;
    minInclusionPct?: number;
    maxInclusionPct?: number;
    alternativeIngredientId?: string;
}

interface FormulationRequestBody {
    targetWeightKg: number;
    standardId: string;
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

interface FormulationOption {
    strategy: FormulationStrategy;
    feasible: true;
    complianceColor: 'Red' | 'Blue' | 'Green';
    qualityMatch: number;
    nutrientStatuses: unknown[];
    totalCost: number;
    costPerKg: number;
    actualNutrients: Record<string, number>;
    recipe: Array<{
        name: string;
        qtyKg: number;
        bags: number;
        priceAtMoment: number;
        isAutoCalculated?: boolean;
    }>;
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

const getFeedType = (feedCategory: string): 'fish' | 'poultry' => (
    feedCategory.toLowerCase() === 'poultry' ? 'poultry' : 'fish'
);

const getAuthenticatedUserId = (req: Request): string | null => (
    req.userId || req.session?.userId || null
);

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
        standardId: String(raw.standardId || ''),
        selectedIngredients: Array.isArray(raw.selectedIngredients)
            ? raw.selectedIngredients.map((i) => ({
                ingredientId: String(i.ingredientId),
                customPrice: i.customPrice !== undefined ? Number(i.customPrice) : undefined,
                volumeLiters: i.volumeLiters !== undefined ? Number(i.volumeLiters) : undefined,
                minInclusionPct: i.minInclusionPct !== undefined ? Number(i.minInclusionPct) : undefined,
                maxInclusionPct: i.maxInclusionPct !== undefined ? Number(i.maxInclusionPct) : undefined,
                alternativeIngredientId: i.alternativeIngredientId
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

const runFormulationComputation = async (
    payload: FormulationRequestBody
): Promise<BuildComputationResult> => {
    const { targetWeightKg, standardId, selectedIngredients, overheadCost = 0, targetOverrides } = payload;
    const effectiveWeightKg = Number(targetWeightKg);

    const standard = await FeedStandard.findById(standardId);
    if (!standard) {
        throw new Error('Feed standard not found');
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

    const resolvedSelections = selectedIngredients.map((selection) => {
        const sourceIngredient = originalById.get(selection.ingredientId);
        if (!sourceIngredient) return selection;

        if (selection.alternativeIngredientId && selection.alternativeIngredientId !== 'AUTO') {
            return { ...selection, ingredientId: selection.alternativeIngredientId };
        }

        if (selection.alternativeIngredientId === 'AUTO') {
            const firstAlternative = sourceIngredient.alternatives?.[0]?.toString();
            if (firstAlternative) {
                return { ...selection, ingredientId: firstAlternative };
            }
        }

        return selection;
    });

    const resolvedIngredientIds = resolvedSelections.map((ing) => ing.ingredientId);
    const ingredients = await Ingredient.find({
        _id: { $in: resolvedIngredientIds },
        isActive: true
    });

    if (ingredients.length === 0) {
        throw new Error('No valid ingredients selected');
    }

    const selectedByIngredientId = new Map<string, SelectedIngredientInput>();
    resolvedSelections.forEach((selected) => {
        selectedByIngredientId.set(selected.ingredientId, selected);
    });

    const ingredientsForSolver = ingredients
        .filter((ing) => !ing.isAutoCalculated)
        .map((ing) => {
            const selectedIng = selectedByIngredientId.get(ing._id.toString());
            const minInclusion = selectedIng?.minInclusionPct ?? ing.constraints.min_inclusion;
            const maxInclusion = selectedIng?.maxInclusionPct ?? ing.constraints.max_inclusion;
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
            poultryType: standard.poultryType
        });

        if (!solverResult.feasible) {
            return {
                strategy,
                feasible: false as const,
                message: solverResult.message,
                infeasibility: solverResult.infeasibility
            };
        }

        const roundedQuantities = solverService.roundToBags(
            solverResult.ingredientQuantities,
            ingredientsForSolver
        );
        const roundedQuantitiesKg = Object.fromEntries(
            Object.entries(roundedQuantities).map(([ingId, rounded]) => [ingId, rounded.kg])
        );
        const roundedActualNutrients = await solverService.calculateActualNutrients(
            roundedQuantitiesKg,
            ingredientsForSolver,
            effectiveWeightKg
        );

        let totalCostWithBags = 0;
        Object.keys(roundedQuantities).forEach((ingId) => {
            const solverIngredient = ingredientsForSolver.find((i) => i.id === ingId);
            if (solverIngredient) {
                totalCostWithBags += roundedQuantities[ingId].kg * solverIngredient.price;
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

        totalCostWithBags += Number(overheadCost);

        const recipeSnapshot = Object.keys(solverResult.ingredientQuantities).map((ingId) => {
            const ingredient = ingredients.find((i) => i._id.toString() === ingId);
            const rounded = roundedQuantities[ingId];
            const priceAtMoment = ingredientsForSolver.find((i) => i.id === ingId)?.price || 0;
            return {
                name: ingredient?.name || 'Unknown Ingredient',
                qtyKg: rounded.kg,
                bags: rounded.bags,
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
            effectiveWeightKg,
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
            costPerKg: totalCostWithBags / effectiveWeightKg,
            actualNutrients: roundedActualNutrients as unknown as Record<string, number>,
            recipe: [...recipeSnapshot, ...autoCalcRecipe],
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

export const calculateFormulation = async (req: Request, res: Response) => {
    try {
        const payload = coerceFormulationRequest(req.body);

        if (!payload.targetWeightKg || !payload.standardId || payload.selectedIngredients.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['targetWeightKg', 'standardId', 'selectedIngredients']
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
                    ingredientsUsed
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
        console.error('Error calculating formulation:', error);
        return res.status(500).json({
            error: 'Failed to calculate formulation',
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

        if (!baseRequest.targetWeightKg || !baseRequest.standardId || baseRequest.selectedIngredients.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['targetWeightKg', 'standardId', 'selectedIngredients']
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
            feedType: string;
            generatedAt: string;
        }>(cacheKey);
        if (cached) {
            return res.json({
                status: 'cached',
                cacheKey,
                ...cached
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
                estimatedCostDeltaPerKg: Number((alternativePrice - originalPrice).toFixed(3)),
                maxBlendPercent: rule.maxBlendPercent || 100,
                notes: rule.notes
            };
        });

        const responsePayload = {
            suggestions,
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

type StrategySnapshot = {
    strategy: string;
    totalCost: number;
    costPerKg: number;
    overheadCost?: number;
    complianceColor: 'Red' | 'Blue' | 'Green';
    qualityMatchPercentage: number;
    actualNutrients: Record<string, number>;
    ingredientsUsed: unknown[];
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
            ingredientsUsed: snapshot.ingredientsUsed || []
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
        ingredientsUsed: formulation.ingredientsUsed || []
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

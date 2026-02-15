// @ts-ignore - javascript-lp-solver doesn't have TypeScript types
import solver from 'javascript-lp-solver';
import { INutrients } from '../models/Ingredient';
import { configService } from './config.service';

export interface IngredientForSolver {
    id: string;
    name: string;
    price: number;  // ₦/kg
    nutrients: INutrients;
    constraints: {
        max_inclusion?: number;  // % max
        min_inclusion?: number;  // % min
    };
    bagWeight?: number | null;
    tags?: string[];
    alternatives?: string[];
}

export interface NutritionalTarget {
    protein: { min?: number; max?: number };
    fat: { min?: number; max?: number };
    carbohydrate?: { min?: number; max?: number };
    energy?: { min?: number; max?: number };
    fiber: { min?: number; max?: number };
    ash?: { min?: number; max?: number };
    lysine?: { min?: number; max?: number };
    methionine?: { min?: number; max?: number };
    calcium?: { min?: number; max?: number };
    phosphorous?: { min?: number; max?: number };
}

export enum FormulationStrategy {
    LEAST_COST = 'LEAST_COST',
    BALANCED = 'BALANCED',
    PREMIUM = 'PREMIUM'
}

export interface SolverInput {
    targetWeightKg: number;
    ingredients: IngredientForSolver[];
    nutritionalTarget: NutritionalTarget;
    tolerance?: number;  // % deviation allowed (default 2%)
    strategy?: FormulationStrategy;
    feedCategory?: 'Catfish' | 'Poultry';
    poultryType?: 'Broiler' | 'Layer';
}

export interface SolverOutput {
    strategy: FormulationStrategy;
    ingredientQuantities: Record<string, number>;  // { ingredientId: kg }
    totalCost: number;
    actualNutrients: INutrients;
    feasible: boolean;
    message?: string;
    infeasibility?: InfeasibilityAnalysis;
}

export interface ConstraintViolation {
    constraintId: string;
    type:
    | 'nutrient_min'
    | 'nutrient_max'
    | 'ingredient_data'
    | 'business_rule'
    | 'ingredient_limit';
    nutrient?: string;
    current: number;
    required: number;
    gap: number;
    unit: '%' | 'kcal/kg' | 'flag';
    message: string;
}

export interface RecommendedAction {
    actionType:
    | 'APPLY_SUGGESTED_RELAXATION'
    | 'TRY_ALTERNATIVE_INGREDIENTS'
    | 'ADJUST_QUANTITY_OR_TARGETS'
    | 'EDIT_INGREDIENT_LIMITS';
    label: string;
    description: string;
    patch: Record<string, unknown>;
    estimatedCostDelta: number;
    estimatedComplianceDelta: number;
    confidence: number;
}

export interface InfeasibilityAnalysis {
    summary: string;
    violations: ConstraintViolation[];
    recommendedActions: RecommendedAction[];
}

/**
 * Linear Programming Solver for Feed Formulation
 * Uses the Simplex Algorithm to find the cheapest ingredient combination
 */
export class FeedOptimizationService {

    /**
     * Optimize feed formulation to minimize cost while meeting nutritional requirements
     */
    async optimizeFormulation(input: SolverInput): Promise<SolverOutput> {
        const { targetWeightKg, ingredients, nutritionalTarget, feedCategory } = input;
        const strategy = input.strategy || FormulationStrategy.LEAST_COST;

        // Fetch dynamic configuration
        const configs = await configService.getAll();
        const maizeMult = configs.maize_preference_multiplier || 0.9999;
        const minAnimalProteinPct =
            configs.min_animal_protein_percent
            || configs.min_animal_protein_pct
            || 10;
        const bloodMealMaxRatio = configs.blood_meal_max_ratio || 10;

        let adjustedTolerance = input.tolerance || 2;

        // Strategy-specific adjustments
        let strategyHighProteinMin = 0;
        let strategyCheapMax = 100;

        if (strategy === FormulationStrategy.LEAST_COST) {
            adjustedTolerance = adjustedTolerance + 6;
            strategyCheapMax = 100;
        } else if (strategy === FormulationStrategy.BALANCED) {
            adjustedTolerance = adjustedTolerance + 4;
            strategyCheapMax = 80; // Relaxed from 60
            strategyHighProteinMin = 20;
        } else if (strategy === FormulationStrategy.PREMIUM) {
            adjustedTolerance = Math.max(1, adjustedTolerance);
            strategyCheapMax = 50; // Relaxed from 30
            strategyHighProteinMin = 40; // Relaxed from 50
        }

        const effectiveTarget = { ...nutritionalTarget };

        // Species checks
        const isCatfish = feedCategory === 'Catfish';
        const isPoultry = feedCategory === 'Poultry';
        if (isPoultry) {
            // Poultry specific logic can go here if needed
        }
        const requiresAnimalProtein = ingredients.some(i => i.tags?.includes('ANIMAL_PROTEIN')) || isCatfish;

        // Build the linear programming model
        const model: any = {
            optimize: 'cost',
            opType: 'min',
            constraints: {
                weight: { equal: targetWeightKg },
                strategy_high_protein: { min: (strategyHighProteinMin / 100) * targetWeightKg },
                strategy_cheap_max: { max: (strategyCheapMax / 100) * targetWeightKg },
                // NEW: Animal Protein requirement (for Catfish only)
                ...(isCatfish ? { total_animal_protein: { min: (minAnimalProteinPct / 100) * targetWeightKg } } : {}),
                // NEW: Blood Meal Limit (10% of total animal protein)
                ...(requiresAnimalProtein ? { blood_meal_ratio: { max: 0 } } : {})
            },
            variables: {},
            ints: {}
        };

        // Add nutritional constraints
        this.addNutritionalConstraints(model, effectiveTarget, targetWeightKg, adjustedTolerance);

        // Add each ingredient as a variable
        ingredients.forEach((ing: IngredientForSolver) => {
            const varName = ing.id;
            const isMaize = ing.name.toUpperCase().includes('MAIZE');
            const isBloodMeal = ing.name.toUpperCase().includes('BLOOD MEAL');
            const isAnimalProtein = ing.tags?.includes('ANIMAL_PROTEIN') || isBloodMeal;

            // Apply Maize Dominance penalty (slightly lower price for maize to favor it)
            const adjustedPrice = isMaize ? ing.price * maizeMult : ing.price;

            model.variables[varName] = {
                cost: adjustedPrice,
                weight: 1,
                strategy_high_protein: ing.nutrients.protein > 40 ? 1 : 0,
                strategy_cheap_max: ing.price < 300 ? 1 : 0,
                ...(isCatfish ? { total_animal_protein: isAnimalProtein ? 1 : 0 } : {}),
                ...(requiresAnimalProtein ? { blood_meal_ratio: isBloodMeal ? (1 - bloodMealMaxRatio / 100) : (isAnimalProtein ? (-bloodMealMaxRatio / 100) : 0) } : {})
            };

            // Add nutritional contributions
            const nutrients = ['protein', 'fat', 'carbohydrate', 'energy', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];
            nutrients.forEach(nutrient => {
                let val = (ing.nutrients as any)[nutrient];

                // Pct based nutrients need to be /100 for weight-based math
                if (nutrient !== 'energy') {
                    val = val / 100;
                }

                // NEW: Bioavailable Phosphorus Weighting
                if (nutrient === 'phosphorous') {
                    const bioa = ing.nutrients.phosphorusBioavailability ?? 1.0;
                    val = val * bioa;
                }

                model.variables[varName][`${nutrient}_min`] = val;
                model.variables[varName][`${nutrient}_max`] = val;
            });

            // Inclusion constraints
            if (ing.constraints.max_inclusion !== undefined) {
                const maxKg = (ing.constraints.max_inclusion / 100) * targetWeightKg;
                model.constraints[`${varName}_max`] = { max: maxKg };
                model.variables[varName][`${varName}_max`] = 1;
            }

            if (ing.constraints.min_inclusion !== undefined) {
                const minKg = (ing.constraints.min_inclusion / 100) * targetWeightKg;
                model.constraints[`${varName}_min`] = { min: minKg };
                model.variables[varName][`${varName}_min`] = 1;
            }
        });

        // Solve
        let result = solver.Solve(model);

        // Fallback Logic
        if (!result.feasible) {
            const fallbackModel: any = {
                optimize: 'cost',
                opType: 'min',
                constraints: { weight: { equal: targetWeightKg } },
                variables: model.variables,
                ints: model.ints
            };

            // Essentials: Protein, Fat, Energy
            const essentials = ['protein', 'fat', 'energy'];
            essentials.forEach(nutrient => {
                const targetRange = (effectiveTarget as any)[nutrient];
                if (targetRange && targetRange.min !== undefined) {
                    const minWithTol = targetRange.min * (1 - adjustedTolerance / 100);
                    fallbackModel.constraints[`${nutrient}_min`] = { min: (minWithTol / 100) * targetWeightKg };
                }
            });

            result = solver.Solve(fallbackModel);

            if (!result.feasible) {
                const infeasibility = await this.analyzeInfeasibility(
                    ingredients,
                    nutritionalTarget,
                    targetWeightKg,
                    isCatfish
                );
                return {
                    strategy,
                    ingredientQuantities: {},
                    totalCost: 0,
                    actualNutrients: this.createEmptyNutrients(),
                    feasible: false,
                    message: infeasibility.summary,
                    infeasibility
                };
            }
        }

        // Process results
        const quantities: Record<string, number> = {};
        ingredients.forEach(ing => {
            const qty = result[ing.id] || 0;
            if (qty > 0) quantities[ing.id] = qty;
        });

        let actualTotalCost = 0;
        Object.keys(quantities).forEach(ingId => {
            const originalIng = ingredients.find(i => i.id === ingId);
            if (originalIng) actualTotalCost += quantities[ingId] * originalIng.price;
        });

        const actualNutrients = await this.calculateActualNutrients(quantities, ingredients, targetWeightKg);

        return {
            strategy,
            ingredientQuantities: quantities,
            totalCost: actualTotalCost,
            actualNutrients,
            feasible: true,
            message: result.result === undefined ? 'Solution found using essential nutrients only.' : undefined
        };
    }

    private addNutritionalConstraints(model: any, target: NutritionalTarget, targetWeight: number, tolerance: number): void {
        const nutrients = ['protein', 'fat', 'carbohydrate', 'energy', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];

        nutrients.forEach(nutrient => {
            const targetRange = (target as any)[nutrient];
            if (!targetRange) return;

            const isEnergy = nutrient === 'energy';

            if (targetRange.min !== undefined) {
                // For energy, target is kcal/kg. minTotalEnergy = target * totalWeight
                // For others, target is %. minTotalKg = (target/100) * totalWeight
                const minVal = isEnergy
                    ? targetRange.min * (1 - tolerance / 100) * targetWeight
                    : (targetRange.min * (1 - tolerance / 100) / 100) * targetWeight;
                model.constraints[`${nutrient}_min`] = { min: minVal };
            }

            if (targetRange.max !== undefined) {
                const softNutrients = ['fiber', 'ash', 'calcium', 'phosphorous'];
                if (softNutrients.includes(nutrient)) return;

                const maxVal = isEnergy
                    ? targetRange.max * (1 + tolerance / 100) * targetWeight
                    : (targetRange.max * (1 + tolerance / 100) / 100) * targetWeight;
                model.constraints[`${nutrient}_max`] = { max: maxVal };
            }
        });
    }

    async calculateActualNutrients(quantities: Record<string, number>, ingredients: IngredientForSolver[], totalWeight: number): Promise<INutrients> {
        const configs = await configService.getAll();
        const m1 = configs.energy_protein_mult || 4;
        const m2 = configs.energy_carb_mult || 4;
        const m3 = configs.energy_fat_mult || 9;
        const m4 = configs.energy_global_mult || 10;

        const nutrients: any = {
            protein: 0, fat: 0, carbohydrate: 0, energy: 0, fiber: 0, ash: 0, lysine: 0, methionine: 0, calcium: 0, phosphorous: 0
        };

        Object.keys(nutrients).forEach(nutrient => {
            let totalKg = 0;
            ingredients.forEach(ing => {
                const qty = quantities[ing.id] || 0;
                let pct = (ing.nutrients as any)[nutrient] || 0;

                // Weight by Bioavailability for report
                if (nutrient === 'phosphorous') {
                    const bioa = ing.nutrients.phosphorusBioavailability ?? 1.0;
                    pct = pct * bioa;
                }

                if (nutrient === 'energy') {
                    totalKg += pct * qty; // qty is kg, pct is kcal/kg
                } else {
                    totalKg += (pct / 100) * qty;
                }
            });
            if (nutrient === 'energy') {
                nutrients[nutrient] = totalWeight > 0 ? totalKg / totalWeight : 0;
            } else {
                nutrients[nutrient] = totalWeight > 0 ? (totalKg / totalWeight) * 100 : 0;
            }
        });

        // Recalculate Energy based on ACHIEVED Protein, Carb, Fat
        nutrients.energy = ((nutrients.protein * m1) + (nutrients.carbohydrate * m2) + (nutrients.fat * m3)) * m4;

        return nutrients as INutrients;
    }

    /**
     * Round quantities to nearest bags for practical shopping
     */
    roundToBags(
        quantities: Record<string, number>,
        ingredients: IngredientForSolver[]
    ): Record<string, { kg: number; bags: number; excess: number }> {
        const result: any = {};

        Object.keys(quantities).forEach(ingId => {
            const qty = quantities[ingId];
            const ingredient = ingredients.find(i => i.id === ingId);

            if (!ingredient) {
                result[ingId] = { kg: qty, bags: 0, excess: 0 };
                return;
            }

            if (!ingredient.bagWeight) {
                // Sold loose
                result[ingId] = { kg: qty, bags: 0, excess: 0 };
            } else {
                // Round up to nearest bag
                const bags = Math.ceil(qty / ingredient.bagWeight);
                const actualKg = bags * ingredient.bagWeight;
                const excess = actualKg - qty;

                result[ingId] = { kg: actualKg, bags, excess };
            }
        });

        return result;
    }

    /**
     * Create empty nutrients object
     */
    private createEmptyNutrients(): INutrients {
        return {
            protein: 0,
            fat: 0,
            carbohydrate: 0,
            energy: 0,
            fiber: 0,
            ash: 0,
            lysine: 0,
            methionine: 0,
            calcium: 0,
            phosphorous: 0,
            phosphorusBioavailability: 1.0
        };
    }

    /**
     * Analyze why a formulation is infeasible and provide structured remediation options.
     */
    private analyzeInfeasibility(
        ingredients: IngredientForSolver[],
        target: NutritionalTarget,
        targetWeightKg: number,
        isCatfish: boolean
    ): Promise<InfeasibilityAnalysis> {
        return this.buildInfeasibilityAnalysis(
            ingredients,
            target,
            targetWeightKg,
            isCatfish
        );
    }

    private async buildInfeasibilityAnalysis(
        ingredients: IngredientForSolver[],
        target: NutritionalTarget,
        targetWeightKg: number,
        isCatfish: boolean
    ): Promise<InfeasibilityAnalysis> {
        const configs = await configService.getAll();
        const allowRelaxations = configs.suggestion_allow_relaxations !== false;
        const configuredStep = Number(configs.suggestion_max_relaxation_step_pct ?? 5);
        const maxRelaxationStep = Number.isFinite(configuredStep) && configuredStep > 0
            ? configuredStep
            : 5;
        const rankStrategy = String(configs.suggestion_rank_strategy || 'balanced')
            .toLowerCase();

        const violations: ConstraintViolation[] = [];
        const suggestions: string[] = [];
        const unitByNutrient: Record<string, '%' | 'kcal/kg'> = {
            protein: '%',
            fat: '%',
            carbohydrate: '%',
            energy: 'kcal/kg',
            fiber: '%',
            ash: '%',
            lysine: '%',
            methionine: '%',
            calcium: '%',
            phosphorous: '%'
        };
        const nutrientLabel: Record<string, string> = {
            protein: 'Protein',
            fat: 'Fat',
            carbohydrate: 'Carbohydrate',
            energy: 'Energy',
            fiber: 'Fiber',
            ash: 'Ash',
            lysine: 'Lysine',
            methionine: 'Methionine',
            calcium: 'Calcium',
            phosphorous: 'Phosphorous'
        };

        // Nutrient-based infeasibility checks
        const nutrients = Object.keys(unitByNutrient);
        nutrients.forEach((nutrient) => {
            const targetRange = (target as unknown as Record<string, { min?: number; max?: number } | undefined>)[nutrient];
            if (!targetRange) return;

            const values = ingredients.map(i => (i.nutrients as unknown as Record<string, number | undefined>)[nutrient] || 0);
            const bestValue = values.length > 0 ? Math.max(...values) : 0;
            const lowestValue = values.length > 0 ? Math.min(...values) : 0;

            if (targetRange.min !== undefined && bestValue < targetRange.min) {
                const gap = targetRange.min - bestValue;
                const message = `${nutrientLabel[nutrient]} minimum (${targetRange.min.toFixed(2)}${unitByNutrient[nutrient]}) is above the best selected ingredient (${bestValue.toFixed(2)}${unitByNutrient[nutrient]}).`;
                violations.push({
                    constraintId: `${nutrient}_min`,
                    type: 'nutrient_min',
                    nutrient,
                    current: Number(bestValue.toFixed(4)),
                    required: Number(targetRange.min.toFixed(4)),
                    gap: Number(gap.toFixed(4)),
                    unit: unitByNutrient[nutrient],
                    message
                });
                suggestions.push(message);
            }

            if (targetRange.max !== undefined && lowestValue > targetRange.max) {
                const gap = lowestValue - targetRange.max;
                const message = `${nutrientLabel[nutrient]} maximum (${targetRange.max.toFixed(2)}${unitByNutrient[nutrient]}) is below the lowest selected ingredient (${lowestValue.toFixed(2)}${unitByNutrient[nutrient]}).`;
                violations.push({
                    constraintId: `${nutrient}_max`,
                    type: 'nutrient_max',
                    nutrient,
                    current: Number(lowestValue.toFixed(4)),
                    required: Number(targetRange.max.toFixed(4)),
                    gap: Number(gap.toFixed(4)),
                    unit: unitByNutrient[nutrient],
                    message
                });
                suggestions.push(message);
            }
        });

        // 1. Check for ingredients with missing data
        const emptyIngredients = ingredients.filter(i =>
            i.nutrients.protein === 0 &&
            i.nutrients.energy === 0 &&
            i.nutrients.fat === 0
        );
        if (emptyIngredients.length > 0) {
            const message = `Some ingredients have no nutritional data: ${emptyIngredients.map(i => i.name).join(', ')}.`;
            violations.push({
                constraintId: 'ingredient_data_missing',
                type: 'ingredient_data',
                current: 0,
                required: 1,
                gap: 1,
                unit: 'flag',
                message
            });
            suggestions.push(`${message} Update the ingredient data or replace them.`);
        }

        // Catfish rule checks
        if (isCatfish) {
            const animalProteinCandidates = ingredients.filter(i => i.tags?.includes('ANIMAL_PROTEIN'));
            if (animalProteinCandidates.length === 0) {
                const message = 'Catfish feed requires at least one animal-protein ingredient.';
                violations.push({
                    constraintId: 'total_animal_protein',
                    type: 'business_rule',
                    current: 0,
                    required: 1,
                    gap: 1,
                    unit: 'flag',
                    message
                });
                suggestions.push(message);
            }

            const bloodMeal = ingredients.find(i => i.name.toUpperCase().includes('BLOOD MEAL'));
            const totalAnimalCandidates = Math.max(animalProteinCandidates.length, 1);
            if (bloodMeal && totalAnimalCandidates === 1) {
                const message = 'Blood meal cannot be the only animal-protein source due to digestibility constraints.';
                violations.push({
                    constraintId: 'blood_meal_ratio',
                    type: 'business_rule',
                    current: 100,
                    required: 10,
                    gap: 90,
                    unit: '%',
                    message
                });
                suggestions.push(message);
            }
        }

        // Hard ingredient inclusion limits can over-constrain.
        const tightLimits = ingredients.filter(i =>
            i.constraints.max_inclusion !== undefined &&
            i.constraints.max_inclusion <= 15
        );
        if (tightLimits.length > 0) {
            const message = `Tight max inclusion limits detected (${tightLimits.map(i => `${i.name}: ${i.constraints.max_inclusion}%`).join(', ')}).`;
            violations.push({
                constraintId: 'ingredient_limit_cluster',
                type: 'ingredient_limit',
                current: tightLimits.length,
                required: 0,
                gap: tightLimits.length,
                unit: 'flag',
                message
            });
            suggestions.push(`${message} Consider relaxing one or two limits.`);
        }

        // Variety Check
        if (ingredients.length < 5) {
            suggestions.push(`Using only ${ingredients.length} ingredients makes it hard to balance. Add at least 6-8 ingredients.`);
        }

        // Recommended actions (for one-tap buttons in client apps)
        const recommendedActions: RecommendedAction[] = [];
        const nutrientMinViolation = violations.find(v => v.type === 'nutrient_min');
        if (nutrientMinViolation && allowRelaxations) {
            const suggestedDelta = Math.max(0.2, nutrientMinViolation.gap * 0.35);
            const boundedDelta = Math.min(maxRelaxationStep, suggestedDelta);
            recommendedActions.push({
                actionType: 'APPLY_SUGGESTED_RELAXATION',
                label: 'Apply suggested relaxation',
                description: 'Loosen the tightest nutrient minimum slightly and rerun optimization.',
                patch: {
                    nutrient: nutrientMinViolation.nutrient,
                    operation: 'relax_min',
                    delta: Number(boundedDelta.toFixed(3))
                },
                estimatedCostDelta: Number((-Math.min(8, boundedDelta * 1.4)).toFixed(1)),
                estimatedComplianceDelta: Number(Math.min(18, nutrientMinViolation.gap * 4 + 2).toFixed(1)),
                confidence: Number(Math.max(0.55, Math.min(0.9, 0.65 + (boundedDelta / 20))).toFixed(2))
            });
        }

        if (ingredients.some(i => (i.alternatives || []).length > 0)) {
            const alternativesCount = ingredients.filter(i => (i.alternatives || []).length > 0).length;
            recommendedActions.push({
                actionType: 'TRY_ALTERNATIVE_INGREDIENTS',
                label: 'Try alternative ingredients',
                description: 'Swap one constrained ingredient with its mapped alternative and rerun.',
                patch: {
                    operation: 'try_alternatives',
                    ingredientIds: ingredients
                        .filter(i => (i.alternatives || []).length > 0)
                        .map(i => i.id)
                },
                estimatedCostDelta: Number((-Math.min(12, Math.max(2, alternativesCount * 1.8))).toFixed(1)),
                estimatedComplianceDelta: Number(Math.min(14, 3 + alternativesCount * 1.9).toFixed(1)),
                confidence: Number(Math.max(0.58, Math.min(0.88, 0.62 + (alternativesCount * 0.04))).toFixed(2))
            });
        }

        if (tightLimits.length > 0 && allowRelaxations) {
            const deltaPercent = Math.min(5, maxRelaxationStep);
            recommendedActions.push({
                actionType: 'EDIT_INGREDIENT_LIMITS',
                label: 'Edit ingredient limits',
                description: 'Increase one or more max inclusion caps and rerun.',
                patch: {
                    operation: 'relax_ingredient_max',
                    ingredientIds: tightLimits.map(i => i.id),
                    deltaPercent
                },
                estimatedCostDelta: Number(Math.min(4, tightLimits.length * 0.9).toFixed(1)),
                estimatedComplianceDelta: Number(Math.min(20, 6 + tightLimits.length * 2.4).toFixed(1)),
                confidence: Number(Math.max(0.56, Math.min(0.9, 0.66 + (tightLimits.length * 0.03))).toFixed(2))
            });
        }

        const targetAdjustmentStep = Math.min(2, maxRelaxationStep);
        recommendedActions.push({
            actionType: 'ADJUST_QUANTITY_OR_TARGETS',
            label: 'Adjust quantity/targets',
            description: 'Preview with a smaller batch or slightly easier nutrient target.',
            patch: {
                operation: 'adjust_target',
                targetWeightKg: Math.max(10, Number((targetWeightKg * 0.9).toFixed(1))),
                nutrientDeltaPct: Number(targetAdjustmentStep.toFixed(2))
            },
            estimatedCostDelta: Number((-Math.min(15, Math.max(3, targetWeightKg * 0.01))).toFixed(1)),
            estimatedComplianceDelta: Number(Math.min(8, 2 + targetAdjustmentStep * 1.5).toFixed(1)),
            confidence: 0.65
        });

        const rankedActions = recommendedActions.slice().sort((a, b) => {
            if (rankStrategy === 'cost_first') {
                if (a.estimatedCostDelta !== b.estimatedCostDelta) {
                    return a.estimatedCostDelta - b.estimatedCostDelta;
                }
                return b.estimatedComplianceDelta - a.estimatedComplianceDelta;
            }
            if (rankStrategy === 'compliance_first') {
                if (a.estimatedComplianceDelta !== b.estimatedComplianceDelta) {
                    return b.estimatedComplianceDelta - a.estimatedComplianceDelta;
                }
                return a.estimatedCostDelta - b.estimatedCostDelta;
            }

            const score = (item: RecommendedAction) => (
                (item.estimatedComplianceDelta * 0.6)
                + ((-item.estimatedCostDelta) * 0.3)
                + (item.confidence * 10 * 0.1)
            );
            return score(b) - score(a);
        });

        // Default fallback
        if (suggestions.length === 0) {
            suggestions.push(`The combination of selected ingredients cannot meet the nutritional standard.`);
            suggestions.push(`Try adding concentrated sources: FISHMEAL, SOYABEAN MEAL, BONE MEAL, and PALM OIL.`);
        }

        return {
            summary: suggestions.join(' '),
            violations,
            recommendedActions: rankedActions
        };
    }
}


export default new FeedOptimizationService();

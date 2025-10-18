// @ts-ignore - javascript-lp-solver doesn't have TypeScript types
import solver from 'javascript-lp-solver';
import { INutrients } from '../models/Ingredient';

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
}

export interface NutritionalTarget {
    protein: { min?: number; max?: number };
    fat: { min?: number; max?: number };
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
}

export interface SolverOutput {
    strategy: FormulationStrategy;
    ingredientQuantities: Record<string, number>;  // { ingredientId: kg }
    totalCost: number;
    actualNutrients: INutrients;
    feasible: boolean;
    message?: string;
}

/**
 * Linear Programming Solver for Feed Formulation
 * Uses the Simplex Algorithm to find the cheapest ingredient combination
 */
export class FeedOptimizationService {

    /**
     * Optimize feed formulation to minimize cost while meeting nutritional requirements
     */
    optimizeFormulation(input: SolverInput): SolverOutput {
        const { targetWeightKg, ingredients, nutritionalTarget } = input;
        const strategy = input.strategy || FormulationStrategy.LEAST_COST;

        // Strategy-specific adjustments
        // ECONOMY: Minimize cost, allow more tolerance (use cheap ingredients)
        // BALANCED: Moderate cost optimization with tighter tolerance
        // PREMIUM: Force high-quality protein sources

        let adjustedTolerance = input.tolerance || 2;

        // Track which ingredients to include/exclude or require minimum amounts
        let minHighProteinPct = 0;  // Minimum % from ingredients with protein > 40%
        let maxCheapPct = 100;      // Maximum % from cheap ingredients (< ₦300/kg)

        if (strategy === FormulationStrategy.LEAST_COST) {
            // Economy: LOOSEST tolerance, pure cost minimization
            // Allow more deviation from targets = can use cheaper ingredients
            adjustedTolerance = adjustedTolerance + 6; // 8% tolerance (loose)
            maxCheapPct = 100; // No limit on cheap ingredients
            minHighProteinPct = 0; // No requirement for expensive proteins
        } else if (strategy === FormulationStrategy.BALANCED) {
            // Balanced: moderate tolerance, some quality requirements
            adjustedTolerance = adjustedTolerance + 3; // 5% tolerance
            maxCheapPct = 60; // Max 60% from cheap ingredients
            minHighProteinPct = 20; // At least 20% from high-protein sources
        } else if (strategy === FormulationStrategy.PREMIUM) {
            // Premium: TIGHTEST tolerance, force expensive quality ingredients
            adjustedTolerance = Math.max(1, adjustedTolerance); // 2% tolerance (strictest)
            maxCheapPct = 30; // Max 30% from cheap ingredients
            minHighProteinPct = 50; // At least 50% from high-protein sources
        }

        const effectiveTarget = { ...nutritionalTarget };

        // Build the linear programming model
        const model: any = {
            optimize: 'cost',
            opType: 'min',
            constraints: {
                // Total weight constraint
                weight: { equal: targetWeightKg },
                // High-protein ingredient minimum (for quality)
                high_protein: { min: (minHighProteinPct / 100) * targetWeightKg },
                // Cheap ingredient maximum (to prevent all-cheap formulas in premium)
                cheap_max: { max: (maxCheapPct / 100) * targetWeightKg }
            },
            variables: {},
            ints: {}  // Integer programming for bag constraints
        };



        // Add nutritional constraints
        this.addNutritionalConstraints(model, effectiveTarget, targetWeightKg, adjustedTolerance);

        console.log('Effective target nutrients:', JSON.stringify(effectiveTarget, null, 2));
        console.log('Model after adding nutritional constraints:', JSON.stringify(model.constraints, null, 2));

        // Add each ingredient as a variable
        ingredients.forEach((ing: IngredientForSolver) => {
            const varName = ing.id;

            model.variables[varName] = {
                cost: ing.price,
                weight: 1,  // 1kg = 1kg
                // Mark if this is a high-protein ingredient (protein > 40%)
                high_protein: ing.nutrients.protein > 40 ? 1 : 0,
                // Mark if this is a cheap ingredient (price < ₦300/kg)
                cheap_max: ing.price < 300 ? 1 : 0
            };

            // Add nutritional contributions for each constraint
            const nutrients = ['protein', 'fat', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];
            nutrients.forEach(nutrient => {
                const val = (ing.nutrients as any)[nutrient] / 100;
                model.variables[varName][`${nutrient}_min`] = val;
                model.variables[varName][`${nutrient}_max`] = val;
            });

            // Add inclusion constraints (min/max %)
            if (ing.constraints.max_inclusion !== undefined) {
                const maxKg = (ing.constraints.max_inclusion / 100) * targetWeightKg;
                const constraintName = `${varName}_max`;
                model.constraints[constraintName] = { max: maxKg };
                model.variables[varName][constraintName] = 1;
            }

            if (ing.constraints.min_inclusion !== undefined) {
                const minKg = (ing.constraints.min_inclusion / 100) * targetWeightKg;
                const constraintName = `${varName}_min`;
                model.constraints[constraintName] = { min: minKg };
                model.variables[varName][constraintName] = 1;
            }
        });


        console.log('=== SOLVER DEBUG ===');
        console.log('Target weight:', targetWeightKg);
        console.log('Strategy:', strategy);
        console.log('Ingredients count:', ingredients.length);
        console.log('Model constraints:', JSON.stringify(model.constraints, null, 2));

        // Solve the linear programming problem
        let result = solver.Solve(model);

        console.log('Solver result feasible:', result.feasible);
        console.log('Solver result:', JSON.stringify(result, null, 2));

        // FALLBACK LOGIC: If full optimization fails, try "Essential Only" mode
        if (!result.feasible) {
            // Start fresh with only core constraints
            const fallbackModel: any = {
                optimize: 'cost',
                opType: 'min',
                constraints: {
                    weight: { equal: targetWeightKg }
                },
                variables: model.variables, // Reuse variables from original model
                ints: model.ints
            };

            // Add ONLY Protein and Fat (the essentials)
            const essentials = ['protein', 'fat'];
            const allNutrients = ['protein', 'fat', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];
            allNutrients.forEach(nutrient => {
                if (!essentials.includes(nutrient)) return;

                const targetRange = (effectiveTarget as any)[nutrient];
                if (!targetRange) return;

                if (targetRange.min !== undefined) {
                    const minWithTolerance = targetRange.min * (1 - adjustedTolerance / 100);
                    const minKg = (minWithTolerance / 100) * targetWeightKg;
                    fallbackModel.constraints[`${nutrient}_min`] = { min: minKg };
                }
                // No max constraints for essentials in fallback to maximize feasibility
            });

            // Re-add inclusion constraints (MAIZE max etc)
            ingredients.forEach(ing => {
                if (ing.constraints.max_inclusion !== undefined) {
                    const maxKg = (ing.constraints.max_inclusion / 100) * targetWeightKg;
                    const constraintName = `${ing.id}_max`;
                    fallbackModel.constraints[constraintName] = { max: maxKg };
                    fallbackModel.variables[ing.id][constraintName] = 1; // Ensure variable links to constraint
                }
                // Min inclusion constraints are generally harder to satisfy, so we omit them in fallback
            });

            result = solver.Solve(fallbackModel);

            if (!result.feasible) {
                // Analyze why it failed and provide helpful suggestions
                const suggestions = this.analyzeInfeasibility(ingredients, nutritionalTarget);

                return {
                    strategy,
                    ingredientQuantities: {},
                    totalCost: 0,
                    actualNutrients: this.createEmptyNutrients(),
                    feasible: false,
                    message: suggestions
                };
            }
        }

        // Extract ingredient quantities
        const quantities: Record<string, number> = {};
        ingredients.forEach(ing => {
            const qty = result[ing.id] || 0;
            if (qty > 0) {
                quantities[ing.id] = qty;
            }
        });

        // Calculate actual cost using ORIGINAL prices (not strategy-adjusted)
        let actualTotalCost = 0;
        Object.keys(quantities).forEach(ingId => {
            const originalIng = ingredients.find(i => i.id === ingId);
            if (originalIng) {
                actualTotalCost += quantities[ingId] * originalIng.price;
            }
        });

        // Calculate actual nutrients achieved
        const actualNutrients = this.calculateActualNutrients(quantities, ingredients, targetWeightKg);

        return {
            strategy,
            ingredientQuantities: quantities,
            totalCost: actualTotalCost,  // Use recalculated actual cost
            actualNutrients,
            feasible: true,
            message: result.result === undefined ? 'Solution found using essential nutrients only.' : undefined
        };
    }

    /**
     * Add nutritional constraints to the LP model
     */
    private addNutritionalConstraints(
        model: any,
        target: NutritionalTarget,
        targetWeight: number,
        tolerance: number
    ): void {
        const nutrients = ['protein', 'fat', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];

        console.log('=== addNutritionalConstraints DEBUG ===');
        console.log('Target object:', JSON.stringify(target));
        console.log('Tolerance:', tolerance);

        nutrients.forEach(nutrient => {
            const targetRange = (target as any)[nutrient];
            console.log(`Nutrient: ${nutrient}, Range:`, targetRange);

            if (!targetRange) {
                console.log(`  -> SKIPPED (no target range)`);
                return;
            }

            if (targetRange.min !== undefined) {
                // Minimum requirement with tolerance (in kg, not %)
                const minWithTolerance = targetRange.min * (1 - tolerance / 100);
                const minKg = (minWithTolerance / 100) * targetWeight;
                model.constraints[`${nutrient}_min`] = { min: minKg };
                console.log(`  -> Added ${nutrient}_min: ${minKg}`);
            }


            if (targetRange.max !== undefined) {
                // Determine if this is a "hard" constraint or a "soft" recommendation
                // We treat fiber, ash, calcium, and phosphorous as soft maximums to ensure feasibility
                const softNutrients = ['fiber', 'ash', 'calcium', 'phosphorous'];
                const isSoft = softNutrients.includes(nutrient);

                if (isSoft) {
                    // Skip binding maximum for soft nutrients in the solver
                    // They will still be flagged in the compliance report
                    return;
                }

                // Maximum allowance with tolerance (in kg, not %)
                // e.g. if target max is 1.5%, solver accepts 1.5 * (1 + 0.06) = 1.59%
                const maxWithTolerance = targetRange.max * (1 + tolerance / 100);
                const maxKg = (maxWithTolerance / 100) * targetWeight;
                model.constraints[`${nutrient}_max`] = { max: maxKg };
            }
        });
    }

    /**
     * Calculate actual nutrients achieved in the formulation
     */
    private calculateActualNutrients(
        quantities: Record<string, number>,
        ingredients: IngredientForSolver[],
        totalWeight: number
    ): INutrients {
        const nutrients: any = {
            protein: 0,
            fat: 0,
            fiber: 0,
            ash: 0,
            lysine: 0,
            methionine: 0,
            calcium: 0,
            phosphorous: 0
        };

        // Calculate weighted average
        Object.keys(nutrients).forEach(nutrient => {
            let totalNutrientKg = 0;

            ingredients.forEach(ing => {
                const qty = quantities[ing.id] || 0;
                const nutrientPercent = (ing.nutrients as any)[nutrient] || 0;
                const nutrientKg = (nutrientPercent / 100) * qty;
                totalNutrientKg += nutrientKg;
            });

            // Convert back to percentage
            nutrients[nutrient] = totalWeight > 0 ? (totalNutrientKg / totalWeight) * 100 : 0;
        });

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
            fiber: 0,
            ash: 0,
            lysine: 0,
            methionine: 0,
            calcium: 0,
            phosphorous: 0
        };
    }

    /**
     * Analyze why a formulation is infeasible and provide actionable suggestions
     */
    private analyzeInfeasibility(
        ingredients: IngredientForSolver[],
        target: NutritionalTarget
    ): string {
        const suggestions: string[] = [];

        // Calculate max achievable protein from selected ingredients
        const maxProtein = Math.max(...ingredients.map(i => i.nutrients.protein));
        const avgProtein = ingredients.reduce((sum, i) => sum + i.nutrients.protein, 0) / ingredients.length;

        // Check if protein target is achievable
        const proteinTarget = target.protein?.min || 0;
        if (proteinTarget > 0 && maxProtein < proteinTarget) {
            suggestions.push(`Need higher protein ingredients. Your highest is ${maxProtein}% but target needs ${proteinTarget}%. Add FISHMEAL or BLOOD MEAL.`);
        } else if (avgProtein < proteinTarget * 0.6) {
            suggestions.push(`Too few protein sources. Add more: FISHMEAL 65%, SOYABEAN MEAL, or BLOOD MEAL.`);
        }

        // Check fat sources
        const maxFat = Math.max(...ingredients.map(i => i.nutrients.fat));
        const fatTarget = target.fat?.min || 0;
        if (fatTarget > 0 && maxFat < fatTarget) {
            suggestions.push(`Need fat sources. Add PALM OIL or FISH OIL.`);
        }

        // Check amino acids
        const hasLysine = ingredients.some(i => i.nutrients.lysine > 2);
        const hasMethionine = ingredients.some(i => i.nutrients.methionine > 1);
        if (target.lysine?.min && !hasLysine) {
            suggestions.push(`Missing LYSINE source. Add LYSINE supplement or FISHMEAL.`);
        }
        if (target.methionine?.min && !hasMethionine) {
            suggestions.push(`Missing METHIONINE source. Add METHIONINE supplement.`);
        }

        // Check ingredient variety
        if (ingredients.length < 5) {
            suggestions.push(`Only ${ingredients.length} ingredients selected. Add at least 5-8 for a balanced formula.`);
        }

        // Default message if no specific issue found
        if (suggestions.length === 0) {
            suggestions.push(`The selected ingredients cannot meet the nutritional targets.`);
            suggestions.push(`Try adding: FISHMEAL 65%, SOYABEAN MEAL, MAIZE, PALM OIL, BONE MEAL, LYSINE, METHIONINE.`);
        }

        return suggestions.join(' ');
    }
}


export default new FeedOptimizationService();

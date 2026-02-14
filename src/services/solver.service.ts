// @ts-ignore - javascript-lp-solver doesn't have TypeScript types
import solver from 'javascript-lp-solver';
import { INutrients, IIngredient } from '../models/Ingredient';
import { configService } from './config.service';

export interface IngredientForSolver extends Partial<IIngredient> {
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
        const minAnimalProteinPct = configs.min_animal_protein_percent || 10;
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
                return {
                    strategy,
                    ingredientQuantities: {},
                    totalCost: 0,
                    actualNutrients: this.createEmptyNutrients(),
                    feasible: false,
                    message: this.analyzeInfeasibility(ingredients, nutritionalTarget)
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

    private async calculateActualNutrients(quantities: Record<string, number>, ingredients: IngredientForSolver[], totalWeight: number): Promise<INutrients> {
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
     * Analyze why a formulation is infeasible and provide actionable suggestions
     */
    private analyzeInfeasibility(
        ingredients: IngredientForSolver[],
        target: NutritionalTarget
    ): string {
        const suggestions: string[] = [];

        // 1. Check for ingredients with missing data
        const emptyIngredients = ingredients.filter(i =>
            i.nutrients.protein === 0 &&
            i.nutrients.energy === 0 &&
            i.nutrients.fat === 0
        );
        if (emptyIngredients.length > 0) {
            suggestions.push(`Some ingredients have no nutritional data: ${emptyIngredients.map(i => i.name).join(', ')}. Please update them in the database or select different ones.`);
        }

        // 2. Protein Check
        const maxProtein = Math.max(0, ...ingredients.map(i => i.nutrients.protein));
        const proteinTarget = target.protein?.min || 0;
        if (proteinTarget > 0 && maxProtein < proteinTarget) {
            const hasProteinSource = ingredients.some(i => i.name.includes('FISH') || i.name.includes('SOYA'));
            if (hasProteinSource && maxProtein < 10) {
                suggestions.push(`Goal Protein (${proteinTarget}%) is not met because your protein sources (FISHMEAL/SOYA) have 0 or very low protein in the system. Please check ingredient data.`);
            } else {
                suggestions.push(`Goal Protein (${proteinTarget}%) is higher than your best source (${maxProtein}%). Add FISHMEAL or SOYABEAN MEAL.`);
            }
        }

        // 3. Energy Check
        const maxEnergy = Math.max(0, ...ingredients.map(i => i.nutrients.energy));
        const energyTarget = target.energy?.min || 0;
        if (energyTarget > 0 && maxEnergy < energyTarget) {
            const hasEnergySource = ingredients.some(i => i.name.includes('MAIZE') || i.name.includes('PALM OIL'));
            if (hasEnergySource && maxEnergy < 100) {
                suggestions.push(`Goal Energy (${energyTarget} kcal/kg) is not met because your energy sources (MAIZE/PALM OIL) have 0 energy in the system. Please check ingredient data.`);
            } else {
                suggestions.push(`Goal Energy (${energyTarget} kcal/kg) is higher than your best source (${maxEnergy} kcal/kg). Add PALM OIL or MAIZE.`);
            }
        }

        // 4. Calcium & Phosphorus Check
        const maxCalcium = Math.max(0, ...ingredients.map(i => i.nutrients.calcium));
        const calciumTarget = target.calcium?.min || 0;
        if (calciumTarget > 0 && maxCalcium < calciumTarget) {
            suggestions.push(`Calcium target (${calciumTarget}%) is too high for your current ingredients. Add LIMESTONE, OYSTER SHELL or BONE MEAL.`);
        }

        const maxPhosphorus = Math.max(0, ...ingredients.map(i => i.nutrients.phosphorous));
        const phosphorusTarget = target.phosphorous?.min || 0;
        if (phosphorusTarget > 0 && maxPhosphorus < phosphorusTarget) {
            suggestions.push(`Phosphorus target (${phosphorusTarget}%) is too high. Add DICALCIUM PHOSPHATE or BONE MEAL.`);
        }

        // 5. Fiber (Maximum) Check
        const minFiber = Math.min(100, ...ingredients.map(i => i.nutrients.fiber));
        const fiberMax = target.fiber?.max ?? 100;
        if (minFiber > fiberMax) {
            suggestions.push(`Fiber limit (${fiberMax}%) is too strict for your ingredients. Your lowest fiber source is ${minFiber}%. Remove high-fiber hulls or offals.`);
        }

        // 6. Amino Acids
        const hasLysine = ingredients.some(i => i.nutrients.lysine > 2);
        const hasMethionine = ingredients.some(i => i.nutrients.methionine > 1);
        if (target.lysine?.min && !hasLysine) {
            suggestions.push(`Missing concentrated LYSINE source. Add LYSINE supplement.`);
        }
        if (target.methionine?.min && !hasMethionine) {
            suggestions.push(`Missing concentrated METHIONINE source. Add METHIONINE supplement.`);
        }

        // Variety Check
        if (ingredients.length < 5) {
            suggestions.push(`Using only ${ingredients.length} ingredients makes it hard to balance. Add at least 6-8 ingredients.`);
        }

        // Default fallback
        if (suggestions.length === 0) {
            suggestions.push(`The combination of selected ingredients cannot meet the nutritional standard.`);
            suggestions.push(`Try adding concentrated sources: FISHMEAL, SOYABEAN MEAL, BONE MEAL, and PALM OIL.`);
        }

        return suggestions.join(' ');
    }
}


export default new FeedOptimizationService();

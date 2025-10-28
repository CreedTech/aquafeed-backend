import { Request, Response } from 'express';
import Ingredient from '../../models/Ingredient';
import FeedStandard from '../../models/FeedStandard';
import Formulation from '../../models/Formulation';
import User from '../../models/User';
import solverService, { FormulationStrategy } from '../../services/solver.service';
import complianceService from '../../services/compliance.service';

/**
 * Calculate Feed Formulation (The "Joggler")
 * POST /api/v1/formulations/calculate
 * 
 * Access Control:
 * - Users get 1 FREE trial formula
 * - After that, must pay ₦10,000 for full access
 * - Admins have unlimited access
 */
export const calculateFormulation = async (req: Request, res: Response) => {
    try {
        const {
            targetWeightKg,
            standardId,
            selectedIngredients,  // [{ ingredientId, customPrice?, volumeLiters? }]
            batchName,
            overheadCost = 0  // Milling, processing, pelletizing, transport
        } = req.body;

        // Validation
        if (!targetWeightKg || !standardId || !selectedIngredients) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['targetWeightKg', 'standardId', 'selectedIngredients']
            });
        }

        // Demo Mode Logic: Force 2kg for free/authenticated users who haven't paid for full access
        let effectiveWeightKg = Number(targetWeightKg);
        let isDemo = false;

        // Check user access (authenticated)
        const userId = (req as any).session?.userId;
        const user = await User.findById(userId);

        // If not admin and not paid for full access, force demo mode
        if (user && user.role !== 'admin' && !user.hasFullAccess) {
            if (effectiveWeightKg > 5) {
                effectiveWeightKg = 5;
                isDemo = true;
            }
        }

        // Get the feed standard
        const standard = await FeedStandard.findById(standardId);
        if (!standard) {
            return res.status(404).json({ error: 'Feed standard not found' });
        }

        // Get ingredient details
        const ingredientIds = selectedIngredients.map((ing: any) => ing.ingredientId);
        const ingredients = await Ingredient.find({
            _id: { $in: ingredientIds },
            isActive: true
        });

        if (ingredients.length === 0) {
            return res.status(400).json({ error: 'No valid ingredients selected' });
        }

        // Prepare ingredients for solver with user prices
        // Note: Auto-calculated ingredients (like Vitamin C) are handled separately
        const ingredientsForSolver = ingredients
            .filter(ing => !ing.isAutoCalculated)  // Skip auto-calculated ingredients
            .map(ing => {
                const selectedIng = selectedIngredients.find(
                    (s: any) => s.ingredientId === ing._id.toString()
                );

                // Price priority: customPrice from user > defaultPrice from database
                const price = selectedIng?.customPrice ?? ing.defaultPrice ?? 0;

                // Note: For liquids with specificGravity (e.g., Palm Oil 0.91),
                // users can provide volumeLiters and we convert: kg = liters * specificGravity
                // This is available via ing.specificGravity for display/conversion purposes

                return {
                    id: ing._id.toString(),
                    name: ing.name,
                    price: price,
                    nutrients: ing.nutrients,
                    constraints: ing.constraints,
                    bagWeight: ing.bagWeight,
                    specificGravity: ing.specificGravity  // For reference
                };
            });

        // Get auto-calculated ingredients (like Vitamin C at 400mg/kg)
        const autoCalculatedIngredients = ingredients.filter(ing => ing.isAutoCalculated && ing.autoCalcRatio);

        console.log('Ingredients for solver:', ingredientsForSolver.map(i => ({ name: i.name, price: i.price })));
        if (autoCalculatedIngredients.length > 0) {
            console.log('Auto-calculated ingredients:', autoCalculatedIngredients.map(i => ({ name: i.name, ratio: i.autoCalcRatio })));
        }

        // Run multi-strategy solver
        const strategies = [
            FormulationStrategy.LEAST_COST,
            FormulationStrategy.BALANCED,
            FormulationStrategy.PREMIUM
        ];

        console.log('=== CONTROLLER DEBUG ===');
        console.log('Standard name:', standard.name);
        console.log('Standard tolerance:', standard.tolerance);
        console.log('Standard targetNutrients:', JSON.stringify(standard.targetNutrients, null, 2));

        // CRITICAL: Convert Mongoose subdocument to plain object
        // Mongoose wraps subdocuments in a special object where actual data is in _doc
        const rawTarget = standard.targetNutrients as any;
        const targetNutrients = rawTarget.toObject
            ? rawTarget.toObject()
            : rawTarget._doc || rawTarget;

        console.log('Plain targetNutrients:', JSON.stringify(targetNutrients, null, 2));

        const options = strategies.map(strategy => {
            const solverResult = solverService.optimizeFormulation({
                targetWeightKg: effectiveWeightKg,
                ingredients: ingredientsForSolver,
                nutritionalTarget: targetNutrients,
                tolerance: standard.tolerance,
                strategy
            });

            if (!solverResult.feasible) return { strategy, feasible: false, message: solverResult.message };

            // Round to bags for practical shopping
            const roundedQuantities = solverService.roundToBags(
                solverResult.ingredientQuantities,
                ingredientsForSolver
            );

            // Calculate total cost with bags
            let totalCostWithBags = 0;
            Object.keys(roundedQuantities).forEach(ingId => {
                const ing = ingredientsForSolver.find(i => i.id === ingId);
                if (ing) {
                    totalCostWithBags += roundedQuantities[ingId].kg * ing.price;
                }
            });

            // Add auto-calculated ingredients (like Vitamin C at 400mg/kg)
            let autoCalcRecipe: any[] = [];
            autoCalculatedIngredients.forEach(autoIng => {
                const qty = effectiveWeightKg * (autoIng.autoCalcRatio || 0); // e.g., 274kg * 0.0004 = 0.1096kg
                const price = autoIng.defaultPrice || 0;
                const cost = qty * price;
                totalCostWithBags += cost;
                autoCalcRecipe.push({
                    name: autoIng.name,
                    qtyKg: qty,
                    bags: 0,  // Auto-calc ingredients don't come in bags
                    priceAtMoment: price,
                    isAutoCalculated: true
                });
            });

            // Add overhead costs (milling, processing, transport)
            totalCostWithBags += Number(overheadCost);

            // Check compliance against standard
            const complianceResult = complianceService.checkCompliance(
                solverResult.actualNutrients,
                standard.targetNutrients,
                standard.tolerance
            );

            // [IP PROTECTION] We return the recipe here for the ephemeral preview, 
            // but we won't persist it to the DB in this call.
            const recipeSnapshot = Object.keys(solverResult.ingredientQuantities).map(ingId => {
                const ing = ingredients.find(i => i._id.toString() === ingId)!;
                const rounded = roundedQuantities[ingId];
                return {
                    name: ing.name,
                    qtyKg: rounded.kg,
                    bags: rounded.bags,
                    priceAtMoment: ingredientsForSolver.find(i => i.id === ingId)!.price
                };
            });

            return {
                strategy,
                feasible: true,
                complianceColor: complianceResult.color,
                qualityMatch: complianceResult.qualityMatch,
                nutrientStatuses: complianceResult.deviations, // Per-nutrient comparison
                totalCost: totalCostWithBags,
                costPerKg: totalCostWithBags / effectiveWeightKg,
                actualNutrients: solverResult.actualNutrients,
                recipe: [...recipeSnapshot, ...autoCalcRecipe], // Include auto-calculated ingredients
                overheadCost: Number(overheadCost) // Return for transparency
            };
        });

        // Filter out infeasible options
        const feasibleOptions = options.filter(o => o.feasible);

        if (feasibleOptions.length === 0) {
            // Get the suggestion from any of the infeasible results
            const suggestion = options.find(o => o.message)?.message ||
                'Try selecting more ingredients with higher protein (FISHMEAL, SOYABEAN MEAL) and energy sources (MAIZE, PALM OIL).';

            return res.json({
                status: 'infeasible',
                error: 'Cannot create a balanced formulation',
                message: 'The selected ingredients cannot meet the nutritional targets.',
                suggestion: suggestion
            });
        }

        // All calculations are now associated with a user (No Guest policy)
        const summary = new Formulation({
            userId,
            farmId: req.body.farmId,
            batchName: batchName || `Mix Search ${new Date().toLocaleDateString()}`,
            targetWeightKg: effectiveWeightKg,
            standardUsed: standard._id,
            totalCost: feasibleOptions[0].totalCost, // Use the first one as a reference
            costPerKg: feasibleOptions[0].costPerKg,
            complianceColor: feasibleOptions[0].complianceColor,
            qualityMatchPercentage: feasibleOptions[0].qualityMatch,
            actualNutrients: feasibleOptions[0].actualNutrients,
            isDemo,
            ingredientsUsed: (feasibleOptions[0] as any).recipe.map((r: any) => ({
                ...r,
                ingredientId: ingredients.find(i => i.name === r.name)?._id,
                nutrientsAtMoment: ingredients.find(i => i.name === r.name)?.nutrients
            })),
            isUnlocked: false
        });
        await summary.save();
        const formulationId = summary._id.toString();

        // Update user formula count and mark free trial as used
        await User.findByIdAndUpdate(userId, {
            $inc: { formulaCount: 1 },
            $set: { freeTrialUsed: true }
        });

        const responseOptions = isDemo
            ? feasibleOptions.map((o: any) => ({
                ...o,
                totalCost: 0,
                costPerKg: 0,
                actualNutrients: {},
                recipe: o.recipe.map((r: any) => ({
                    ...r,
                    qtyKg: 0,
                    bags: 0,
                    priceAtMoment: 0
                }))
            }))
            : feasibleOptions;

        res.json({
            formulationId,
            options: responseOptions,
            isDemo,
            effectiveWeightKg,
            message: isDemo
                ? 'Demo Mode: Results capped at 5kg. Unlock for full production weights.'
                : 'Multi-strategy formulations calculated. Compare and unlock your preferred mix.'
        });

    } catch (error) {
        console.error('Error calculating formulation:', error);
        res.status(500).json({
            error: 'Failed to calculate formulation',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Unlock Formulation (Pay to see full recipe)
 * POST /api/v1/formulations/:id/unlock
 */
export const unlockFormulation = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = (req as any).session?.userId;

        const formulation = await Formulation.findById(id);
        if (!formulation) {
            return res.status(404).json({ error: 'Formulation not found' });
        }

        if (formulation.userId.toString() !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        if (formulation.isUnlocked) {
            return res.status(400).json({ error: 'Formulation already unlocked' });
        }

        // Check wallet balance
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const UNLOCK_FEE = 10000;
        if (user.walletBalance < UNLOCK_FEE) {
            return res.status(403).json({
                error: 'Insufficient balance',
                message: `You need ₦${UNLOCK_FEE.toLocaleString()} to unlock this formulation. Your current balance is ₦${user.walletBalance.toLocaleString()}.`,
                requiresDeposit: true,
                requiredAmount: UNLOCK_FEE - user.walletBalance
            });
        }

        // Deduct balance
        user.walletBalance -= UNLOCK_FEE;
        await user.save();

        // Unlock formulation
        formulation.isUnlocked = true;
        formulation.unlockedAt = new Date();
        await formulation.save();

        res.json({
            message: 'Formulation unlocked successfully',
            newBalance: user.walletBalance,
            formulation: {
                _id: formulation._id,
                ingredientsUsed: formulation.ingredientsUsed,
                totalCost: formulation.totalCost,
                costPerKg: formulation.costPerKg,
                complianceColor: formulation.complianceColor,
                actualNutrients: formulation.actualNutrients
            }
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
        const userId = (req as any).session?.userId;
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

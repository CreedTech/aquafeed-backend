import { Request, Response } from 'express';
import Ingredient from '../../models/Ingredient';

/**
 * Get all ingredients
 * GET /api/v1/ingredients
 */
export const getIngredients = async (req: Request, res: Response) => {
    try {
        const { category, search, active = 'true' } = req.query;

        const query: any = {};

        if (category) {
            query.category = category;
        }

        if (active) {
            query.isActive = active === 'true';
        }

        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const ingredients = await Ingredient.find(query)
            .populate('alternatives', 'name defaultPrice')
            .sort({ category: 1, name: 1 });

        res.json({
            count: ingredients.length,
            ingredients
        });

    } catch (error) {
        console.error('Error fetching ingredients:', error);
        res.status(500).json({
            error: 'Failed to fetch ingredients',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get single ingredient
 * GET /api/v1/ingredients/:id
 */
export const getIngredientById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const ingredient = await Ingredient.findById(id)
            .populate('alternatives', 'name defaultPrice nutrients');

        if (!ingredient) {
            return res.status(404).json({ error: 'Ingredient not found' });
        }

        res.json({ ingredient });

    } catch (error) {
        console.error('Error fetching ingredient:', error);
        res.status(500).json({
            error: 'Failed to fetch ingredient',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get ingredients by category
 * GET /api/v1/ingredients/category/:category
 */
export const getIngredientsByCategory = async (req: Request, res: Response) => {
    try {
        const { category } = req.params;

        const ingredients = await Ingredient.find({
            category: category.toUpperCase(),
            isActive: true
        }).sort({ name: 1 });

        res.json({
            category,
            count: ingredients.length,
            ingredients
        });

    } catch (error) {
        console.error('Error fetching ingredients by category:', error);
        res.status(500).json({
            error: 'Failed to fetch ingredients',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

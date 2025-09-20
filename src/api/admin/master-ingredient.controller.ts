import { Request, Response } from 'express';
import Ingredient from '../../models/Ingredient';

/**
 * Create a global master ingredient
 */
export const createIngredient = async (req: Request, res: Response) => {
    try {
        // We can just use the Model.create directly, validation handled by Schema
        const ingredient = await Ingredient.create(req.body);
        res.status(201).json({ message: 'Ingredient created', ingredient });
    } catch (error: any) {
        console.error('Create Ingredient Error:', error);
        // Handle duplicate name error
        if (error.code === 11000) {
            res.status(400).json({ error: 'Ingredient with this name already exists' });
            return;
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update ingredient details (prices, nutrition)
 */
export const updateIngredient = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const ingredient = await Ingredient.findByIdAndUpdate(id, req.body, { new: true });

        if (!ingredient) {
            res.status(404).json({ error: 'Ingredient not found' });
            return;
        }

        res.json({ message: 'Ingredient updated', ingredient });

    } catch (error) {
        console.error('Update Ingredient Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Soft delete ingredient (or hard delete if unused)
 * For now, we'll just delete it. In a real app, you'd check dependencies.
 */
export const deleteIngredient = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Check usage in formulations or inventory? 
        // For simplicity in this phase, we allow deletion.
        const ingredient = await Ingredient.findByIdAndDelete(id);

        if (!ingredient) {
            res.status(404).json({ error: 'Ingredient not found' });
            return;
        }

        res.json({ message: 'Ingredient deleted successfully' });

    } catch (error) {
        console.error('Delete Ingredient Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

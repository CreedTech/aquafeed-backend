import { Request, Response } from 'express';
import Category from '../../models/Category';

/**
 * Get all categories (optionally filter by type)
 */
export const getCategories = async (req: Request, res: Response) => {
    try {
        const { type } = req.query;
        const query: any = { isActive: true };
        if (type) query.type = type;

        const categories = await Category.find(query).sort({ sortOrder: 1, name: 1 });
        res.json({ categories });
    } catch (error) {
        console.error('Get Categories Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Get all categories for admin (including inactive)
 */
export const getAllCategories = async (req: Request, res: Response) => {
    try {
        const { type } = req.query;
        const query: any = {};
        if (type) query.type = type;

        const categories = await Category.find(query).sort({ type: 1, sortOrder: 1 });
        res.json({ categories });
    } catch (error) {
        console.error('Get All Categories Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Create category
 */
export const createCategory = async (req: Request, res: Response) => {
    try {
        const category = await Category.create(req.body);
        res.status(201).json({ message: 'Category created', category });
    } catch (error: any) {
        if (error.code === 11000) {
            res.status(400).json({ error: 'Category with this name already exists for this type' });
            return;
        }
        console.error('Create Category Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Update category
 */
export const updateCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const category = await Category.findByIdAndUpdate(id, req.body, { new: true });

        if (!category) {
            res.status(404).json({ error: 'Category not found' });
            return;
        }

        res.json({ message: 'Category updated', category });
    } catch (error) {
        console.error('Update Category Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Delete category
 */
export const deleteCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const category = await Category.findByIdAndDelete(id);

        if (!category) {
            res.status(404).json({ error: 'Category not found' });
            return;
        }

        res.json({ message: 'Category deleted' });
    } catch (error) {
        console.error('Delete Category Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

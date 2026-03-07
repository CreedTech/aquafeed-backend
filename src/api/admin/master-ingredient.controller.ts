import { Request, Response } from 'express';
import Ingredient from '../../models/Ingredient';
import Category from '../../models/Category';

const parseBooleanQuery = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sortFieldMap: Record<string, string> = {
    name: 'name',
    category: 'category',
    price: 'defaultPrice',
    protein: 'nutrients.protein',
    dataQuality: 'dataQuality',
    status: 'isActive',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};

type SortSpec = Record<string, 1 | -1>;

const normalizeSortDirection = (raw: unknown): 1 | -1 => {
    const normalized = String(raw || '').toLowerCase();
    return normalized === 'desc' ? -1 : 1;
};

const getSort = (sortKey: unknown, sortDirection: unknown) => {
    const field = sortFieldMap[String(sortKey || '')] || 'name';
    const dir = normalizeSortDirection(sortDirection);
    return { [field]: dir, name: 1 } as SortSpec;
};

const normalizeCategory = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim().toUpperCase();
    return normalized.length > 0 ? normalized : undefined;
};

const ensureValidIngredientCategory = async (category: string | undefined) => {
    if (!category) return true;
    const configuredCount = await Category.countDocuments({ type: 'ingredient' });
    if (configuredCount === 0) {
        // Backward compatibility for environments that have not seeded categories yet.
        return true;
    }
    const existing = await Category.findOne({
        type: 'ingredient',
        name: category
    }).lean();
    return !!existing;
};

/**
 * Create a global master ingredient
 */
export const createIngredient = async (req: Request, res: Response) => {
    try {
        const category = normalizeCategory(req.body?.category);
        if (!category) {
            return res.status(400).json({ error: 'Category is required' });
        }

        const categoryExists = await ensureValidIngredientCategory(category);
        if (!categoryExists) {
            return res.status(400).json({
                error: 'Invalid category',
                message: `Category '${category}' is not configured in admin categories`
            });
        }

        const payload = {
            ...req.body,
            category
        };

        // We can just use the Model.create directly, validation handled by Schema
        const ingredient = await Ingredient.create(payload);
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
        const payload = { ...req.body } as Record<string, unknown>;
        if (payload.category !== undefined) {
            const normalizedCategory = normalizeCategory(payload.category);
            if (!normalizedCategory) {
                return res.status(400).json({ error: 'Invalid category' });
            }

            const categoryExists = await ensureValidIngredientCategory(normalizedCategory);
            if (!categoryExists) {
                return res.status(400).json({
                    error: 'Invalid category',
                    message: `Category '${normalizedCategory}' is not configured in admin categories`
                });
            }
            payload.category = normalizedCategory;
        }

        const ingredient = await Ingredient.findByIdAndUpdate(id, payload, { new: true });

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

/**
 * Get all ingredients
 */
export const getAllIngredients = async (req: Request, res: Response) => {
    try {
        const query: Record<string, unknown> = {};
        const category = normalizeCategory(req.query.category);
        const dataQuality = req.query.dataQuality ? String(req.query.dataQuality).trim().toLowerCase() : '';
        const active = parseBooleanQuery(req.query.active);
        const search = req.query.search ? String(req.query.search).trim() : '';

        if (category) query.category = category;
        if (dataQuality && ['verified', 'flagged'].includes(dataQuality)) {
            query.dataQuality = dataQuality;
        }
        if (active !== undefined) query.isActive = active;
        if (search) {
            const pattern = escapeRegex(search);
            query.$or = [
                { name: { $regex: pattern, $options: 'i' } },
                { category: { $regex: pattern, $options: 'i' } },
                { aliases: { $regex: pattern, $options: 'i' } }
            ];
        }

        const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
        const page = clamp(parseInt(String(req.query.page || '1'), 10) || 1, 1, 100000);
        const limit = clamp(parseInt(String(req.query.limit || '20'), 10) || 20, 1, 200);
        const skip = (page - 1) * limit;
        const sort = getSort(req.query.sortKey, req.query.sortDirection);

        const [ingredients, filteredTotal, total, activeTotal, categoryCounts, activeCategoryCounts] = await Promise.all([
            Ingredient.find(query)
                .sort(sort)
                .skip(hasPagination ? skip : 0)
                .limit(hasPagination ? limit : 0),
            Ingredient.countDocuments(query),
            Ingredient.countDocuments({}),
            Ingredient.countDocuments({ isActive: true }),
            Ingredient.aggregate([
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Ingredient.aggregate([
                { $match: { isActive: true } },
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ])
        ]);

        const categories = categoryCounts
            .filter((row) => row?._id)
            .map((row) => String(row._id));

        const byCategory = categoryCounts.reduce<Record<string, number>>((acc, row) => {
            if (!row?._id) return acc;
            acc[String(row._id)] = Number(row.count || 0);
            return acc;
        }, {});

        const byCategoryActive = activeCategoryCounts.reduce<Record<string, number>>((acc, row) => {
            if (!row?._id) return acc;
            acc[String(row._id)] = Number(row.count || 0);
            return acc;
        }, {});

        const payload: Record<string, unknown> = {
            ingredients,
            count: ingredients.length,
            filteredTotal,
            summary: {
                total,
                active: activeTotal,
                inactive: total - activeTotal,
                byCategory,
                byCategoryActive
            },
            filterOptions: {
                categories
            }
        };

        if (hasPagination) {
            payload.meta = {
                page,
                limit,
                total: filteredTotal,
                pages: Math.max(1, Math.ceil(filteredTotal / limit)),
                hasNext: skip + ingredients.length < filteredTotal,
                hasPrev: page > 1
            };
        }

        res.json(payload);
    } catch (error) {
        console.error('Get All Ingredients Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

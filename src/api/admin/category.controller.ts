import { Request, Response } from 'express';
import Category from '../../models/Category';

const parseBooleanQuery = (value: unknown): boolean | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeSortDirection = (raw: unknown): 1 | -1 => {
    const normalized = String(raw || '').toLowerCase();
    return normalized === 'desc' ? -1 : 1;
};

const buildCategoryQuery = (params: {
    type?: unknown;
    active?: unknown;
    search?: unknown;
    forceActive?: boolean;
}) => {
    const query: Record<string, unknown> = {};

    if (params.forceActive) {
        query.isActive = true;
    } else {
        const active = parseBooleanQuery(params.active);
        if (active !== undefined) query.isActive = active;
    }

    if (params.type) {
        query.type = String(params.type).trim().toLowerCase();
    }

    if (params.search) {
        const pattern = escapeRegex(String(params.search).trim());
        if (pattern) {
            query.$or = [
                { name: { $regex: pattern, $options: 'i' } },
                { displayName: { $regex: pattern, $options: 'i' } },
                { description: { $regex: pattern, $options: 'i' } }
            ];
        }
    }

    return query;
};

const sortFieldMap: Record<string, string> = {
    name: 'name',
    displayName: 'displayName',
    type: 'type',
    sortOrder: 'sortOrder',
    status: 'isActive',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
};

type SortSpec = Record<string, 1 | -1>;

const getSort = (sortKey: unknown, sortDirection: unknown) => {
    const resolvedField = sortFieldMap[String(sortKey || '')] || 'sortOrder';
    const direction = normalizeSortDirection(sortDirection);

    if (resolvedField === 'sortOrder') {
        return { type: 1, sortOrder: direction, name: 1 } as SortSpec;
    }

    return { [resolvedField]: direction, name: 1 } as SortSpec;
};

/**
 * Get all categories (optionally filter by type)
 */
export const getCategories = async (req: Request, res: Response) => {
    try {
        const query = buildCategoryQuery({
            type: req.query.type,
            search: req.query.search,
            forceActive: true
        });

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
        const query = buildCategoryQuery({
            type: req.query.type,
            active: req.query.active,
            search: req.query.search
        });

        const sort = getSort(req.query.sortKey, req.query.sortDirection);
        const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
        const page = clamp(parseInt(String(req.query.page || '1'), 10) || 1, 1, 100000);
        const limit = clamp(parseInt(String(req.query.limit || '20'), 10) || 20, 1, 200);
        const skip = (page - 1) * limit;

        const [categories, filteredTotal, summaryByType, activeCount, inactiveCount, availableTypes] = await Promise.all([
            Category.find(query)
                .sort(sort)
                .skip(hasPagination ? skip : 0)
                .limit(hasPagination ? limit : 0),
            Category.countDocuments(query),
            Category.aggregate([
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            Category.countDocuments({ isActive: true }),
            Category.countDocuments({ isActive: false }),
            Category.distinct('type')
        ]);

        const byType = summaryByType.reduce<Record<string, number>>((acc, row) => {
            if (!row?._id) return acc;
            acc[String(row._id)] = Number(row.count || 0);
            return acc;
        }, {});

        const payload: Record<string, unknown> = {
            categories,
            count: categories.length,
            filteredTotal,
            summary: {
                total: activeCount + inactiveCount,
                active: activeCount,
                inactive: inactiveCount,
                byType
            },
            filterOptions: {
                types: availableTypes.filter((type): type is string => typeof type === 'string')
            }
        };

        if (hasPagination) {
            payload.meta = {
                page,
                limit,
                total: filteredTotal,
                pages: Math.max(1, Math.ceil(filteredTotal / limit)),
                hasNext: skip + categories.length < filteredTotal,
                hasPrev: page > 1
            };
        }

        res.json(payload);
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
        const payload = {
            ...req.body,
            type: req.body?.type ? String(req.body.type).trim().toLowerCase() : req.body?.type
        };
        const category = await Category.create(payload);
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
        const payload = {
            ...req.body,
            ...(req.body?.type !== undefined ? { type: String(req.body.type).trim().toLowerCase() } : {})
        };
        const category = await Category.findByIdAndUpdate(id, payload, { new: true });

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

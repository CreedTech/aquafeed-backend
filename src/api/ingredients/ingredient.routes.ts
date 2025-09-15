import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
    getIngredients,
    getIngredientById,
    getIngredientsByCategory
} from './ingredient.controller';

const router = Router();

// All ingredient routes require auth
router.use(requireAuth);

/**
 * @route   GET /api/v1/ingredients
 * @desc    Get all ingredients with optional filters
 * @access  Private
 * @query   category, search, active
 */
router.get('/', getIngredients);

/**
 * @route   GET /api/v1/ingredients/categories
 * @desc    Get all active categories (for mobile dropdowns)
 * @access  Private
 * @query   type (ingredient, fish_type, stage)
 */
router.get('/categories', async (req, res) => {
    const { getCategories } = await import('../admin/category.controller');
    return getCategories(req, res);
});

/**
 * @route   GET /api/v1/ingredients/category/:category
 * @desc    Get ingredients by category
 * @access  Private
 */
router.get('/category/:category', getIngredientsByCategory);

/**
 * @route   GET /api/ v1/ingredients/:id
 * @desc    Get single ingredient by ID
 * @access  Private
 */
router.get('/:id', getIngredientById);

export default router;

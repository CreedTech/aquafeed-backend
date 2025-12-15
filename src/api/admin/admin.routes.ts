import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.middleware';
import * as adminController from './admin.controller';
import * as ingredientController from './master-ingredient.controller';
import * as categoryController from './category.controller';

const router = Router();

// Protect all admin routes
router.use(requireAdmin);

// User Management
router.get('/users', adminController.getAllUsers);
router.patch('/users/:id/block', adminController.toggleUserBlock);
router.patch('/users/:id', adminController.updateUser);
router.get('/stats', adminController.getSystemStats);
router.get('/chart-data', adminController.getChartData);

// Category Management
router.get('/categories', categoryController.getAllCategories);
router.post('/categories', categoryController.createCategory);
router.put('/categories/:id', categoryController.updateCategory);
router.delete('/categories/:id', categoryController.deleteCategory);

// Master Ingredient Management
router.post('/ingredients', ingredientController.createIngredient);
router.put('/ingredients/:id', ingredientController.updateIngredient);
router.delete('/ingredients/:id', ingredientController.deleteIngredient);

// Formulations (Read-only for admin)
router.get('/formulations', adminController.getAllFormulations);

// Transactions (Read-only for admin)
router.get('/transactions', adminController.getAllTransactions);

// Farm Profiles (Read-only for admin)
router.get('/farms', adminController.getAllFarmProfiles);

export default router;

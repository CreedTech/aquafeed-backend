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
router.post('/users/bulk-block', adminController.bulkBlockUsers);
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

// Formulations (Read-only for admin - but allowed to delete)
router.get('/formulations', adminController.getAllFormulations);
router.delete('/formulations/:id', adminController.deleteFormulation);
router.post('/formulations/bulk-delete', adminController.bulkDeleteFormulations);

// Transactions (Read-only for admin - but allowed to delete)
router.get('/transactions', adminController.getAllTransactions);
router.delete('/transactions/:id', adminController.deleteTransaction);
router.post('/transactions/bulk-delete', adminController.bulkDeleteTransactions);

// Farm Profiles (Read-only for admin - but allowed to delete)
router.get('/farms', adminController.getAllFarmProfiles);
router.delete('/farms/:id', adminController.deleteFarmProfile);
router.post('/farms/bulk-delete', adminController.bulkDeleteFarms);

export default router;

import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.middleware';
import * as adminController from './admin.controller';
import * as ingredientController from './master-ingredient.controller';
import * as categoryController from './category.controller';
import * as standardController from './standard.controller';
import * as alternativeRuleController from './alternative-rule.controller';
import * as dataImportController from './data-import.controller';

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
router.get('/ingredients', ingredientController.getAllIngredients);
router.post('/ingredients', ingredientController.createIngredient);
router.put('/ingredients/:id', ingredientController.updateIngredient);
router.delete('/ingredients/:id', ingredientController.deleteIngredient);

// Feed Standards Management
router.get('/standards', standardController.getAllStandardsAdmin);
router.post('/standards', standardController.createStandardAdmin);
router.put('/standards/:id', standardController.updateStandardAdmin);
router.delete('/standards/:id', standardController.deleteStandardAdmin);

// Alternative Rules Management
router.get('/alternatives/rules', alternativeRuleController.getAlternativeRulesAdmin);
router.post('/alternatives/rules', alternativeRuleController.createAlternativeRuleAdmin);
router.put('/alternatives/rules/:id', alternativeRuleController.updateAlternativeRuleAdmin);
router.delete('/alternatives/rules/:id', alternativeRuleController.deleteAlternativeRuleAdmin);

// Data Imports (Poultry workbook)
router.post('/imports/poultry-workbook/preview', dataImportController.previewPoultryWorkbookImport);
router.post('/imports/poultry-workbook/apply', dataImportController.applyPoultryWorkbookImport);
router.post('/imports/poultry-workbook/rollback/:runId', dataImportController.rollbackPoultryWorkbookImport);
router.get('/imports/poultry-workbook/:runId', dataImportController.getPoultryWorkbookImportRun);
router.get('/imports/poultry-workbook', dataImportController.getRecentPoultryWorkbookImports);

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

// System Configuration
router.get('/configurations', adminController.getConfigurations);
router.put('/configurations/:key', adminController.updateConfiguration);

// Quick Mix Templates
router.get('/templates', adminController.getAllTemplatesAdmin);
router.post('/templates', adminController.createTemplateAdmin);
router.put('/templates/:id', adminController.updateTemplateAdmin);
router.delete('/templates/:id', adminController.deleteTemplateAdmin);

export default router;

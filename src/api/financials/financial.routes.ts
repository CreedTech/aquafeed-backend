import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { upload } from '../../middleware/upload.middleware';
import * as expenseController from '../expenses/expense.controller';
import * as revenueController from '../revenue/revenue.controller';
import * as financialController from './financial.controller';

const router = Router();

// Require authentication for all financial routes
router.use(requireAuth);

// ======================
// Expense Routes
// ======================
router.post(
    '/expenses',
    upload.single('receipt'), // Handle image upload
    expenseController.createExpense
);
router.get('/expenses', expenseController.getExpenses);
router.get('/expenses/summary', expenseController.getExpenseSummary);

// ======================
// Revenue Routes
// ======================
router.post('/revenue', revenueController.createRevenue);
router.get('/revenue', revenueController.getRevenues);
router.get('/revenue/summary', revenueController.getRevenueSummary);

// ======================
// Dashboard Routes
// ======================
router.get('/pnl', financialController.getPnL);

export default router;

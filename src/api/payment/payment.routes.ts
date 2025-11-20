import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import * as paymentController from './payment.controller';

const router = Router();

router.use(requireAuth);

router.post('/deposit', paymentController.initializeDeposit);
router.get('/verify', paymentController.verifyPayment);
router.get('/transactions', paymentController.getTransactions);
router.post('/grant-access', paymentController.grantFullAccess);

export default router;


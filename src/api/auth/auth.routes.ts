import { Router } from 'express';
import { requestOtp, verifyOtp, getCurrentUser, logout } from './auth.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

// Public Routes
router.post('/request-otp', requestOtp);
router.post('/verify-otp', verifyOtp);

// Protected Routes
router.get('/me', requireAuth, getCurrentUser);
router.post('/logout', requireAuth, logout);

export default router;

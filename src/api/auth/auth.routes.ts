import { Router } from 'express';
import { requestOtp, verifyOtp, getCurrentUser, updateCurrentUser, logout } from './auth.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { otpRequestLimiter, otpVerifyLimiter } from '../../middleware/rate-limit.middleware';

const router = Router();

// Public Routes
router.post('/request-otp', otpRequestLimiter, requestOtp);
router.post('/verify-otp', otpVerifyLimiter, verifyOtp);

// Protected Routes
router.get('/me', requireAuth, getCurrentUser);
router.patch('/me', requireAuth, updateCurrentUser);
router.post('/logout', requireAuth, logout);

export default router;

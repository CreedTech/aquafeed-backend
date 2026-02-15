import { Request, Response, NextFunction } from 'express';
import User from '../models/User';

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId || req.session?.userId;
    if (!userId) {
        res.status(401).json({ error: 'Unauthorized. Please log in.' });
        return;
    }

    // Normalize for downstream handlers that still read req.userId
    req.userId = userId;
    next();
};

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.userId || req.session?.userId;
    if (!userId) {
        res.status(403).json({ error: 'Forbidden. Admin access required.' });
        return;
    }

    if (req.session?.isAdmin) {
        req.userId = userId;
        next();
        return;
    }

    const user = await User.findById(userId).select('role').lean();
    if (!user || user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden. Admin access required.' });
        return;
    }

    req.userId = userId;
    next();
};

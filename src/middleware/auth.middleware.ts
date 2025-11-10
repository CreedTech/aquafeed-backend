import { Request, Response, NextFunction } from 'express';

// Extend Session data interface
declare module 'express-session' {
    interface SessionData {
        userId: string;
        isAdmin: boolean;
    }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session || !req.session.userId) {
        res.status(401).json({ error: 'Unauthorized. Please log in.' });
        return;
    }
    next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session || !req.session.userId || !req.session.isAdmin) {
        res.status(403).json({ error: 'Forbidden. Admin access required.' });
        return;
    }
    next();
};

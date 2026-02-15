import 'express-serve-static-core';
import 'express-session';

declare module 'express-serve-static-core' {
    interface Request {
        userId?: string;
    }
}

declare module 'express-session' {
    interface SessionData {
        userId?: string;
        isAdmin?: boolean;
    }
}

export { };

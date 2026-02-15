import crypto from 'crypto';
import AlternativeCache from '../models/AlternativeCache';

class AlternativeCacheService {
    private readonly ttlMs = 1000 * 60 * 15; // 15 minutes

    createKey(payload: unknown): string {
        const digest = crypto
            .createHash('sha256')
            .update(JSON.stringify(payload))
            .digest('hex');
        return `alt:${digest}`;
    }

    async get<T>(key: string): Promise<T | null> {
        const now = new Date();
        const cached = await AlternativeCache.findOne({
            key,
            expiresAt: { $gt: now }
        }).lean();

        if (!cached) {
            return null;
        }

        return cached.payload as T;
    }

    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
        const effectiveTtl = ttlMs || this.ttlMs;
        await AlternativeCache.findOneAndUpdate(
            { key },
            {
                key,
                payload: value,
                expiresAt: new Date(Date.now() + effectiveTtl)
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    async clear(prefix?: string): Promise<void> {
        if (!prefix) {
            await AlternativeCache.deleteMany({});
            return;
        }

        await AlternativeCache.deleteMany({
            key: { $regex: `^${prefix}` }
        });
    }
}

export const alternativeCacheService = new AlternativeCacheService();

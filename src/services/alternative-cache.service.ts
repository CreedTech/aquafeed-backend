import crypto from 'crypto';

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

class AlternativeCacheService {
    private cache = new Map<string, CacheEntry<unknown>>();
    private readonly ttlMs = 1000 * 60 * 15; // 15 minutes

    createKey(payload: unknown): string {
        const digest = crypto
            .createHash('sha256')
            .update(JSON.stringify(payload))
            .digest('hex');
        return `alt:${digest}`;
    }

    get<T>(key: string): T | null {
        const cached = this.cache.get(key);
        if (!cached) return null;
        if (Date.now() > cached.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return cached.value as T;
    }

    set<T>(key: string, value: T, ttlMs?: number): void {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + (ttlMs || this.ttlMs)
        });
    }

    clear(): void {
        this.cache.clear();
    }
}

export const alternativeCacheService = new AlternativeCacheService();

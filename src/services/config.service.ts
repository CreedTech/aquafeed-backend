import Configuration from '../models/Configuration';

class ConfigurationService {
    private cache: Map<string, any> = new Map();
    private lastFetch: number = 0;
    private readonly CACHE_TTL = 1000 * 60 * 5; // 5 minutes

    /**
     * Get a configuration value by key
     */
    async get<T>(key: string, defaultValue?: T): Promise<T> {
        // Simple cache logic
        const now = Date.now();
        if (this.cache.has(key) && (now - this.lastFetch < this.CACHE_TTL)) {
            return this.cache.get(key) as T;
        }

        const config = await Configuration.findOne({ key });
        if (!config) {
            if (defaultValue !== undefined) return defaultValue;
            throw new Error(`Configuration key not found: ${key}`);
        }

        this.cache.set(key, config.value);
        this.lastFetch = now;
        return config.value as T;
    }

    /**
     * Get all configurations as a flat object for solver/snapshots
     */
    async getAll(): Promise<Record<string, any>> {
        const configs = await Configuration.find({});
        const result: Record<string, any> = {};
        configs.forEach(c => {
            result[c.key] = c.value;
        });
        return result;
    }

    /**
     * Clear cache (useful after admin updates)
     */
    clearCache() {
        this.cache.clear();
        this.lastFetch = 0;
    }
}

export const configService = new ConfigurationService();

import axios from 'axios';
import { configService } from './config.service';

interface OpenRouterMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenRouterUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}

interface OpenRouterModelPricing {
    prompt?: number;
    completion?: number;
}

export interface OpenRouterModelSummary {
    id: string;
    name: string;
    description?: string;
    contextLength?: number;
    pricing: OpenRouterModelPricing;
    isFree: boolean;
}

export interface OpenRouterChatResult {
    rawText: string;
    parsedJson: Record<string, unknown>;
    modelUsed: string;
    fallbackUsed: boolean;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    latencyMs: number;
    estimatedCostUsd: number;
    pricingSource: 'model_catalog' | 'config_estimate' | 'unknown';
    modelPrimary: string;
    modelFallback: string;
}

type ChatJsonInput = {
    messages: OpenRouterMessage[];
    modelOverride?: string;
    maxTokensOverride?: number;
};

type RuntimeConfig = {
    apiKey: string;
    baseUrl: string;
    modelPrimary: string;
    modelFallback: string;
    defaultFreeModel: string;
    paidFallbackModel: string;
    freeModelAllowlist: string[];
    freeFirstEnabled: boolean;
    allowPaidFallback: boolean;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    inputCostPer1k: number;
    outputCostPer1k: number;
};

const parseNumber = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized === 'true' || normalized === '1';
};

const parseStringArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map((item) => String(item || '').trim())
                    .filter(Boolean);
            }
        } catch {
            return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }
    return [];
};

const parsePrice = (value: unknown): number | undefined => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
};

const extractJsonObject = (text: string): Record<string, unknown> => {
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error('AI response is empty');
    }

    try {
        return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
        const candidate = fencedMatch?.[1]?.trim();
        if (candidate) {
            return JSON.parse(candidate) as Record<string, unknown>;
        }
        throw new Error('AI response is not valid JSON');
    }
};

const extractResponseText = (payload: any): string => {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((entry) => (typeof entry?.text === 'string' ? entry.text : ''))
            .join('\n')
            .trim();
    }
    return '';
};

class OpenRouterService {
    private modelCache: { expiresAt: number; items: OpenRouterModelSummary[] } | null = null;

    private async getRuntimeConfig(): Promise<RuntimeConfig> {
        const all = await configService.getAll();
        const baseUrl = String(
            all.ai_openrouter_base_url || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
        ).replace(/\/$/, '');
        const modelPrimary = String(
            all.ai_openrouter_primary_model || process.env.OPENROUTER_PRIMARY_MODEL || 'meta-llama/llama-3.1-8b-instruct:free'
        );
        const modelFallback = String(
            all.ai_openrouter_fallback_model || process.env.OPENROUTER_FALLBACK_MODEL || 'openai/gpt-4o-mini'
        );
        const defaultFreeModel = String(
            all.ai_default_free_model || process.env.OPENROUTER_DEFAULT_FREE_MODEL || modelPrimary
        );
        const paidFallbackModel = String(
            all.ai_paid_fallback_model || process.env.OPENROUTER_PAID_FALLBACK_MODEL || modelFallback
        );
        const freeModelAllowlist = parseStringArray(
            all.ai_free_model_allowlist || process.env.OPENROUTER_FREE_MODEL_ALLOWLIST
        );
        const freeFirstEnabled = parseBoolean(all.ai_free_first_enabled, true);
        const allowPaidFallback = parseBoolean(all.ai_allow_paid_fallback, false);
        const temperature = parseNumber(all.ai_openrouter_temperature, 0.2);
        const maxTokens = Math.max(128, parseInt(String(all.ai_openrouter_max_tokens || 900), 10) || 900);
        const timeoutMs = Math.max(2000, parseInt(String(all.ai_openrouter_timeout_ms || 20000), 10) || 20000);
        const inputCostPer1k = parseNumber(all.ai_cost_input_per_1k, 0.00015);
        const outputCostPer1k = parseNumber(all.ai_cost_output_per_1k, 0.0006);
        const apiKey = process.env.OPENROUTER_API_KEY || String(all.ai_openrouter_api_key || '');

        return {
            apiKey,
            baseUrl,
            modelPrimary,
            modelFallback,
            defaultFreeModel,
            paidFallbackModel,
            freeModelAllowlist,
            freeFirstEnabled,
            allowPaidFallback,
            temperature,
            maxTokens,
            timeoutMs,
            inputCostPer1k,
            outputCostPer1k
        };
    }

    private normalizeUsage(usage: OpenRouterUsage | undefined) {
        const promptTokens = Number(usage?.prompt_tokens || 0);
        const completionTokens = Number(usage?.completion_tokens || 0);
        const totalTokens = Number(usage?.total_tokens || promptTokens + completionTokens);
        return {
            promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
            completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
            totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0
        };
    }

    private estimateCost(
        model: OpenRouterModelSummary | undefined,
        usage: { promptTokens: number; completionTokens: number },
        runtime: RuntimeConfig
    ): { estimatedCostUsd: number; pricingSource: OpenRouterChatResult['pricingSource'] } {
        if (model?.pricing.prompt !== undefined || model?.pricing.completion !== undefined) {
            const promptPrice = model.pricing.prompt || 0;
            const completionPrice = model.pricing.completion || 0;
            const modelEstimated = (usage.promptTokens * promptPrice) + (usage.completionTokens * completionPrice);
            if (Number.isFinite(modelEstimated) && modelEstimated >= 0) {
                return {
                    estimatedCostUsd: modelEstimated,
                    pricingSource: 'model_catalog'
                };
            }
        }

        const configEstimated = (
            (usage.promptTokens / 1000) * runtime.inputCostPer1k
            + (usage.completionTokens / 1000) * runtime.outputCostPer1k
        );
        if (Number.isFinite(configEstimated) && configEstimated >= 0) {
            return {
                estimatedCostUsd: configEstimated,
                pricingSource: 'config_estimate'
            };
        }

        return { estimatedCostUsd: 0, pricingSource: 'unknown' };
    }

    private sanitizeModelPayload(item: any): OpenRouterModelSummary | null {
        const id = String(item?.id || '').trim();
        if (!id) return null;
        const name = String(item?.name || id).trim();
        const pricing = {
            prompt: parsePrice(item?.pricing?.prompt),
            completion: parsePrice(item?.pricing?.completion)
        };
        const isFreeFromId = id.toLowerCase().includes(':free');
        const isFreeFromPricing = (pricing.prompt || 0) === 0 && (pricing.completion || 0) === 0;
        return {
            id,
            name,
            description: item?.description ? String(item.description) : undefined,
            contextLength: Number.isFinite(Number(item?.context_length)) ? Number(item.context_length) : undefined,
            pricing,
            isFree: isFreeFromId || isFreeFromPricing
        };
    }

    async getModels(options?: { freeOnly?: boolean; forceRefresh?: boolean }): Promise<OpenRouterModelSummary[]> {
        const runtime = await this.getRuntimeConfig();
        if (!runtime.apiKey) {
            throw new Error('OPENROUTER_API_KEY is missing');
        }

        const now = Date.now();
        const shouldUseCache = !options?.forceRefresh && this.modelCache && now < this.modelCache.expiresAt;
        if (shouldUseCache) {
            const cachedItems = this.modelCache!.items;
            return options?.freeOnly ? cachedItems.filter((item) => item.isFree) : cachedItems;
        }

        const response = await axios.get(`${runtime.baseUrl}/models`, {
            timeout: runtime.timeoutMs,
            headers: {
                Authorization: `Bearer ${runtime.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.BACKEND_URL || 'https://aquafeed-backend.local',
                'X-Title': 'AquaFeed Formulation Analyst'
            }
        });

        const rawItems: any[] = Array.isArray(response.data?.data) ? response.data.data : [];
        const items: OpenRouterModelSummary[] = rawItems
            .map((item: any) => this.sanitizeModelPayload(item))
            .filter((item: OpenRouterModelSummary | null): item is OpenRouterModelSummary => item !== null)
            .sort((a: OpenRouterModelSummary, b: OpenRouterModelSummary) => a.id.localeCompare(b.id));

        this.modelCache = {
            items,
            expiresAt: now + (1000 * 60 * 10)
        };

        return options?.freeOnly ? items.filter((item: OpenRouterModelSummary) => item.isFree) : items;
    }

    private async resolveModelCandidates(input: ChatJsonInput, runtime: RuntimeConfig): Promise<string[]> {
        const requestedModel = input.modelOverride?.trim();
        const unique = (items: string[]) => items.filter((m, index, arr) => m && arr.indexOf(m) === index);

        let modelsFromCatalog: OpenRouterModelSummary[] = [];
        try {
            modelsFromCatalog = await this.getModels();
        } catch {
            modelsFromCatalog = [];
        }

        if (requestedModel) {
            const requestedFromCatalog = modelsFromCatalog.find((item) => item.id === requestedModel);
            const requestedLooksFree = requestedModel.toLowerCase().includes(':free');
            const requestedIsFree = requestedLooksFree || Boolean(requestedFromCatalog?.isFree);
            const freeCatalogModels = modelsFromCatalog.filter((item) => item.isFree).map((item) => item.id);
            const availableFreeSet = new Set(freeCatalogModels);
            const configuredFreeCandidates = runtime.freeModelAllowlist
                .filter((id) => !modelsFromCatalog.length || availableFreeSet.has(id));

            const candidates: string[] = [requestedModel];
            if (requestedIsFree) {
                if (runtime.defaultFreeModel) candidates.push(runtime.defaultFreeModel);
                candidates.push(...configuredFreeCandidates);
                if (runtime.modelPrimary && runtime.modelPrimary.toLowerCase().includes(':free')) {
                    candidates.push(runtime.modelPrimary);
                }
                candidates.push(...freeCatalogModels.slice(0, 8));
            }
            if (runtime.allowPaidFallback) {
                candidates.push(runtime.paidFallbackModel, runtime.modelPrimary, runtime.modelFallback);
            }
            return unique(candidates);
        }

        if (!runtime.freeFirstEnabled) {
            return unique([runtime.modelPrimary, runtime.modelFallback]);
        }

        const freeModels = modelsFromCatalog.filter((item) => item.isFree);
        const freeModelIds = new Set(freeModels.map((item) => item.id));
        const configuredFreeCandidates = runtime.freeModelAllowlist.filter((id) => freeModelIds.has(id));
        const defaultFreeCandidate = runtime.defaultFreeModel;
        const chosenFree = configuredFreeCandidates[0]
            || (freeModelIds.has(defaultFreeCandidate)
            ? defaultFreeCandidate
            : (freeModels[0]?.id || runtime.modelPrimary));

        const candidates = [chosenFree];
        candidates.push(...configuredFreeCandidates.slice(1, 4));
        if (runtime.allowPaidFallback) {
            candidates.push(runtime.paidFallbackModel, runtime.modelPrimary, runtime.modelFallback);
        }

        return unique(candidates);
    }

    async chatJson(input: ChatJsonInput): Promise<OpenRouterChatResult> {
        const runtime = await this.getRuntimeConfig();
        if (!runtime.apiKey) {
            throw new Error('OPENROUTER_API_KEY is missing');
        }

        const models = await this.resolveModelCandidates(input, runtime);
        console.info('[AI][openrouter.candidates]', {
            count: models.length,
            models: models.slice(0, 12)
        });
        const catalog = await this.getModels().catch(() => []);
        const modelById = new Map(catalog.map((item) => [item.id, item]));
        let lastError: Error | null = null;

        for (let i = 0; i < models.length; i += 1) {
            const model = models[i];
            const startedAt = Date.now();
            try {
                const response = await axios.post(
                    `${runtime.baseUrl}/chat/completions`,
                    {
                        model,
                        temperature: runtime.temperature,
                        max_tokens: input.maxTokensOverride && input.maxTokensOverride > 0
                            ? input.maxTokensOverride
                            : runtime.maxTokens,
                        response_format: { type: 'json_object' },
                        messages: input.messages
                    },
                    {
                        timeout: runtime.timeoutMs,
                        headers: {
                            Authorization: `Bearer ${runtime.apiKey}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': process.env.BACKEND_URL || 'https://aquafeed-backend.local',
                            'X-Title': 'AquaFeed Formulation Analyst'
                        }
                    }
                );

                const rawText = extractResponseText(response.data);
                const parsedJson = extractJsonObject(rawText);
                const usage = this.normalizeUsage(response.data?.usage);
                const estimation = this.estimateCost(modelById.get(model), usage, runtime);

                return {
                    rawText,
                    parsedJson,
                    modelUsed: model,
                    fallbackUsed: i > 0,
                    usage,
                    latencyMs: Date.now() - startedAt,
                    estimatedCostUsd: estimation.estimatedCostUsd,
                    pricingSource: estimation.pricingSource,
                    modelPrimary: runtime.modelPrimary,
                    modelFallback: runtime.modelFallback
                };
            } catch (error) {
                const providerMessage = axios.isAxiosError(error)
                    ? String(error.response?.data?.error?.message || error.response?.data?.message || error.message || 'OpenRouter request failed')
                    : (error instanceof Error ? error.message : 'OpenRouter request failed');
                console.warn('[AI][openrouter.attempt_failed]', {
                    model,
                    attempt: i + 1,
                    totalCandidates: models.length,
                    message: providerMessage
                });
                lastError = new Error(`Model ${model} failed: ${providerMessage}`);
            }
        }

        throw lastError || new Error('OpenRouter request failed');
    }
}

export const openRouterService = new OpenRouterService();

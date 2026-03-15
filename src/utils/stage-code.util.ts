const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();

export const FISH_STAGE_ALIAS_TO_CODE: Record<string, string> = {
    FRY: 'FISH_CATFISH_2MM_FINGERLINGS',
    FINGERLING: 'FISH_CATFISH_2MM_FINGERLINGS',
    FINGERLINGS: 'FISH_CATFISH_2MM_FINGERLINGS',
    GROWER: 'FISH_CATFISH_3MM_JUVENILES',
    JUVENILE: 'FISH_CATFISH_3MM_JUVENILES',
    JUVENILES: 'FISH_CATFISH_3MM_JUVENILES',
    'GROW OUT': 'FISH_CATFISH_4MM_GROW_OUT',
    'GROW-OUT': 'FISH_CATFISH_4MM_GROW_OUT',
    FINISHER: 'FISH_CATFISH_6MM_GROW_OUT',
    'CATFISH FRY PREMIUM 0.5MM': 'FISH_CATFISH_2MM_FINGERLINGS',
    'CATFISH GROWER PREMIUM 3MM': 'FISH_CATFISH_3MM_JUVENILES'
};

export const normalizeStageCode = (value?: string): string => normalizeName(String(value || ''));

export const resolveFishStageAlias = (
    stageCode?: string,
    stageLabel?: string,
    standardName?: string
): string => {
    const normalizedCode = normalizeStageCode(stageCode);
    if (normalizedCode.startsWith('FISH_CATFISH_')) return normalizedCode;
    const candidates = [stageLabel, standardName]
        .map((value) => normalizeStageCode(value).replace(/^CATFISH\s+/i, ''))
        .filter(Boolean);
    for (const candidate of candidates) {
        const mapped = FISH_STAGE_ALIAS_TO_CODE[candidate];
        if (mapped) return mapped;
    }
    return FISH_STAGE_ALIAS_TO_CODE[normalizedCode] || normalizedCode;
};

export const resolveCanonicalStageCode = (
    stageCode?: string,
    options?: {
        feedType?: 'fish' | 'poultry';
        stageLabel?: string;
        standardName?: string;
    }
): string => {
    const normalized = normalizeStageCode(stageCode);
    if ((options?.feedType || 'fish') === 'poultry') {
        return normalized;
    }
    return resolveFishStageAlias(normalized, options?.stageLabel, options?.standardName);
};

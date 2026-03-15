import crypto from 'crypto';
import FeedStandard from '../models/FeedStandard';
import Ingredient, { INutrients } from '../models/Ingredient';
import DataImportRun, {
    IDataImportRun,
    IFlaggedItem,
    IImportChange
} from '../models/DataImportRun';
import { poultryWorkbookParserService } from './poultry-workbook-parser.service';

type NutrientKey =
    | 'protein'
    | 'fat'
    | 'fiber'
    | 'ash'
    | 'lysine'
    | 'methionine'
    | 'calcium'
    | 'phosphorous'
    | 'energy';

type NutrientRange = { min: number; max: number };

type IngredientDocLike = {
    _id: unknown;
    name: string;
    aliases?: string[];
    category: string;
    nutrients: Partial<INutrients>;
    isActive: boolean;
    toObject: () => Record<string, unknown>;
};

type StandardDocLike = {
    _id: unknown;
    name: string;
    brand: string;
    feedCategory: 'Catfish' | 'Poultry';
    fishType?: string;
    poultryType?: string;
    stage: string;
    stageCode?: string;
    ageGuidance?: string;
    sourceMeta?: {
        workbook?: string;
        sheet?: string;
        version?: string;
        inheritedFields?: string[];
    };
    isActive: boolean;
    pelletSize: string;
    targetNutrients: Record<string, unknown>;
    toObject: () => Record<string, unknown>;
};

type StandardAction = {
    action: 'create' | 'update' | 'skip';
    key: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    notes: string[];
};

type IngredientAction = {
    action: 'create' | 'update' | 'skip';
    key: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    notes: string[];
};

type PreviewResult = {
    source: {
        file: string;
        version: string;
        generatedAt: string;
        fingerprint: string;
    };
    summary: {
        standardsCreated: number;
        standardsUpdated: number;
        ingredientsCreated: number;
        ingredientsUpdated: number;
        flagged: number;
    };
    flaggedItems: IFlaggedItem[];
    changes: IImportChange[];
};

type PreviewOptions = {
    preferLiveWorkbook?: boolean;
    workbookPath?: string;
};

type ApplyResult = {
    run: IDataImportRun;
    applied: {
        standardsCreated: number;
        standardsUpdated: number;
        ingredientsCreated: number;
        ingredientsUpdated: number;
    };
};

const STANDARD_NUTRIENTS: NutrientKey[] = [
    'protein',
    'fat',
    'fiber',
    'ash',
    'lysine',
    'methionine',
    'calcium',
    'phosphorous',
    'energy'
];

const strictPercentNutrients: NutrientKey[] = ['protein', 'fat', 'fiber', 'ash'];
const micronutrientPercentNutrients: NutrientKey[] = [
    'lysine',
    'methionine',
    'calcium',
    'phosphorous'
];

const FISH_STAGE_ORDER = [
    'FISH_CATFISH_2MM_FINGERLINGS',
    'FISH_CATFISH_3MM_JUVENILES',
    'FISH_CATFISH_4MM_GROW_OUT',
    'FISH_CATFISH_6MM_GROW_OUT'
] as const;

const FISH_STAGE_ALIAS_TO_CODE: Record<string, string> = {
    FRY: 'FISH_CATFISH_2MM_FINGERLINGS',
    FINGERLING: 'FISH_CATFISH_2MM_FINGERLINGS',
    FINGERLINGS: 'FISH_CATFISH_2MM_FINGERLINGS',
    GROWER: 'FISH_CATFISH_3MM_JUVENILES',
    JUVENILE: 'FISH_CATFISH_3MM_JUVENILES',
    JUVENILES: 'FISH_CATFISH_3MM_JUVENILES',
    'GROW OUT': 'FISH_CATFISH_4MM_GROW_OUT',
    'GROW-OUT': 'FISH_CATFISH_4MM_GROW_OUT',
    FINISHER: 'FISH_CATFISH_6MM_GROW_OUT'
};

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toUpperCase();

const toFeedCategory = (value: unknown): 'Catfish' | 'Poultry' => (
    normalizeName(String(value || '')) === 'POULTRY' ? 'Poultry' : 'Catfish'
);

const fingerprintLoadedSource = (rawSnapshot: unknown) => {
    const raw = JSON.stringify({
        snapshot: rawSnapshot
    });
    return crypto.createHash('sha1').update(raw).digest('hex');
};

const normalizeRangeValue = (nutrient: NutrientKey, value: number): number => {
    if (!Number.isFinite(value)) return 0;
    if (nutrient === 'energy') return Math.max(0, value);

    let next = value;

    // Handles shorthand like 0.01 => 1% when sheet stores decimal fractions.
    if (strictPercentNutrients.includes(nutrient) && next > 0 && next <= 1) {
        next *= 100;
    }

    if (micronutrientPercentNutrients.includes(nutrient) && next > 0 && next < 0.05) {
        next *= 100;
    }

    return Math.max(0, next);
};

const validateStandardRange = (nutrient: NutrientKey, range: NutrientRange): string[] => {
    const issues: string[] = [];
    if (range.min > range.max) {
        issues.push(`${nutrient}: min is greater than max`);
    }

    const [minAllowed, maxAllowed] = nutrient === 'energy' ? [0, 10000] : [0, 100];
    if (range.min < minAllowed || range.max > maxAllowed) {
        issues.push(`${nutrient}: value outside allowed bounds (${minAllowed}-${maxAllowed})`);
    }

    return issues;
};

const validateIngredient = (name: string, nutrients: Record<NutrientKey, number>): string[] => {
    const issues: string[] = [];

    STANDARD_NUTRIENTS.forEach((nutrient) => {
        const value = nutrients[nutrient];
        if (!Number.isFinite(value)) {
            issues.push(`${nutrient}: non-numeric value`);
            return;
        }

        if (nutrient === 'energy') {
            if (value < 0 || value > 10000) {
                issues.push(`${nutrient}: out of bounds (${value})`);
            }
            return;
        }

        if (value < 0 || value > 100) {
            issues.push(`${nutrient}: out of bounds (${value})`);
        }
    });

    const upperName = normalizeName(name);
    if (upperName.includes('FISHMEAL 72%') && nutrients.protein < 60) {
        issues.push('semantic: FISHMEAL 72% protein is unexpectedly low');
    }
    if (upperName.includes('FISHMEAL 65%') && nutrients.protein < 55) {
        issues.push('semantic: FISHMEAL 65% protein is unexpectedly low');
    }
    if (upperName.includes('LYSINE') && nutrients.lysine < 70) {
        issues.push('semantic: lysine additive should have high lysine value');
    }
    if (upperName.includes('METHIONINE') && nutrients.methionine < 70) {
        issues.push('semantic: methionine additive should have high methionine value');
    }

    return issues;
};

const nutrientsEqual = (a: Partial<INutrients>, b: Partial<INutrients>) => {
    return STANDARD_NUTRIENTS.every((nutrient) => {
        const av = Number((a as Record<string, unknown>)[nutrient] || 0);
        const bv = Number((b as Record<string, unknown>)[nutrient] || 0);
        return Math.abs(av - bv) < 0.0001;
    });
};

const rangesEqual = (
    a: Partial<Record<NutrientKey, NutrientRange>>,
    b: Partial<Record<NutrientKey, NutrientRange>>
) => {
    return STANDARD_NUTRIENTS.every((nutrient) => {
        const ar = a[nutrient];
        const br = b[nutrient];
        if (!ar && !br) return true;
        if (!ar || !br) return false;
        return Math.abs(ar.min - br.min) < 0.0001 && Math.abs(ar.max - br.max) < 0.0001;
    });
};

const toImportChange = (
    entityType: 'ingredient' | 'standard',
    action: StandardAction | IngredientAction
): IImportChange => ({
    entityType,
    key: action.key,
    action: action.action,
    before: action.before,
    after: action.after,
    notes: action.notes
});

const sanitizeStandardTargets = (
    input: Record<string, NutrientRange>
): Partial<Record<NutrientKey, NutrientRange>> => {
    const sanitized: Partial<Record<NutrientKey, NutrientRange>> = {};
    STANDARD_NUTRIENTS.forEach((nutrient) => {
        const range = input[nutrient];
        if (!range) return;
        sanitized[nutrient] = {
            min: normalizeRangeValue(nutrient, Number(range.min || 0)),
            max: normalizeRangeValue(nutrient, Number(range.max || 0))
        };
    });
    return sanitized;
};

const sanitizeIngredientNutrients = (input: Record<string, number>): Record<NutrientKey, number> => {
    const sanitized = {} as Record<NutrientKey, number>;
    STANDARD_NUTRIENTS.forEach((nutrient) => {
        const value = Number(input[nutrient] || 0);
        sanitized[nutrient] = normalizeRangeValue(nutrient, value);
    });
    return sanitized;
};

const resolveIngredientName = (name: string, aliases: Record<string, string>) => {
    const normalized = normalizeName(name);
    return aliases[normalized] || normalized;
};

const parsePelletMm = (value: string): number => {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : 0;
};

const normalizeFishStageAlias = (stageCode: string, stageLabel: string, name: string): string => {
    const normalizedCode = normalizeName(stageCode);
    if (FISH_STAGE_ORDER.includes(normalizedCode as typeof FISH_STAGE_ORDER[number])) {
        return normalizedCode;
    }
    const candidates = [stageLabel, name]
        .map((value) => normalizeName(value).replace(/^CATFISH\s+/i, ''))
        .filter(Boolean);
    for (const candidate of candidates) {
        if (FISH_STAGE_ALIAS_TO_CODE[candidate]) {
            return FISH_STAGE_ALIAS_TO_CODE[candidate];
        }
    }
    return normalizedCode;
};

const inferFishEnergyRange = (
    stageCode: string,
    pelletSize: string,
    standards: StandardDocLike[]
): NutrientRange | null => {
    const normalizedStageCode = normalizeFishStageAlias(stageCode, '', '');
    const directStage = standards.find((standard) => (
        toFeedCategory(standard.feedCategory) === 'Catfish'
        && normalizeFishStageAlias(
            standard.stageCode || '',
            standard.stage || '',
            standard.name || ''
        ) === normalizedStageCode
        && Number((standard.targetNutrients as Record<string, NutrientRange>)?.energy?.min) > 0
    ));
    if (directStage) {
        const energy = (directStage.targetNutrients as Record<string, NutrientRange>).energy;
        if (energy && Number.isFinite(energy.min) && Number.isFinite(energy.max)) {
            return { min: Number(energy.min), max: Number(energy.max) };
        }
    }

    const pellet = parsePelletMm(pelletSize);
    const candidates = standards
        .filter((standard) => toFeedCategory(standard.feedCategory) === 'Catfish')
        .map((standard) => {
            const target = (standard.targetNutrients as Record<string, NutrientRange>)?.energy;
            return {
                standard,
                energy: target,
                pellet: parsePelletMm(String(standard.pelletSize || ''))
            };
        })
        .filter((row) => row.energy && Number(row.energy.min) > 0);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
        const aDistance = Math.abs(a.pellet - pellet);
        const bDistance = Math.abs(b.pellet - pellet);
        return aDistance - bDistance;
    });

    const selected = candidates[0].energy as NutrientRange;
    return {
        min: Number(selected.min),
        max: Number(selected.max)
    };
};

const buildExistingIngredientLookup = (ingredients: IngredientDocLike[]) => {
    const lookup = new Map<string, IngredientDocLike>();
    ingredients.forEach((ingredient) => {
        lookup.set(normalizeName(ingredient.name), ingredient);
        (ingredient.aliases || []).forEach((alias) => {
            lookup.set(normalizeName(alias), ingredient);
        });
    });
    return lookup;
};

const buildExistingStandardLookup = (standards: StandardDocLike[]) => {
    const byStageCode = new Map<string, StandardDocLike>();
    const byName = new Map<string, StandardDocLike>();

    standards.forEach((standard) => {
        if (standard.stageCode) {
            const normalizedStageCode = normalizeName(standard.stageCode);
            byStageCode.set(normalizedStageCode, standard);
            if (toFeedCategory(standard.feedCategory) === 'Catfish') {
                const alias = normalizeFishStageAlias(
                    normalizedStageCode,
                    standard.stage || '',
                    standard.name || ''
                );
                byStageCode.set(alias, standard);
            }
        }
        byName.set(normalizeName(standard.name), standard);
    });

    return { byStageCode, byName };
};

const createPreview = async (options: PreviewOptions = {}): Promise<PreviewResult> => {
    const workbookSnapshot = await poultryWorkbookParserService.loadSnapshot(options);
    const sourceFingerprint = fingerprintLoadedSource(workbookSnapshot);
    const aliasLookup = Object.entries(workbookSnapshot.aliases || {})
        .reduce<Record<string, string>>((acc, [from, to]) => {
            acc[normalizeName(from)] = normalizeName(to);
            return acc;
        }, {});

    const [existingStandards, existingIngredients] = await Promise.all([
        FeedStandard.find({ feedCategory: { $in: ['Poultry', 'Catfish'] } }) as unknown as Promise<StandardDocLike[]>,
        Ingredient.find({}) as unknown as Promise<IngredientDocLike[]>
    ]);

    const standardLookup = buildExistingStandardLookup(existingStandards);
    const ingredientLookup = buildExistingIngredientLookup(existingIngredients);

    const flaggedItems: IFlaggedItem[] = [];
    const standardActions: StandardAction[] = [];
    const ingredientActions: IngredientAction[] = [];

    const workbookFishStageCodes = new Set<string>();

    for (const standard of workbookSnapshot.standards) {
        const feedCategory = toFeedCategory(standard.feedCategory);
        const normalizedStageCode = feedCategory === 'Catfish'
            ? normalizeFishStageAlias(standard.stageCode, standard.stage, standard.name)
            : normalizeName(standard.stageCode);
        const key = normalizedStageCode;
        if (feedCategory === 'Catfish') workbookFishStageCodes.add(normalizedStageCode);
        const existing =
            standardLookup.byStageCode.get(key)
            || standardLookup.byName.get(normalizeName(standard.name));

        const targetNutrients = sanitizeStandardTargets(standard.targetNutrients as Record<string, NutrientRange>);
        const inheritedFields: string[] = [];
        const hasEnergyTarget = (
            Number(targetNutrients.energy?.min || 0) > 0
            || Number(targetNutrients.energy?.max || 0) > 0
        );
        if (feedCategory === 'Catfish' && !hasEnergyTarget) {
            const inferredEnergy = inferFishEnergyRange(normalizedStageCode, standard.pelletSize, existingStandards);
            if (inferredEnergy) {
                targetNutrients.energy = {
                    min: normalizeRangeValue('energy', inferredEnergy.min),
                    max: normalizeRangeValue('energy', inferredEnergy.max)
                };
                inheritedFields.push('energy');
                flaggedItems.push({
                    entityType: 'standard',
                    key,
                    reasons: ['energy target inherited from nearest legacy fish standard'],
                    severity: 'warning'
                });
            } else {
                flaggedItems.push({
                    entityType: 'standard',
                    key,
                    reasons: ['energy target missing in workbook and no legacy fish energy found'],
                    severity: 'warning'
                });
            }
        }

        const issues = STANDARD_NUTRIENTS
            .flatMap((nutrient) => {
                const range = targetNutrients[nutrient];
                if (!range) return [];
                return validateStandardRange(nutrient, range);
            });

        const nextDoc: Record<string, unknown> = {
            name: standard.name,
            brand: standard.brand,
            feedCategory,
            ...(feedCategory === 'Poultry'
                ? { poultryType: standard.poultryType }
                : { fishType: standard.fishType || 'Catfish' }),
            stage: standard.stage,
            stageCode: normalizedStageCode,
            ageGuidance: standard.ageGuidance,
            pelletSize: standard.pelletSize,
            targetNutrients,
            sourceMeta: {
                workbook: workbookSnapshot.workbook,
                sheet: standard.sourceSheet,
                version: workbookSnapshot.version,
                inheritedFields
            },
            isActive: true
        };

        if (issues.length > 0) {
            flaggedItems.push({
                entityType: 'standard',
                key,
                reasons: issues,
                severity: 'error'
            });
            standardActions.push({
                action: 'skip',
                key,
                before: existing ? existing.toObject() as unknown as Record<string, unknown> : undefined,
                after: nextDoc,
                notes: issues
            });
            continue;
        }

        if (!existing) {
            standardActions.push({
                action: 'create',
                key,
                after: nextDoc,
                notes: []
            });
            continue;
        }

        const currentRanges = (existing.targetNutrients || {}) as Partial<Record<NutrientKey, NutrientRange>>;
        const changed =
            existing.name !== standard.name
            || existing.brand !== standard.brand
            || toFeedCategory(existing.feedCategory) !== feedCategory
            || (existing.fishType || '') !== (feedCategory === 'Catfish' ? (standard.fishType || 'Catfish') : '')
            || (existing.poultryType || '') !== standard.poultryType
            || existing.stage !== standard.stage
            || normalizeName(existing.stageCode || '') !== normalizedStageCode
            || (existing.ageGuidance || '') !== standard.ageGuidance
            || existing.pelletSize !== standard.pelletSize
            || normalizeName(String(existing.sourceMeta?.version || '')) !== normalizeName(workbookSnapshot.version)
            || !rangesEqual(currentRanges, targetNutrients);

        standardActions.push({
            action: changed ? 'update' : 'skip',
            key,
            before: existing.toObject() as unknown as Record<string, unknown>,
            after: nextDoc,
            notes: []
        });
    }

    existingStandards
        .filter((standard) => (
            toFeedCategory(standard.feedCategory) === 'Catfish'
            && standard.isActive
            && normalizeName(String(standard.sourceMeta?.version || '')) !== normalizeName(workbookSnapshot.version)
        ))
        .forEach((standard) => {
            const normalizedStageCode = normalizeName(standard.stageCode || '');
            if (normalizedStageCode && workbookFishStageCodes.has(normalizedStageCode)) return;
            const { _id, __v, ...serializable } = standard.toObject() as Record<string, unknown>;

            standardActions.push({
                action: 'update',
                key: normalizeName(`LEGACY_${standard._id}`),
                before: standard.toObject() as unknown as Record<string, unknown>,
                after: {
                    ...serializable,
                    isActive: false
                },
                notes: ['deactivated legacy fish standard in favor of workbook-derived stages']
            });
        });

    for (const ingredient of workbookSnapshot.ingredients) {
        const sourceName = normalizeName(ingredient.name);
        const resolvedName = resolveIngredientName(sourceName, aliasLookup);
        const key = resolvedName;
        const existing = ingredientLookup.get(resolvedName);

        const sanitizedNutrients = sanitizeIngredientNutrients(ingredient.nutrients as Record<string, number>);
        const issues = validateIngredient(resolvedName, sanitizedNutrients);

        const nextDoc: Record<string, unknown> = {
            name: resolvedName,
            category: normalizeName(ingredient.category || 'OTHER'),
            nutrients: sanitizedNutrients,
            dataQuality: issues.length > 0 ? 'flagged' : 'verified',
            qualityNotes: issues,
            aliases: sourceName !== resolvedName ? [sourceName] : []
        };

        if (issues.length > 0) {
            flaggedItems.push({
                entityType: 'ingredient',
                key,
                reasons: issues,
                severity: 'warning'
            });

            ingredientActions.push({
                action: 'skip',
                key,
                before: existing ? existing.toObject() as unknown as Record<string, unknown> : undefined,
                after: nextDoc,
                notes: issues
            });
            continue;
        }

        if (!existing) {
            ingredientActions.push({
                action: 'create',
                key,
                after: {
                    ...nextDoc,
                    defaultPrice: null,
                    constraints: {},
                    isActive: true
                },
                notes: []
            });
            continue;
        }

        const aliasesSet = new Set<string>([...(existing.aliases || [])]);
        if (sourceName !== resolvedName) aliasesSet.add(sourceName);

        const changed =
            normalizeName(existing.category) !== normalizeName(String(nextDoc.category))
            || !nutrientsEqual(existing.nutrients as Partial<INutrients>, sanitizedNutrients)
            || Array.from(aliasesSet).sort().join('|') !== (existing.aliases || []).sort().join('|');

        ingredientActions.push({
            action: changed ? 'update' : 'skip',
            key,
            before: existing.toObject() as unknown as Record<string, unknown>,
            after: {
                ...nextDoc,
                aliases: Array.from(aliasesSet),
                isActive: existing.isActive
            },
            notes: []
        });
    }

    const changes: IImportChange[] = [
        ...standardActions.map((item) => toImportChange('standard', item)),
        ...ingredientActions.map((item) => toImportChange('ingredient', item))
    ];

    const summary = {
        standardsCreated: standardActions.filter((item) => item.action === 'create').length,
        standardsUpdated: standardActions.filter((item) => item.action === 'update').length,
        ingredientsCreated: ingredientActions.filter((item) => item.action === 'create').length,
        ingredientsUpdated: ingredientActions.filter((item) => item.action === 'update').length,
        flagged: flaggedItems.length
    };

    return {
        source: {
            file: workbookSnapshot.workbook,
            version: workbookSnapshot.version,
            generatedAt: workbookSnapshot.generatedAt,
            fingerprint: sourceFingerprint
        },
        summary,
        flaggedItems,
        changes
    };
};

const applyChanges = async (run: IDataImportRun): Promise<ApplyResult['applied']> => {
    let standardsCreated = 0;
    let standardsUpdated = 0;
    let ingredientsCreated = 0;
    let ingredientsUpdated = 0;

    const rollbackStandards: Array<Record<string, unknown>> = [];
    const rollbackIngredients: Array<Record<string, unknown>> = [];

    for (const change of run.changes) {
        if (change.action === 'skip') {
            if (change.entityType === 'ingredient' && change.before?._id && change.notes && change.notes.length > 0) {
                await Ingredient.findByIdAndUpdate(change.before._id, {
                    $set: {
                        dataQuality: 'flagged',
                        qualityNotes: change.notes
                    }
                });
            }
            continue;
        }

        if (change.entityType === 'standard') {
            if (change.before?._id) {
                rollbackStandards.push(change.before);
                await FeedStandard.findByIdAndUpdate(change.before._id, change.after || {}, {
                    runValidators: true
                });
                standardsUpdated += 1;
            } else {
                const created = await FeedStandard.create(change.after || {});
                rollbackStandards.push({
                    _id: created._id,
                    __createdDuringRun: true,
                    stageCode: created.stageCode,
                    name: created.name
                });
                standardsCreated += 1;
            }
            continue;
        }

        if (change.before?._id) {
            rollbackIngredients.push(change.before);
            await Ingredient.findByIdAndUpdate(change.before._id, {
                ...(change.after || {}),
                dataQuality: 'verified',
                qualityNotes: []
            }, {
                runValidators: true
            });
            ingredientsUpdated += 1;
        } else {
            const created = await Ingredient.create(change.after || {});
            rollbackIngredients.push({
                _id: created._id,
                __createdDuringRun: true,
                name: created.name
            });
            ingredientsCreated += 1;
        }
    }

    run.rollbackSnapshotId = run._id.toString();
    run.rollbackSnapshot = {
        standards: rollbackStandards,
        ingredients: rollbackIngredients
    };

    return {
        standardsCreated,
        standardsUpdated,
        ingredientsCreated,
        ingredientsUpdated
    };
};

const rollbackRun = async (run: IDataImportRun) => {
    const standardsSnapshot = run.rollbackSnapshot?.standards || [];
    const ingredientsSnapshot = run.rollbackSnapshot?.ingredients || [];

    for (const item of standardsSnapshot) {
        if (item.__createdDuringRun) {
            await FeedStandard.findByIdAndDelete(item._id);
            continue;
        }

        const { _id, ...rest } = item;
        await FeedStandard.findByIdAndUpdate(_id, rest, { runValidators: true });
    }

    for (const item of ingredientsSnapshot) {
        if (item.__createdDuringRun) {
            await Ingredient.findByIdAndDelete(item._id);
            continue;
        }

        const { _id, ...rest } = item;
        await Ingredient.findByIdAndUpdate(_id, rest, { runValidators: true });
    }
};

export const poultryWorkbookImportService = {
    async preview(options: PreviewOptions = {}): Promise<IDataImportRun> {
        const preview = await createPreview(options);

        const run = await DataImportRun.create({
            importType: 'poultry_workbook',
            sourceFile: preview.source.file,
            sourceVersion: preview.source.version,
            status: 'previewed',
            diffSummary: preview.summary,
            flaggedItems: preview.flaggedItems,
            changes: preview.changes,
            previewedAt: new Date()
        });

        return run;
    },

    async apply(runId?: string, options: PreviewOptions = {}): Promise<ApplyResult> {
        const run = runId
            ? await DataImportRun.findById(runId)
            : await this.preview(options);

        if (!run) {
            throw new Error('Import run not found');
        }

        if (run.status === 'applied') {
            throw new Error('This import run has already been applied');
        }

        const applied = await applyChanges(run);
        run.status = 'applied';
        run.appliedAt = new Date();
        run.errorMessage = undefined;
        await run.save();

        return { run, applied };
    },

    async getRun(runId: string): Promise<IDataImportRun | null> {
        return DataImportRun.findById(runId);
    },

    async rollback(runId: string): Promise<IDataImportRun> {
        const run = await DataImportRun.findById(runId);
        if (!run) {
            throw new Error('Import run not found');
        }

        if (run.status !== 'applied') {
            throw new Error('Only applied runs can be rolled back');
        }

        if (!run.rollbackSnapshot || (
            run.rollbackSnapshot.standards.length === 0
            && run.rollbackSnapshot.ingredients.length === 0
        )) {
            throw new Error('Rollback snapshot is missing for this run');
        }

        await rollbackRun(run);
        run.status = 'rolled_back';
        run.rolledBackAt = new Date();
        await run.save();

        return run;
    }
};

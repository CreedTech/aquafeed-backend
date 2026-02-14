import { INutrients } from '../models/Ingredient';
import { ITargetNutrients, INutrientRange } from '../models/FeedStandard';
import { ComplianceColor } from '../models/Formulation';

export interface ComplianceResult {
    color: ComplianceColor;
    qualityMatch: number;  // 0-100%
    deviations: NutrientDeviation[];
    violations?: string[]; // inclusion limit violations
}

export interface NutrientDeviation {
    nutrient: string;
    target: number | { min?: number; max?: number };
    actual: number;
    deviationPercent: number;
    status: 'Below' | 'Within' | 'Above';
}

/**
 * Compliance Checker Service
 * Compares formulation against AquaFeed Pro or other benchmarks
 * Returns color-coded compliance (Red/Blue/Green)
 */
export class ComplianceService {

    /**
     * Check compliance against a feed standard
     * 
     * @param actualNutrients - Calculated nutrients from formulation
     * @param targetNutrients - Benchmark standard (e.g., AquaFeed Pro)
     * @param tolerance - % deviation allowed (default 2%)
     * @returns ComplianceResult with color, quality match, and deviations
     */
    checkCompliance(
        actualNutrients: INutrients,
        targetNutrients: ITargetNutrients,
        tolerance: number = 2,
        ingredientMix?: { name: string; qtyKg: number; tags?: string[] }[],
        targetWeight?: number,
        categoryInfo?: { feedCategory: string; poultryType?: string }
    ): ComplianceResult {
        const deviations: NutrientDeviation[] = [];

        let totalDeviation = 0;
        let nutrientCount = 0;
        let belowCount = 0;
        let aboveCount = 0;

        // Check each nutrient
        const nutrients = ['protein', 'fat', 'carbohydrate', 'energy', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];

        nutrients.forEach(nutrient => {
            const targetRange = (targetNutrients as any)[nutrient] as INutrientRange | undefined;
            if (!targetRange) return;  // Skip if no target for this nutrient

            const actual = (actualNutrients as any)[nutrient] || 0;

            // Determine target value and acceptable range
            const { targetValue, minAcceptable, maxAcceptable } = this.calculateAcceptableRange(
                targetRange,
                tolerance
            );

            // Calculate deviation
            const deviationPercent = this.calculateDeviation(actual, targetValue);

            // Determine status
            let deviationStatus: 'Below' | 'Within' | 'Above';
            if (actual < minAcceptable) {
                deviationStatus = 'Below';
                belowCount++;
            } else if (actual > maxAcceptable) {
                deviationStatus = 'Above';
                aboveCount++;
            } else {
                deviationStatus = 'Within';
            }

            deviations.push({
                nutrient,
                target: targetRange.min !== undefined && targetRange.max !== undefined
                    ? { min: targetRange.min, max: targetRange.max }
                    : targetValue,
                actual,
                deviationPercent,
                status: deviationStatus
            });

            totalDeviation += Math.abs(deviationPercent);
            nutrientCount++;
        });

        // Add Inclusion Violations check would happen here if we had the ingredient mix
        // But ComplianceService usually only sees the final nutrient profile.
        // We'll extend checkCompliance to optionally take ingredientsUsed


        // Calculate quality match percentage
        const avgDeviation = nutrientCount > 0 ? totalDeviation / nutrientCount : 0;
        const qualityMatch = Math.max(0, 100 - avgDeviation);

        // NEW: Inclusion Violations
        const violations: string[] = [];
        if (ingredientMix && targetWeight && categoryInfo) {
            this.checkInclusionViolations(ingredientMix, targetWeight, categoryInfo, violations);
        }

        // Determine color code
        let color = this.determineColor(belowCount, aboveCount, nutrientCount);
        if (violations.length > 0) color = 'Red'; // Violations force Red status

        return {
            color,
            qualityMatch: Math.round(qualityMatch * 10) / 10,
            deviations,
            violations: violations.length > 0 ? violations : undefined
        };
    }

    private checkInclusionViolations(
        ingredientMix: { name: string; qtyKg: number; tags?: string[] }[],
        targetWeight: number,
        categoryInfo: { feedCategory: string; poultryType?: string },
        violations: string[]
    ) {
        const { feedCategory, poultryType } = categoryInfo;
        let totalAnimalProtein = 0;
        let bloodMealWeight = 0;

        ingredientMix.forEach(ing => {
            const name = ing.name.toUpperCase();
            const inclusionPct = (ing.qtyKg / targetWeight) * 100;
            const isAnimal = ing.tags?.includes('ANIMAL_PROTEIN') || name.includes('FISHMEAL') || name.includes('BLOOD MEAL');
            const isBloodMeal = name.includes('BLOOD MEAL');

            if (isAnimal) totalAnimalProtein += ing.qtyKg;
            if (isBloodMeal) bloodMealWeight += ing.qtyKg;

            // PKC Limits
            if (name.includes('PKC') || name.includes('PALM KERNEL')) {
                if (feedCategory === 'Poultry') {
                    if (poultryType === 'Broiler' && inclusionPct > 0) {
                        violations.push('PKC should not be used in Broiler feed.');
                    } else if (poultryType === 'Layer' && inclusionPct > 20) {
                        violations.push(`PKC inclusion (${inclusionPct.toFixed(1)}%) exceeds 20% limit for Layers.`);
                    }
                }
            }

            // Sorghum Limits
            if (name.includes('SORGHUM')) {
                if (feedCategory === 'Poultry' && inclusionPct > 15) {
                    violations.push(`Sorghum inclusion (${inclusionPct.toFixed(1)}%) exceeds 15% limit for Poultry.`);
                }
            }
        });

        // Animal Protein Min for Catfish
        if (feedCategory === 'Catfish') {
            const animalPct = (totalAnimalProtein / targetWeight) * 100;
            if (animalPct < 10) {
                violations.push(`Total Animal Protein (${animalPct.toFixed(1)}%) is below the 10% minimum for Catfish.`);
            }

            // Blood Meal ratio
            if (totalAnimalProtein > 0) {
                const bmRatio = (bloodMealWeight / totalAnimalProtein) * 100;
                if (bmRatio > 10) {
                    violations.push(`Blood Meal exceeds 10% of total animal protein (${bmRatio.toFixed(1)}%).`);
                }
            }
        }
    }

    /**
     * Calculate acceptable range based on target and tolerance
     */
    private calculateAcceptableRange(
        targetRange: INutrientRange,
        tolerance: number
    ): {
        targetValue: number;
        minAcceptable: number;
        maxAcceptable: number;
    } {
        let targetValue: number;
        let minAcceptable: number;
        let maxAcceptable: number;

        if (targetRange.min !== undefined && targetRange.max !== undefined) {
            // Range target (e.g., protein: 42-45%)
            targetValue = (targetRange.min + targetRange.max) / 2;
            minAcceptable = targetRange.min * (1 - tolerance / 100);
            maxAcceptable = targetRange.max * (1 + tolerance / 100);
        } else if (targetRange.min !== undefined) {
            // Minimum only (e.g., protein >= 42%)
            targetValue = targetRange.min;
            minAcceptable = targetRange.min * (1 - tolerance / 100);
            maxAcceptable = targetRange.min * (1 + tolerance / 100);
        } else if (targetRange.max !== undefined) {
            // Maximum only (e.g., fiber <= 3.5%)
            targetValue = targetRange.max;
            minAcceptable = 0; // For max-only (like fiber), being lower is fine, not a failure
            maxAcceptable = targetRange.max * (1 + tolerance / 100);
        } else {
            // Fallback
            targetValue = 0;
            minAcceptable = 0;
            maxAcceptable = 0;
        }

        return { targetValue, minAcceptable, maxAcceptable };
    }

    /**
     * Calculate percentage deviation from target
     */
    private calculateDeviation(actual: number, target: number): number {
        if (target === 0) return 0;
        return ((actual - target) / target) * 100;
    }

    /**
     * Determine color code based on compliance
     * 
     * 🔴 RED: One or more nutrients below standard
     * 🔵 BLUE: All nutrients within tolerance band (±2%)
     * 🟢 GREEN: All nutrients above standard (over-optimized)
     */
    private determineColor(
        belowCount: number,
        aboveCount: number,
        totalCount: number
    ): ComplianceColor {
        if (belowCount > 0) {
            // Any nutrient below = RED
            return 'Red';
        } else if (aboveCount === totalCount && totalCount > 0) {
            // All nutrients above = GREEN  
            return 'Green';
        } else {
            // Within tolerance = BLUE
            return 'Blue';
        }
    }

    /**
     * Generate human-readable compliance report
     */
    generateReport(result: ComplianceResult): string {
        const { color, qualityMatch, deviations } = result;

        let report = `Compliance Status: ${color}\n`;
        report += `Quality Match: ${qualityMatch}%\n\n`;
        report += `Nutrient Breakdown:\n`;
        report += `${'='.repeat(60)}\n`;

        deviations.forEach(dev => {
            const unit = dev.nutrient === 'energy' ? ' kcal/kg' : '%';

            const targetStr = typeof dev.target === 'number'
                ? `${dev.target.toFixed(0)}${unit}`
                : `${dev.target.min}-${dev.target.max}${unit}`;

            const statusIcon = dev.status === 'Below' ? '⬇️'
                : dev.status === 'Above' ? '⬆️'
                    : '✅';

            report += `${statusIcon} ${dev.nutrient}: ${dev.actual.toFixed(dev.nutrient === 'energy' ? 0 : 2)}${unit} (Target: ${targetStr}, Deviation: ${dev.deviationPercent.toFixed(1)}%)\n`;
        });

        return report;
    }
}

export default new ComplianceService();

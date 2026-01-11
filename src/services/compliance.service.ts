import { INutrients } from '../models/Ingredient';
import { ITargetNutrients, INutrientRange } from '../models/FeedStandard';
import { ComplianceColor } from '../models/Formulation';

export interface ComplianceResult {
    color: ComplianceColor;
    qualityMatch: number;  // 0-100%
    deviations: NutrientDeviation[];
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
        tolerance: number = 2
    ): ComplianceResult {
        const deviations: NutrientDeviation[] = [];

        let totalDeviation = 0;
        let nutrientCount = 0;
        let belowCount = 0;
        let aboveCount = 0;

        // Check each nutrient
        const nutrients = ['protein', 'fat', 'fiber', 'ash', 'lysine', 'methionine', 'calcium', 'phosphorous'];

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

        // Calculate quality match percentage
        const avgDeviation = nutrientCount > 0 ? totalDeviation / nutrientCount : 0;
        const qualityMatch = Math.max(0, 100 - avgDeviation);

        // Determine color code
        const color = this.determineColor(belowCount, aboveCount, nutrientCount);

        return {
            color,
            qualityMatch: Math.round(qualityMatch * 10) / 10,  // Round to 1 decimal
            deviations
        };
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
            minAcceptable = targetRange.max * (1 - tolerance / 100);
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
            const targetStr = typeof dev.target === 'number'
                ? `${dev.target.toFixed(2)}%`
                : `${dev.target.min}-${dev.target.max}%`;

            const statusIcon = dev.status === 'Below' ? '⬇️'
                : dev.status === 'Above' ? '⬆️'
                    : '✅';

            report += `${statusIcon} ${dev.nutrient}: ${dev.actual.toFixed(2)}% (Target: ${targetStr}, Deviation: ${dev.deviationPercent.toFixed(1)}%)\n`;
        });

        return report;
    }
}

export default new ComplianceService();

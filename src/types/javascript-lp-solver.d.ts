declare module 'javascript-lp-solver' {
    export interface LPModel {
        optimize: string;
        opType: string;
        constraints: Record<string, any>;
        variables: Record<string, any>;
        ints?: Record<string, number>;
    }

    export interface LPResult {
        feasible: boolean;
        result: number;
        [key: string]: any;
    }

    export function Solve(model: LPModel): LPResult;
}

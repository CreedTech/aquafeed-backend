/* auto-generated from Poultry Feed data2.xlsx */
export type WorkbookNutrientRange = { min: number; max: number };

export type WorkbookStandard = {
  stageCode: string;
  name: string;
  feedCategory: 'Poultry';
  poultryType: 'Broiler' | 'Layer';
  stage: string;
  ageGuidance: string;
  pelletSize: string;
  brand: string;
  sourceSheet: 'Poultry' | 'Sheet2';
  targetNutrients: Record<string, WorkbookNutrientRange>;
};

export type WorkbookIngredient = {
  name: string;
  category: string;
  nutrients: {
    protein: number;
    fat: number;
    fiber: number;
    ash: number;
    lysine: number;
    methionine: number;
    calcium: number;
    phosphorous: number;
    energy: number;
  };
};

export type PoultryWorkbookSnapshot = {
  workbook: string;
  version: string;
  generatedAt: string;
  standards: WorkbookStandard[];
  ingredients: WorkbookIngredient[];
  aliases: Record<string, string>;
};

export const poultryWorkbookSnapshot: PoultryWorkbookSnapshot = {
  "workbook": "Poultry Feed data2.xlsx",
  "version": "2026-03-03",
  "generatedAt": "2026-03-03T09:27:10.582442Z",
  "standards": [
    {
      "stageCode": "POULTRY_BROILER_STARTER",
      "name": "Broiler Starter",
      "feedCategory": "Poultry",
      "poultryType": "Broiler",
      "stage": "Starter",
      "ageGuidance": "0-10 days",
      "pelletSize": "Mash/Crumble",
      "brand": "Poultry Workbook",
      "sourceSheet": "Poultry",
      "targetNutrients": {
        "protein": {
          "min": 22,
          "max": 24
        },
        "fat": {
          "min": 5,
          "max": 7
        },
        "fiber": {
          "min": 2,
          "max": 3.5
        },
        "calcium": {
          "min": 0.9,
          "max": 1.05
        },
        "phosphorous": {
          "min": 0.45,
          "max": 0.5
        },
        "lysine": {
          "min": 1.28,
          "max": 1.45
        },
        "methionine": {
          "min": 0.5,
          "max": 0.55
        },
        "energy": {
          "min": 3000,
          "max": 3100
        }
      }
    },
    {
      "stageCode": "POULTRY_BROILER_GROWER",
      "name": "Broiler Grower",
      "feedCategory": "Poultry",
      "poultryType": "Broiler",
      "stage": "Grower",
      "ageGuidance": "11-28 days",
      "pelletSize": "Pellet",
      "brand": "Poultry Workbook",
      "sourceSheet": "Poultry",
      "targetNutrients": {
        "protein": {
          "min": 20,
          "max": 22
        },
        "fat": {
          "min": 6,
          "max": 8
        },
        "fiber": {
          "min": 3.0,
          "max": 4.5
        },
        "calcium": {
          "min": 0.85,
          "max": 0.95
        },
        "phosphorous": {
          "min": 0.4,
          "max": 0.45
        },
        "lysine": {
          "min": 1.15,
          "max": 1.25
        },
        "methionine": {
          "min": 0.45,
          "max": 0.5
        },
        "energy": {
          "min": 3100,
          "max": 3150
        }
      }
    },
    {
      "stageCode": "POULTRY_BROILER_FINISHER",
      "name": "Broiler Finisher",
      "feedCategory": "Poultry",
      "poultryType": "Broiler",
      "stage": "Finisher",
      "ageGuidance": "28 days-harvest",
      "pelletSize": "Pellet",
      "brand": "Poultry Workbook",
      "sourceSheet": "Poultry",
      "targetNutrients": {
        "protein": {
          "min": 18,
          "max": 19
        },
        "fat": {
          "min": 7,
          "max": 9
        },
        "fiber": {
          "min": 3.0,
          "max": 5.0
        },
        "calcium": {
          "min": 0.75,
          "max": 0.85
        },
        "phosphorous": {
          "min": 0.35,
          "max": 0.4
        },
        "lysine": {
          "min": 1.0,
          "max": 1.1
        },
        "methionine": {
          "min": 0.4,
          "max": 0.45
        },
        "energy": {
          "min": 3200,
          "max": 3200
        }
      }
    },
    {
      "stageCode": "POULTRY_LAYER_STARTER",
      "name": "Layer Starter",
      "feedCategory": "Poultry",
      "poultryType": "Layer",
      "stage": "Starter",
      "ageGuidance": "0-8 weeks",
      "pelletSize": "Mash",
      "brand": "Poultry Workbook",
      "sourceSheet": "Poultry",
      "targetNutrients": {
        "protein": {
          "min": 18,
          "max": 20
        },
        "fat": {
          "min": 3.0,
          "max": 5.0
        },
        "fiber": {
          "min": 3.0,
          "max": 5.0
        },
        "calcium": {
          "min": 0.9,
          "max": 1.1
        },
        "phosphorous": {
          "min": 0.42,
          "max": 0.48
        },
        "lysine": {
          "min": 1.0,
          "max": 1.0
        },
        "methionine": {
          "min": 0.45,
          "max": 0.45
        },
        "energy": {
          "min": 2850,
          "max": 2950
        }
      }
    },
    {
      "stageCode": "POULTRY_LAYER_GROWER",
      "name": "Layer Grower",
      "feedCategory": "Poultry",
      "poultryType": "Layer",
      "stage": "Grower",
      "ageGuidance": "6-18 weeks",
      "pelletSize": "Mash",
      "brand": "Poultry Workbook",
      "sourceSheet": "Poultry",
      "targetNutrients": {
        "protein": {
          "min": 15,
          "max": 17
        },
        "fat": {
          "min": 2.5,
          "max": 3.5
        },
        "fiber": {
          "min": 5.0,
          "max": 7.0
        },
        "calcium": {
          "min": 0.8,
          "max": 1.0
        },
        "phosphorous": {
          "min": 0.32,
          "max": 0.38
        },
        "lysine": {
          "min": 1.0,
          "max": 1.0
        },
        "methionine": {
          "min": 0.45,
          "max": 0.45
        },
        "energy": {
          "min": 2700,
          "max": 2850
        }
      }
    },
    {
      "stageCode": "POULTRY_LAYER_PRE_LAY",
      "name": "Layer Pre-Lay",
      "feedCategory": "Poultry",
      "poultryType": "Layer",
      "stage": "Pre-Lay",
      "ageGuidance": "16-18/19 weeks",
      "pelletSize": "Mash",
      "brand": "Poultry Workbook",
      "sourceSheet": "Sheet2",
      "targetNutrients": {
        "protein": {
          "min": 15.5,
          "max": 16.5
        },
        "fat": {
          "min": 2.5,
          "max": 4.0
        },
        "fiber": {
          "min": 3.5,
          "max": 6.0
        },
        "calcium": {
          "min": 2.0,
          "max": 2.5
        },
        "phosphorous": {
          "min": 0.55,
          "max": 0.65
        },
        "lysine": {
          "min": 0.75,
          "max": 0.82
        },
        "methionine": {
          "min": 0.34,
          "max": 0.38
        },
        "energy": {
          "min": 2750,
          "max": 2800
        }
      }
    },
    {
      "stageCode": "POULTRY_LAYER_PHASE_1",
      "name": "Layer Phase 1",
      "feedCategory": "Poultry",
      "poultryType": "Layer",
      "stage": "Phase 1",
      "ageGuidance": "20-45 weeks (peak)",
      "pelletSize": "Mash",
      "brand": "Poultry Workbook",
      "sourceSheet": "Sheet2",
      "targetNutrients": {
        "protein": {
          "min": 16.5,
          "max": 17.5
        },
        "fat": {
          "min": 3.0,
          "max": 4.5
        },
        "fiber": {
          "min": 3.0,
          "max": 5.5
        },
        "calcium": {
          "min": 3.8,
          "max": 4.2
        },
        "phosphorous": {
          "min": 0.5,
          "max": 0.6
        },
        "lysine": {
          "min": 0.82,
          "max": 0.92
        },
        "methionine": {
          "min": 0.4,
          "max": 0.46
        },
        "energy": {
          "min": 2700,
          "max": 2850
        }
      }
    },
    {
      "stageCode": "POULTRY_LAYER_PHASE_2",
      "name": "Layer Phase 2",
      "feedCategory": "Poultry",
      "poultryType": "Layer",
      "stage": "Phase 2",
      "ageGuidance": "45-65 weeks",
      "pelletSize": "Mash",
      "brand": "Poultry Workbook",
      "sourceSheet": "Sheet2",
      "targetNutrients": {
        "protein": {
          "min": 15.5,
          "max": 16.5
        },
        "fat": {
          "min": 2.5,
          "max": 3.5
        },
        "fiber": {
          "min": 3.5,
          "max": 6.0
        },
        "calcium": {
          "min": 4.2,
          "max": 4.5
        },
        "phosphorous": {
          "min": 0.5,
          "max": 0.6
        },
        "lysine": {
          "min": 0.82,
          "max": 0.92
        },
        "methionine": {
          "min": 0.4,
          "max": 0.46
        },
        "energy": {
          "min": 2700,
          "max": 2850
        }
      }
    },
    {
      "stageCode": "POULTRY_LAYER_PHASE_3",
      "name": "Layer Phase 3",
      "feedCategory": "Poultry",
      "poultryType": "Layer",
      "stage": "Phase 3",
      "ageGuidance": "65+ weeks",
      "pelletSize": "Mash",
      "brand": "Poultry Workbook",
      "sourceSheet": "Sheet2",
      "targetNutrients": {
        "protein": {
          "min": 14.5,
          "max": 15.5
        },
        "fat": {
          "min": 2.5,
          "max": 3.5
        },
        "fiber": {
          "min": 3.5,
          "max": 6.0
        },
        "calcium": {
          "min": 4.2,
          "max": 4.5
        },
        "phosphorous": {
          "min": 0.5,
          "max": 0.6
        },
        "lysine": {
          "min": 0.82,
          "max": 0.92
        },
        "methionine": {
          "min": 0.4,
          "max": 0.46
        },
        "energy": {
          "min": 2700,
          "max": 2850
        }
      }
    }
  ],
  "ingredients": [
    {
      "name": "MAIZE",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 10.0,
        "fat": 4.0,
        "fiber": 2.0,
        "ash": 1.3,
        "lysine": 0.25,
        "methionine": 0.18,
        "calcium": 0.01,
        "phosphorous": 0.09,
        "energy": 3500.0
      }
    },
    {
      "name": "GUINEA CORN",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 11.0,
        "fat": 3.0,
        "fiber": 2.0,
        "ash": 0.0,
        "lysine": 0.35,
        "methionine": 0.1,
        "calcium": 0.04,
        "phosphorous": 0.32,
        "energy": 3200.0
      }
    },
    {
      "name": "MILLET",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 10.0,
        "fat": 3.6,
        "fiber": 8.0,
        "ash": 3.2,
        "lysine": 0.4,
        "methionine": 0.18,
        "calcium": 0.02,
        "phosphorous": 0.1,
        "energy": 3500.0
      }
    },
    {
      "name": "WHOLE WHEAT",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 11.5,
        "fat": 2.0,
        "fiber": 2.0,
        "ash": 2.0,
        "lysine": 0.33,
        "methionine": 0.18,
        "calcium": 0.02,
        "phosphorous": 0.06,
        "energy": 3400.0
      }
    },
    {
      "name": "MOLASSES",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 3.0,
        "fat": 0.1,
        "fiber": 0.0,
        "ash": 9.5,
        "lysine": 0.5,
        "methionine": 0.01,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 2100.0
      }
    },
    {
      "name": "CASSAVA MEAL",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 2.5,
        "fat": 0.5,
        "fiber": 7.6,
        "ash": 3.0,
        "lysine": 0.07,
        "methionine": 0.03,
        "calcium": 0.2,
        "phosphorous": 0.03,
        "energy": 2800.0
      }
    },
    {
      "name": "SORGHUM",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 9.5,
        "fat": 3.0,
        "fiber": 3.0,
        "ash": 1.7,
        "lysine": 0.23,
        "methionine": 0.15,
        "calcium": 0.03,
        "phosphorous": 0.09,
        "energy": 3100.0
      }
    },
    {
      "name": "INDOMIE WASTE",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 10.24,
        "fat": 16.38,
        "fiber": 2.0,
        "ash": 1.5,
        "lysine": 0.25,
        "methionine": 0.19,
        "calcium": 0.03,
        "phosphorous": 0.27,
        "energy": 3300.0
      }
    },
    {
      "name": "COCONUT SEED",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 10.9,
        "fat": 65.9,
        "fiber": 7.2,
        "ash": 2.34,
        "lysine": 0.26,
        "methionine": 0.14,
        "calcium": 0.03,
        "phosphorous": 0.08,
        "energy": 3540.0
      }
    },
    {
      "name": "COCOYAM UNPEELED",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 6.6,
        "fat": 0.77,
        "fiber": 2.38,
        "ash": 4.83,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 1120.0
      }
    },
    {
      "name": "COCOYAM PEELED",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 7.57,
        "fat": 0.35,
        "fiber": 1.63,
        "ash": 4.04,
        "lysine": 0.3,
        "methionine": 0.1,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 1200.0
      }
    },
    {
      "name": "POTATO IRISH",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 10.8,
        "fat": 0.0,
        "fiber": 2.3,
        "ash": 4.7,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.08,
        "phosphorous": 0.22,
        "energy": 1067.0
      }
    },
    {
      "name": "POTATO SWEET",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 6.06,
        "fat": 0.54,
        "fiber": 0.33,
        "ash": 3.71,
        "lysine": 0.23,
        "methionine": 0.09,
        "calcium": 0.02,
        "phosphorous": 0.02,
        "energy": 860.0
      }
    },
    {
      "name": "CARROT",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 10.1,
        "fat": 1.6,
        "fiber": 9.2,
        "ash": 0.1,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.42,
        "phosphorous": 0.34,
        "energy": 410.0
      }
    },
    {
      "name": "ACHA",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 7.42,
        "fat": 1.3,
        "fiber": 0.35,
        "ash": 2.74,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.08,
        "phosphorous": 0.32,
        "energy": 1200.0
      }
    },
    {
      "name": "WHEAT FLOUR",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 16.27,
        "fat": 1.76,
        "fiber": 1.36,
        "ash": 1.01,
        "lysine": 0.25,
        "methionine": 0.18,
        "calcium": 0.04,
        "phosphorous": 0.24,
        "energy": 3400.0
      }
    },
    {
      "name": "BARLEY",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 11.0,
        "fat": 1.9,
        "fiber": 5.0,
        "ash": 2.5,
        "lysine": 0.3,
        "methionine": 0.15,
        "calcium": 0.05,
        "phosphorous": 0.12,
        "energy": 2700.0
      }
    },
    {
      "name": "OATS",
      "category": "CARBOHYDRATE",
      "nutrients": {
        "protein": 12.0,
        "fat": 4.5,
        "fiber": 2.3,
        "ash": 1.8,
        "lysine": 0.07,
        "methionine": 0.17,
        "calcium": 0.7,
        "phosphorous": 0.1,
        "energy": 2900.0
      }
    },
    {
      "name": "FULL FAT SOYA",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 42.0,
        "fat": 20.0,
        "fiber": 4.5,
        "ash": 4.6,
        "lysine": 2.8,
        "methionine": 0.65,
        "calcium": 0.2,
        "phosphorous": 0.5,
        "energy": 4360.0
      }
    },
    {
      "name": "SOYACAKE",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 48.0,
        "fat": 6.0,
        "fiber": 4.25,
        "ash": 1.45,
        "lysine": 2.8,
        "methionine": 0.6,
        "calcium": 0.2,
        "phosphorous": 0.5,
        "energy": 2450.0
      }
    },
    {
      "name": "GROUNDNUT CAKE",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 45.0,
        "fat": 6.0,
        "fiber": 3.81,
        "ash": 5.5,
        "lysine": 1.6,
        "methionine": 0.48,
        "calcium": 0.2,
        "phosphorous": 0.2,
        "energy": 2600.0
      }
    },
    {
      "name": "SOYABEAN MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 48.0,
        "fat": 3.5,
        "fiber": 6.5,
        "ash": 0.0,
        "lysine": 2.8,
        "methionine": 0.59,
        "calcium": 0.2,
        "phosphorous": 0.5,
        "energy": 2220.0
      }
    },
    {
      "name": "SUNFLOWER MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 37.0,
        "fat": 1.0,
        "fiber": 18.0,
        "ash": 0.5,
        "lysine": 1.6,
        "methionine": 1.3,
        "calcium": 0.5,
        "phosphorous": 0.3,
        "energy": 2240.0
      }
    },
    {
      "name": "COTTON SEED MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 25.0,
        "fat": 9.0,
        "fiber": 25.0,
        "ash": 6.3,
        "lysine": 1.15,
        "methionine": 0.4,
        "calcium": 0.25,
        "phosphorous": 0.3,
        "energy": 1110.0
      }
    },
    {
      "name": "RAPSEED MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 32.0,
        "fat": 1.8,
        "fiber": 13.0,
        "ash": 0.6,
        "lysine": 2.0,
        "methionine": 0.6,
        "calcium": 0.7,
        "phosphorous": 0.25,
        "energy": 4100.0
      }
    },
    {
      "name": "FISHMEAL 72%",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 42.0,
        "fat": 4.5,
        "fiber": 1.0,
        "ash": 17.0,
        "lysine": 4.5,
        "methionine": 1.8,
        "calcium": 6.1,
        "phosphorous": 3.0,
        "energy": 2400.0
      }
    },
    {
      "name": "FISHMEAL 65%",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 60.0,
        "fat": 4.5,
        "fiber": 1.0,
        "ash": 17.0,
        "lysine": 4.5,
        "methionine": 1.8,
        "calcium": 6.1,
        "phosphorous": 3.0,
        "energy": 2720.0
      }
    },
    {
      "name": "BLOOD MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 80.0,
        "fat": 1.3,
        "fiber": 2.4,
        "ash": 4.4,
        "lysine": 5.99,
        "methionine": 0.91,
        "calcium": 0.27,
        "phosphorous": 0.26,
        "energy": 2690.0
      }
    },
    {
      "name": "MILK POWDER",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 25.0,
        "fat": 0.5,
        "fiber": 0.0,
        "ash": 2.2,
        "lysine": 2.5,
        "methionine": 0.9,
        "calcium": 1.25,
        "phosphorous": 0.2,
        "energy": 3500.0
      }
    },
    {
      "name": "MEAT MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 56.0,
        "fat": 4.8,
        "fiber": 2.0,
        "ash": 22.5,
        "lysine": 2.6,
        "methionine": 0.75,
        "calcium": 8.5,
        "phosphorous": 3.9,
        "energy": 2500.0
      }
    },
    {
      "name": "SHRIMP",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 31.0,
        "fat": 4.9,
        "fiber": 7.2,
        "ash": 0.0,
        "lysine": 1.54,
        "methionine": 0.57,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 990.0
      }
    },
    {
      "name": "BREWERS YEAST",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 30.0,
        "fat": 1.0,
        "fiber": 3.0,
        "ash": 5.5,
        "lysine": 3.4,
        "methionine": 0.7,
        "calcium": 0.1,
        "phosphorous": 0.46,
        "energy": 320.0
      }
    },
    {
      "name": "CHAD FISH",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 25.0,
        "fat": 19.58,
        "fiber": 4.38,
        "ash": 0.0,
        "lysine": 3.8,
        "methionine": 1.5,
        "calcium": 2.89,
        "phosphorous": 2.37,
        "energy": 1000.0
      }
    },
    {
      "name": "LOCUST BEAN SEED",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 30.86,
        "fat": 20.3,
        "fiber": 8.82,
        "ash": 5.28,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.31,
        "phosphorous": 0.26,
        "energy": 2100.0
      }
    },
    {
      "name": "CASHEW NUT",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 20.0,
        "fat": 38.0,
        "fiber": 0.8,
        "ash": 3.3,
        "lysine": 0.9,
        "methionine": 0.3,
        "calcium": 0.04,
        "phosphorous": 0.88,
        "energy": 4200.0
      }
    },
    {
      "name": "COWPEA SEED",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 24.67,
        "fat": 2.46,
        "fiber": 1.81,
        "ash": 3.78,
        "lysine": 1.56,
        "methionine": 0.47,
        "calcium": 0.07,
        "phosphorous": 0.45,
        "energy": 3300.0
      }
    },
    {
      "name": "GRASSHOPPER",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 26.8,
        "fat": 3.8,
        "fiber": 2.4,
        "ash": 1.2,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.04,
        "phosphorous": 0.0,
        "energy": 3500.0
      }
    },
    {
      "name": "FEATHER MEAL",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 85.0,
        "fat": 2.5,
        "fiber": 1.5,
        "ash": 3.3,
        "lysine": 1.7,
        "methionine": 0.7,
        "calcium": 9.2,
        "phosphorous": 7.8,
        "energy": 2350.0
      }
    },
    {
      "name": "EGG",
      "category": "PROTEIN",
      "nutrients": {
        "protein": 11.1,
        "fat": 0.2,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.74,
        "methionine": 0.47,
        "calcium": 0.0011,
        "phosphorous": 0.02,
        "energy": 1350.0
      }
    },
    {
      "name": "BREWERS DRY GRAIN",
      "category": "FIBER",
      "nutrients": {
        "protein": 18.0,
        "fat": 6.0,
        "fiber": 20.0,
        "ash": 4.8,
        "lysine": 0.9,
        "methionine": 0.4,
        "calcium": 0.2,
        "phosphorous": 0.15,
        "energy": 1000.0
      }
    },
    {
      "name": "WHEAT OFFALS/MIDDLINGS",
      "category": "FIBER",
      "nutrients": {
        "protein": 16.0,
        "fat": 3.5,
        "fiber": 8.5,
        "ash": 3.3,
        "lysine": 0.9,
        "methionine": 0.25,
        "calcium": 0.1,
        "phosphorous": 0.3,
        "energy": 1300.0
      }
    },
    {
      "name": "MAIZE OFFALS",
      "category": "FIBER",
      "nutrients": {
        "protein": 11.0,
        "fat": 2.8,
        "fiber": 12.0,
        "ash": 0.8,
        "lysine": 0.25,
        "methionine": 0.18,
        "calcium": 0.01,
        "phosphorous": 0.09,
        "energy": 2200.0
      }
    },
    {
      "name": "PALM KERNEL CAKE",
      "category": "FIBER",
      "nutrients": {
        "protein": 18.0,
        "fat": 6.0,
        "fiber": 12.0,
        "ash": 4.8,
        "lysine": 0.64,
        "methionine": 0.39,
        "calcium": 0.21,
        "phosphorous": 0.16,
        "energy": 1400.0
      }
    },
    {
      "name": "RICE BRAN",
      "category": "FIBER",
      "nutrients": {
        "protein": 12.0,
        "fat": 12.5,
        "fiber": 12.5,
        "ash": 10.0,
        "lysine": 0.5,
        "methionine": 0.24,
        "calcium": 0.04,
        "phosphorous": 1.46,
        "energy": 2000.0
      }
    },
    {
      "name": "COCOYAM PEELS(DRY)",
      "category": "FIBER",
      "nutrients": {
        "protein": 9.5,
        "fat": 2.05,
        "fiber": 32.02,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 200.0
      }
    },
    {
      "name": "COWPEA HAY",
      "category": "FIBER",
      "nutrients": {
        "protein": 18.2,
        "fat": 1.83,
        "fiber": 27.39,
        "ash": 0.77,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 1.52,
        "phosphorous": 0.37,
        "energy": 1800.0
      }
    },
    {
      "name": "COWPEA HUSK",
      "category": "FIBER",
      "nutrients": {
        "protein": 12.9,
        "fat": 0.65,
        "fiber": 33.4,
        "ash": 2.2,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 7.14,
        "energy": 1720.0
      }
    },
    {
      "name": "SORGHUM OFFALS",
      "category": "FIBER",
      "nutrients": {
        "protein": 9.0,
        "fat": 5.0,
        "fiber": 9.0,
        "ash": 6.6,
        "lysine": 0.25,
        "methionine": 0.18,
        "calcium": 0.1,
        "phosphorous": 0.09,
        "energy": 1800.0
      }
    },
    {
      "name": "OYSTER SHELL",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 38.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "BONE MEAL",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 11.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 37.0,
        "phosphorous": 15.0,
        "energy": 0.0
      }
    },
    {
      "name": "LIMESTONE",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 36.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "SALT",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "LYSINE",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 99.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "METHIONINE",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 99.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "FISH PREMIX",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "VIAMIN C",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 0.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "DICALCIUM PHOSPHATE",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 24.0,
        "phosphorous": 18.0,
        "energy": 0.0
      }
    },
    {
      "name": "PALM OIL",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 98.9,
        "fiber": 0.0,
        "ash": 0.1,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 6.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "CALCIUM",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 99.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    },
    {
      "name": "CALCIUM",
      "category": "MINERALS",
      "nutrients": {
        "protein": 0.0,
        "fat": 0.0,
        "fiber": 0.0,
        "ash": 0.0,
        "lysine": 0.0,
        "methionine": 0.0,
        "calcium": 99.0,
        "phosphorous": 0.0,
        "energy": 0.0
      }
    }
  ],
  "aliases": {
    "WHEAT OFFALS/MIDDLINGS": "WHEAT OFFALS",
    "COCOYAM PEELS(DRY)": "COCOYAM PEELS",
    "VIAMIN C": "VITAMIN C"
  }
} as const;

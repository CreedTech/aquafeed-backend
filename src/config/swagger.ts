export const openApiSpec = {
    openapi: '3.1.0',
    info: {
        title: 'AquaFeed Pro API',
        version: '1.0.0',
        description: `
# Intelligent Fish Feed Formulation System

**Linear Programming Based Cost Optimization for Nigerian Aquaculture**

## Features
-  Linear Programming Solver (Simplex Algorithm)
-  58 Nigerian Ingredients with Complete Nutritional Profiles
-  8-Parameter Nutritional Analysis
-  Coppens Benchmarking (Red/Blue/Green Compliance)
-  Cost Optimization with Bag Rounding
-  Alternative Ingredient Suggestions
-  Batch & Inventory Management
-  Wallet & Payment System (Paystack)
-  Role-Based Access Control (Admin/User)

## Technology Stack
Node.js, Express, TypeScript, MongoDB, javascript-lp-solver
    `,
        contact: {
            name: 'AquaFeed Pro Support',
            email: 'support@aquafeedpro.com'
        }
    },
    servers: [
        {
            url: 'http://localhost:5001',
            description: 'Development Server'
        },
        {
            url: 'https://aquafeed-backend.vercel.app',
            description: 'Production Server'
        }
    ],
    tags: [
        { name: 'Auth', description: 'Authentication & Session Management' },
        { name: 'Ingredients', description: '58 Nigerian fish feed ingredients database' },
        { name: 'Formulations', description: 'The "Joggler" - Linear Programming Feed Calculator' },
        { name: 'Inventory', description: 'Raw material stock management' },
        { name: 'Batches', description: 'Production cycle tracking (FCR, Growth)' },
        { name: 'Payments', description: 'Wallet top-up & Transaction History' },
        { name: 'Admin', description: 'System administration & User management' },
        { name: 'Standards', description: 'Feed nutritional standards' }
    ],
    paths: {
        // --- AUTH ---
        '/api/v1/auth/request-otp': {
            post: {
                tags: ['Auth'],
                summary: 'Request OTP',
                requestBody: {
                    content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'OTP sent successfully' } }
            }
        },
        '/api/v1/auth/verify-otp': {
            post: {
                tags: ['Auth'],
                summary: 'Verify OTP',
                requestBody: {
                    content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, otp: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Login successful' } }
            }
        },
        '/api/v1/auth/me': {
            get: {
                tags: ['Auth'],
                summary: 'Get Current User',
                responses: { 200: { description: 'User profile' } }
            }
        },
        '/api/v1/auth/logout': {
            post: {
                tags: ['Auth'],
                summary: 'Logout',
                responses: { 200: { description: 'Logged out' } }
            }
        },

        // --- INVENTORY ---
        '/api/v1/inventory': {
            get: {
                tags: ['Inventory'],
                summary: 'Get Inventory',
                responses: { 200: { description: 'List of stock items' } }
            },
            post: {
                tags: ['Inventory'],
                summary: 'Add Stock',
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/AddStockRequest' } } }
                },
                responses: { 201: { description: 'Stock added' } }
            }
        },
        '/api/v1/inventory/deduct': {
            post: {
                tags: ['Inventory'],
                summary: 'Deduct Stock (Usage)',
                requestBody: {
                    content: { 'application/json': { schema: { type: 'object', properties: { ingredientId: { type: 'string' }, quantityKg: { type: 'number' }, reason: { type: 'string' } } } } }
                },
                responses: { 200: { description: 'Stock deducted' } }
            }
        },

        // --- BATCHES ---
        '/api/v1/batches': {
            get: {
                tags: ['Batches'],
                summary: 'List Batches',
                responses: { 200: { description: 'List of active/harvested batches' } }
            },
            post: {
                tags: ['Batches'],
                summary: 'Create Batch',
                requestBody: {
                    content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateBatchRequest' } } }
                },
                responses: { 201: { description: 'Batch created' } }
            }
        },
        '/api/v1/batches/{id}/feed': {
            post: {
                tags: ['Batches'],
                summary: 'Log Feeding',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    content: { 'application/json': { schema: { type: 'object', properties: { feedAmountKg: { type: 'number' } } } } }
                },
                responses: { 200: { description: 'Feeding logged, FCR updated' } }
            }
        },
        '/api/v1/batches/{id}/biomass': {
            patch: {
                tags: ['Batches'],
                summary: 'Update Biomass (Weighing)',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    content: { 'application/json': { schema: { type: 'object', properties: { measuredWeightKg: { type: 'number' }, currentFishCount: { type: 'number' } } } } }
                },
                responses: { 200: { description: 'Biomass and FCR updated' } }
            }
        },
        '/api/v1/batches/{id}/harvest': {
            post: {
                tags: ['Batches'],
                summary: 'Harvest/Close Batch',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Batch closed' } }
            }
        },

        // --- PAYMENTS ---
        '/api/v1/payments/deposit': {
            post: {
                tags: ['Payments'],
                summary: 'Initialize Deposit',
                requestBody: {
                    content: { 'application/json': { schema: { type: 'object', properties: { amount: { type: 'number', example: 5000 } } } } }
                },
                responses: { 200: { description: 'Paystack authorization URL returned' } }
            }
        },
        '/api/v1/payments/verify': {
            get: {
                tags: ['Payments'],
                summary: 'Verify Payment',
                parameters: [{ name: 'reference', in: 'query', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'Payment verified, wallet credited' } }
            }
        },
        '/api/v1/payments/transactions': {
            get: {
                tags: ['Payments'],
                summary: 'Transaction History',
                responses: { 200: { description: 'User transactions' } }
            }
        },

        // --- ADMIN ---
        '/api/v1/admin/users': {
            get: {
                tags: ['Admin'],
                summary: 'List All Users',
                responses: { 200: { description: 'Paginated user list' } }
            }
        },
        '/api/v1/admin/users/{id}/block': {
            patch: {
                tags: ['Admin'],
                summary: 'Block/Unblock User',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { 200: { description: 'User status updated' } }
            }
        },
        '/api/v1/admin/stats': {
            get: {
                tags: ['Admin'],
                summary: 'System Statistics',
                responses: { 200: { description: 'Key metrics (users, revenue, farms)' } }
            }
        },
        '/api/v1/admin/ingredients': {
            post: {
                tags: ['Admin'],
                summary: 'Create Master Ingredient',
                requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Ingredient' } } } },
                responses: { 201: { description: 'Ingredient created' } }
            }
        },

        // --- EXISTING ENDPOINTS ---
        '/api/v1/ingredients': {
            get: {
                tags: ['Ingredients'],
                summary: 'Get all ingredients',
                responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { ingredients: { type: 'array', items: { $ref: '#/components/schemas/Ingredient' } } } } } } } }
            }
        },
        '/api/v1/formulations/calculate': {
            post: {
                tags: ['Formulations'],
                summary: 'Calculate Formulation',
                requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/FormulationRequest' } } } },
                responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/FormulationResponse' } } } } }
            }
        }
    },
    components: {
        schemas: {
            AddStockRequest: {
                type: 'object',
                required: ['ingredientId', 'quantityKg', 'pricePerKg'],
                properties: {
                    ingredientId: { type: 'string' },
                    quantityKg: { type: 'number', min: 0 },
                    pricePerKg: { type: 'number', min: 0 }
                }
            },
            CreateBatchRequest: {
                type: 'object',
                required: ['name', 'pondId', 'initialFishCount'],
                properties: {
                    name: { type: 'string' },
                    pondId: { type: 'number' },
                    initialFishCount: { type: 'number' },
                    formulationId: { type: 'string' }
                }
            },
            Ingredient: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    category: { type: 'string' },
                    nutrients: { type: 'object' },
                    defaultPrice: { type: 'number' }
                }
            },
            FormulationRequest: {
                type: 'object',
                required: ['targetWeightKg', 'selectedIngredients'],
                properties: {
                    targetWeightKg: { type: 'number' },
                    selectedIngredients: { type: 'array', items: { type: 'object' } }
                }
            },
            FormulationResponse: {
                type: 'object',
                properties: {
                    totalCost: { type: 'number' },
                    costPerKg: { type: 'number' },
                    isUnlocked: { type: 'boolean' }
                }
            }
        }
    }
};

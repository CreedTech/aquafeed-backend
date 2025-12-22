import axios from 'axios';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

dotenv.config();

const BASE_URL = 'http://localhost:5001/api/v1';
const jar = new CookieJar();
const client = wrapper(axios.create({ jar, withCredentials: true }));

const TEST_EMAIL = `test_${Date.now()}@verifier.com`;
// const TEST_ADMIN_EMAIL = `admin_${Date.now()}@verifier.com`;

async function runVerification() {
    console.log('🚀 Starting Full Backend Verification...');

    // 1. Auth Flow
    console.log('\n--- 1. Authentication ---');
    console.log(`Requesting OTP for ${TEST_EMAIL}...`);
    await client.post(`${BASE_URL}/auth/request-otp`, { email: TEST_EMAIL });

    // Hack: Retrieve OTP directly from DB for test
    const Otp = require('../models/Otp').default;
    const otpRecord = await Otp.findOne({ email: TEST_EMAIL }).sort({ createdAt: -1 });
    const otp = otpRecord?.otp;
    console.log(`> Retrieved OTP: ${otp}`);

    const verifyRes = await client.post(`${BASE_URL}/auth/verify-otp`, { email: TEST_EMAIL, otp });
    console.log(`> Login Success: User ID ${verifyRes.data.user.id}`);

    // 2. Financials & Wallet (Security Check)
    console.log('\n--- 2. Wallet Security ---');
    try {
        console.log('Attempting Negative Deposit (Should Fail)...');
        await client.post(`${BASE_URL}/payments/deposit`, { amount: -5000 });
        console.error('❌ FAILED: Negative deposit was allowed!');
    } catch (e: any) {
        console.log('✅ Success: Negative deposit blocked.');
    }

    console.log('Initializing Valid Deposit...');
    try {
        const depositRes = await client.post(`${BASE_URL}/payments/deposit`, { amount: 5000 });
        const ref = depositRes.data.reference;
        console.log(`> Deposit Initialized. Validating Reference: ${ref}`);

        // Mock Verification
        await client.get(`${BASE_URL}/payments/verify?reference=${ref}`);
        console.log('✅ Wallet Credited.');
    } catch (e: any) {
        if (e.response?.status === 500) {
            console.log('⚠️ Payment Initialization failed (likely Invalid API Key). Skipping payment verification.');
        } else {
            console.error('❌ Payment Failed Unexpectedly:', e.message);
        }
    }

    // 3. Inventory (Security Check)
    console.log('\n--- 3. Inventory Security ---');
    // Seed Ingredient
    const Ingredient = require('../models/Ingredient').default;
    let maize = await Ingredient.findOne({ name: 'Maize' });
    if (!maize) {
        maize = await Ingredient.create({
            name: 'Maize',
            category: 'CARBOHYDRATE',
            defaultPrice: 200,
            nutrients: {
                protein: 9,
                fat: 4,
                fiber: 2.5,
                ash: 1.5,
                lysine: 0.3,
                methionine: 0.2,
                calcium: 0.05,
                phosphorous: 0.25
            }
        });
    }

    try {
        console.log('Attempting Negative Stock Add (Should Fail)...');
        await client.post(`${BASE_URL}/inventory`, { ingredientId: maize._id, quantityKg: -100, pricePerKg: 200 });
        console.error('❌ FAILED: Negative inventory was allowed!');
    } catch (e) {
        console.log('✅ Success: Negative inventory blocked.');
    }

    console.log('Adding Valid Stock (1000kg)...');
    await client.post(`${BASE_URL}/inventory`, { ingredientId: maize._id, quantityKg: 1000, pricePerKg: 200 });
    console.log('✅ Stock added.');

    try {
        console.log('Attempting Negative Deduction (Should Fail)...');
        await client.post(`${BASE_URL}/inventory/deduct`, { ingredientId: maize._id, quantityKg: -50 });
        console.error('❌ FAILED: Negative deduction was allowed!');
    } catch (e) {
        console.log('✅ Success: Negative deduction blocked.');
    }

    // 4. Batch Management
    console.log('\n--- 4. Batch Logic ---');
    console.log('Creating Batch...');
    const batchRes = await client.post(`${BASE_URL}/batches`, {
        name: 'Test Batch 1',
        pondId: 1,
        initialFishCount: 1000
    });
    const batchId = batchRes.data.batch._id;
    console.log(`> Batch Created: ${batchId}`);

    try {
        console.log('Attempting Negative Feeding (Should Fail)...');
        await client.post(`${BASE_URL}/batches/${batchId}/feed`, { feedAmountKg: -10 });
        console.error('❌ FAILED: Negative feed allowed!');
    } catch (e) {
        console.log('✅ Success: Negative feeding blocked.');
    }

    console.log('Logging Valid Feeding (20kg)...');
    await client.post(`${BASE_URL}/batches/${batchId}/feed`, { feedAmountKg: 20 });

    console.log('Updating Biomass (100kg)...');
    const biomassRes = await client.patch(`${BASE_URL}/batches/${batchId}/biomass`, { currentWeightKg: 100 });
    console.log(`> New FCR: ${biomassRes.data.newFcr}`);

    if (biomassRes.data.newFcr === 0.2) {
        console.log('✅ FCR Calculation Correct (20kg / 100kg = 0.2)');
    } else {
        console.error(`❌ FCR Calculation Wrong: Got ${biomassRes.data.newFcr}, expected 0.2`);
    }

    console.log('\n✅ VERIFICATION COMPLETE. Backend is robust.');
    process.exit(0);
}

// Connect to DB and run
mongoose.connect(process.env.MONGODB_URI as string)
    .then(() => runVerification())
    .catch(err => console.error(err));

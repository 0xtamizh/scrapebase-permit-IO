const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:8080';

// Test credentials (replace with actual API keys)
const CREDENTIALS = {
    admin: process.env.ADMIN_API_KEY,
    pro: process.env.PRO_API_KEY,
    free: process.env.FREE_API_KEY
};

// Test scenarios
const scenarios = [
    {
        name: 'Free User - Basic Scrape (Allowed Domain)',
        credentials: 'free',
        url: 'https://example.com',
        options: { depth: 1 }
    },
    {
        name: 'Free User - Advanced Scrape (Should Fail)',
        credentials: 'free',
        url: 'https://example.com',
        options: { depth: 2, javascript: true }
    },
    {
        name: 'Free User - Restricted Domain (Should Fail)',
        credentials: 'free',
        url: 'https://restricted.com',
        options: { depth: 1 }
    },
    {
        name: 'Pro User - Advanced Scrape',
        credentials: 'pro',
        url: 'https://example.com',
        options: { depth: 2, javascript: true }
    },
    {
        name: 'Pro User - Custom Scripts',
        credentials: 'pro',
        url: 'https://example.com',
        options: { customScripts: true }
    },
    {
        name: 'Admin - Full Access',
        credentials: 'admin',
        url: 'https://example.com',
        options: { depth: 3, javascript: true, customScripts: true }
    }
];

async function runTest(scenario) {
    console.log(`\nTesting: ${scenario.name}`);
    console.log('----------------------------------------');
    
    try {
        const response = await axios.post(
            `${API_URL}/api/processLinks`,
            {
                url: scenario.url,
                options: scenario.options
            },
            {
                headers: {
                    'x-api-key': CREDENTIALS[scenario.credentials],
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✅ Success!');
        console.log('Response:', response.data);
    } catch (error) {
        if (error.response) {
            console.log('❌ Failed as expected:', error.response.data.error);
        } else {
            console.error('❌ Unexpected error:', error.message);
        }
    }
}

async function runAllTests() {
    console.log('🚀 Starting Permit.io Authorization Demo');
    console.log('========================================');
    
    for (const scenario of scenarios) {
        await runTest(scenario);
    }
    
    // Test rate limiting
    console.log('\nTesting Rate Limiting');
    console.log('----------------------------------------');
    
    const requests = Array(150).fill({
        url: 'https://example.com',
        options: { depth: 1 }
    });
    
    let successCount = 0;
    let failCount = 0;
    
    for (const request of requests) {
        try {
            await axios.post(
                `${API_URL}/api/processLinks`,
                request,
                {
                    headers: {
                        'x-api-key': CREDENTIALS.free,
                        'Content-Type': 'application/json'
                    }
                }
            );
            successCount++;
        } catch (error) {
            if (error.response?.data?.error?.includes('limit')) {
                failCount++;
            }
        }
    }
    
    console.log(`Rate Limiting Results:`);
    console.log(`- Successful requests: ${successCount}`);
    console.log(`- Rate limited requests: ${failCount}`);
}

// Run all tests
runAllTests().catch(console.error); 
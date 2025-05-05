const fs = require('fs');
const path = require('path');

// Files to verify
const requiredFiles = [
    'dist/index.html',
    'dist/index.js',
    'dist/public'
];

console.log('Verifying build output...');

let success = true;

// Check each required file/directory
for (const file of requiredFiles) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) {
        console.error(`❌ Missing: ${file}`);
        success = false;
    } else {
        console.log(`✅ Found: ${file}`);
    }
}

if (!success) {
    console.error('Build verification failed!');
    process.exit(1);
}

console.log('Build verification successful!'); 
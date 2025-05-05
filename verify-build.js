const fs = require('fs');
const path = require('path');

// Files to verify
const requiredFiles = [
    'dist/index.html',
    'dist/public'
];

// Check for the compiled index file in various possible locations
const possibleIndexLocations = [
    'dist/index.js',
    'dist/src/index.js'
];

let indexFileFound = false;
for (const location of possibleIndexLocations) {
    if (fs.existsSync(path.join(process.cwd(), location))) {
        console.log(`✅ Found compiled index at: ${location}`);
        indexFileFound = true;
        
        // If it's not in the expected root location, copy it there
        if (location !== 'dist/index.js') {
            try {
                fs.copyFileSync(
                    path.join(process.cwd(), location),
                    path.join(process.cwd(), 'dist/index.js')
                );
                console.log('✅ Created copy at: dist/index.js');
            } catch (err) {
                console.warn(`⚠️ Could not copy index file: ${err.message}`);
                // Don't fail the build for this
            }
        }
        break;
    }
}

if (!indexFileFound) {
    console.error('❌ Could not find compiled index.js in any expected location');
    // Don't immediately fail - we'll check all required files first
}

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
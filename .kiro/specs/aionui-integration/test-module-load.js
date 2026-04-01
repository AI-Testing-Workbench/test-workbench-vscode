// Test script to verify AionUI module loading
// Run with: node .kiro/specs/aionui-integration/test-module-load.js

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testModuleLoad() {
  console.log('=== Testing AionUI Module Loading ===\n');

  const appRoot = join(__dirname, '../../..');
  const aionuiMainPath = join(appRoot, 'out/aionui/dist/main');

  // Test 1: Check if files exist
  console.log('1. Checking file existence:');
  const { existsSync } = await import('fs');

  const mjsPath = join(aionuiMainPath, 'index.mjs');
  const cjsPath = join(aionuiMainPath, 'index.cjs');
  const jsPath = join(aionuiMainPath, 'index.js');

  console.log(`   index.mjs exists: ${existsSync(mjsPath)}`);
  console.log(`   index.cjs exists: ${existsSync(cjsPath)}`);
  console.log(`   index.js exists: ${existsSync(jsPath)}`);

  // Test 2: Try loading .cjs with createRequire
  console.log('\n2. Testing CommonJS loading with createRequire:');
  try {
    const require = createRequire(import.meta.url);
    const processModule = require(cjsPath);

    console.log('   ✅ Module loaded successfully');
    console.log('   Exported keys:', Object.keys(processModule).slice(0, 10).join(', '), '...');
    console.log('   Has initializeProcess:', typeof processModule.initializeProcess === 'function');

    if (typeof processModule.initializeProcess === 'function') {
      console.log('   ✅ initializeProcess is a function');
    } else {
      console.log('   ❌ initializeProcess is not a function');
    }
  } catch (error) {
    console.log('   ❌ Failed to load module');
    console.log('   Error:', error.message);
    console.log('   Stack:', error.stack);
  }

  // Test 3: Try loading .js with createRequire
  console.log('\n3. Testing .js loading with createRequire:');
  try {
    const require = createRequire(import.meta.url);
    const processModule = require(jsPath);

    console.log('   ✅ Module loaded successfully');
    console.log('   Has initializeProcess:', typeof processModule.initializeProcess === 'function');
  } catch (error) {
    console.log('   ❌ Failed to load module');
    console.log('   Error:', error.message);
  }

  console.log('\n=== Test Complete ===');
}

testModuleLoad().catch(console.error);

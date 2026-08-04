/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file
/**
 * Update git version information in product.json
 * Get the latest git tag or commit hash and write to product.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitCommitHash() {
	try {
		return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
	} catch (error) {
		console.warn('Unable to get git commit hash:', error.message);
		return 'unknown';
	}
}

function getGitCommitDate() {
	try {
		return execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
	} catch (error) {
		console.warn('Unable to get git commit date:', error.message);
		return new Date().toISOString();
	}
}

function updateProductJson() {
	const productJsonPath = path.join(__dirname, '..', 'product.json');

	// Read product.json
	const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

	// Get git version information
	const gitCommit = getGitCommitHash();
	const gitDate = getGitCommitDate();

	// Update product.json
	productJson.commit = gitCommit;
	productJson.date = gitDate;

	// Write back to product.json
	fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t') + '\n', 'utf8');

	console.log('✓ Updated product.json:');
	console.log(`  Commit: ${gitCommit}`);
	console.log(`  Date: ${gitDate}`);
}

// Execute update
updateProductJson();

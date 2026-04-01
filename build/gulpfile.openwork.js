// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  OpenWork Integration Build Tasks
 *  This file contains gulp tasks for building and integrating OpenWork into VS Code
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import * as path from 'path';
import * as fs from 'fs';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = path.dirname(__dirname);
const OUT_BUILD_DIR = path.join(root, 'out-build');
const OUT_DIR = path.join(root, 'out', 'openwork');

/**
 * Check if a directory exists
 */
function directoryExists(dirPath) {
	try {
		return fs.statSync(dirPath).isDirectory();
	} catch (err) {
		return false;
	}
}

/**
 * Copy directory recursively
 */
function copyDirectory(src, dest) {
	return new Promise((resolve, reject) => {
		// Create destination directory if it doesn't exist
		if (!directoryExists(dest)) {
			fs.mkdirSync(dest, { recursive: true });
		}

		// Read source directory
		fs.readdir(src, { withFileTypes: true }, (err, entries) => {
			if (err) {
				return reject(err);
			}

			const promises = entries.map(entry => {
				const srcPath = path.join(src, entry.name);
				const destPath = path.join(dest, entry.name);

				if (entry.isDirectory()) {
					return copyDirectory(srcPath, destPath);
				} else {
					return new Promise((res, rej) => {
						fs.copyFile(srcPath, destPath, (err) => {
							if (err) rej(err);
							else res();
						});
					});
				}
			});

			Promise.all(promises).then(resolve).catch(reject);
		});
	});
}

/**
 * Copy OpenWork integration files to VS Code output directories
 */
async function copyIntegrationFiles() {
	fancyLog(ansiColors.cyan('Copying OpenWork integration files...'));

	const srcOpenworkDir = path.join(OUT_BUILD_DIR, 'vs', 'openwork');

	// Check if source directory exists
	if (!directoryExists(srcOpenworkDir)) {
		fancyLog(ansiColors.yellow(`OpenWork integration files not found at ${srcOpenworkDir}, skipping...`));
		return;
	}

	// Copy to both out-vscode and out-vscode-min directories
	const outputDirs = ['out-vscode', 'out-vscode-min'];

	for (const outDir of outputDirs) {
		const outVscodeDir = path.join(root, outDir);
		const destOpenworkDir = path.join(outVscodeDir, 'vs', 'openwork');

		// Check if output directory exists
		if (!directoryExists(outVscodeDir)) {
			fancyLog(ansiColors.yellow(`VS Code output directory not found at ${outVscodeDir}, skipping...`));
			continue;
		}

		// Copy integration files
		await copyDirectory(srcOpenworkDir, destOpenworkDir);

		fancyLog(ansiColors.green(`Copied integration files from ${srcOpenworkDir} to ${destOpenworkDir}`));
	}
}

/**
 * Main build task for OpenWork
 */
async function buildOpenwork() {
	fancyLog(ansiColors.cyan('=== Building OpenWork Integration ==='));

	try {
		// Copy integration files
		await copyIntegrationFiles();

		fancyLog(ansiColors.green('=== OpenWork Build Complete ==='));
	} catch (err) {
		fancyLog(ansiColors.red('OpenWork build failed:'), err);
		throw err;
	}
}

// Register gulp task
gulp.task('build-openwork', buildOpenwork);

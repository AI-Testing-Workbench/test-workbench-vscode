// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  AionUI Integration Build Tasks
 *  This file contains gulp tasks for building and integrating AionUI into VS Code
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import * as path from 'path';
import { spawn } from 'child_process';
import * as fs from 'fs';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = path.dirname(__dirname);
const AIONUI_ROOT = path.join(root, 'extensions', 'aionui-main');
const OUT_DIR = path.join(root, 'out', 'aionui');

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
 * Check if a file exists
 */
function fileExists(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	} catch (err) {
		return false;
	}
}

/**
 * Run a command and return a promise
 */
function runCommand(command, args, cwd, options = {}) {
	return new Promise((resolve, reject) => {
		fancyLog(`Running: ${command} ${args.join(' ')} in ${cwd}`);

		const child = spawn(command, args, {
			cwd,
			stdio: options.silent ? 'pipe' : 'inherit',
			shell: true,
			...options
		});

		let stdout = '';
		let stderr = '';

		if (options.silent) {
			child.stdout?.on('data', (data) => {
				stdout += data.toString();
			});
			child.stderr?.on('data', (data) => {
				stderr += data.toString();
			});
		}

		child.on('close', (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				const error = new Error(`Command failed with code ${code}`);
				error.stdout = stdout;
				error.stderr = stderr;
				reject(error);
			}
		});

		child.on('error', (err) => {
			reject(err);
		});
	});
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
 * Remove directory recursively
 */
function removeDirectory(dirPath) {
	return new Promise((resolve, reject) => {
		if (!directoryExists(dirPath)) {
			return resolve();
		}

		fs.rm(dirPath, { recursive: true, force: true }, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

/**
 * Check if bun is available
 */
async function checkBunAvailable() {
	try {
		await runCommand('bun', ['--version'], root, { silent: true });
		return true;
	} catch (err) {
		return false;
	}
}

/**
 * Check and install AionUI dependencies if needed
 */
async function checkAndInstallDependencies() {
	const nodeModulesPath = path.join(AIONUI_ROOT, 'node_modules');

	if (!directoryExists(nodeModulesPath)) {
		fancyLog(ansiColors.yellow('AionUI dependencies not found, installing...'));

		const hasBun = await checkBunAvailable();

		if (hasBun) {
			await runCommand('bun', ['install'], AIONUI_ROOT);
		} else {
			fancyLog(ansiColors.yellow('Bun not found, falling back to npm...'));
			await runCommand('npm', ['install'], AIONUI_ROOT);
		}

		fancyLog(ansiColors.green('AionUI dependencies installed successfully'));
	} else {
		fancyLog('AionUI dependencies already installed');
	}
}

/**
 * Build AionUI using its build system
 */
async function buildAionUI() {
	fancyLog(ansiColors.cyan('Building AionUI...'));

	// Check if AionUI directory exists
	if (!directoryExists(AIONUI_ROOT)) {
		throw new Error(`AionUI directory not found at ${AIONUI_ROOT}`);
	}

	// Check and install dependencies
	await checkAndInstallDependencies();

	// Run AionUI build
	const hasBun = await checkBunAvailable();

	if (hasBun) {
		await runCommand('bun', ['run', 'package'], AIONUI_ROOT);
	} else {
		fancyLog(ansiColors.yellow('Bun not found, falling back to npm...'));
		await runCommand('npm', ['run', 'package'], AIONUI_ROOT);
	}

	fancyLog(ansiColors.green('AionUI build completed'));
}

/**
 * Copy AionUI build artifacts to VS Code output directory
 */
async function copyBuildArtifacts() {
	fancyLog(ansiColors.cyan('Copying AionUI build artifacts...'));

	const aionuiOutDir = path.join(AIONUI_ROOT, 'out');
	const destDistDir = path.join(OUT_DIR, 'dist');

	// Check if AionUI build output exists
	if (!directoryExists(aionuiOutDir)) {
		throw new Error(`AionUI build output not found at ${aionuiOutDir}. Please run build-aionui first.`);
	}

	// Create output directory
	if (!directoryExists(OUT_DIR)) {
		fs.mkdirSync(OUT_DIR, { recursive: true });
	}

	// Copy build artifacts
	await copyDirectory(aionuiOutDir, destDistDir);

	// Create package.json for Electron to find the main entry point
	const packageJson = {
		name: 'AionUi',
		version: '1.9.2',
		main: './dist/main/index.cjs',
		description: 'AionUI packaged for VS Code integration'
	};

	const packageJsonPath = path.join(OUT_DIR, 'package.json');
	fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
	fancyLog(ansiColors.green(`Created package.json at ${packageJsonPath}`));

	fancyLog(ansiColors.green(`Copied build artifacts from ${aionuiOutDir} to ${destDistDir}`));
}

/**
 * Copy AionUI node_modules dependencies to VS Code output directory
 * This is needed because some dependencies cannot be bundled (native modules, etc.)
 * We use a selective copy strategy to avoid issues with Electron's special files
 */
async function copyNodeModules() {
	fancyLog(ansiColors.cyan('Copying AionUI node_modules...'));

	const srcNodeModules = path.join(AIONUI_ROOT, 'node_modules');
	const destNodeModules = path.join(OUT_DIR, 'node_modules');

	// Check if node_modules exists
	if (!directoryExists(srcNodeModules)) {
		fancyLog(ansiColors.yellow(`AionUI node_modules not found at ${srcNodeModules}, skipping...`));
		return;
	}

	// Create destination directory
	if (!directoryExists(destNodeModules)) {
		fs.mkdirSync(destNodeModules, { recursive: true });
	}

	// List of packages to exclude (they're not needed at runtime or cause copy issues)
	const excludePackages = [
		'electron', // VS Code already provides Electron (but keep electron-store, electron-log, etc.)
		'electron-builder',
		'electron-vite',
		'@electron', // Exclude @electron/* scoped packages
		'vite',
		'@vitejs',
		'typescript',
		'@types',
		'eslint',
		'@typescript-eslint',
		'vitest',
		'@vitest',
		'playwright',
		'@playwright'
	];

	// Packages that should NOT be excluded even if they match the pattern
	const keepPackages = [
		'electron-store',
		'electron-log'
	];

	// Read all packages in node_modules
	const packages = fs.readdirSync(srcNodeModules, { withFileTypes: true });

	// Copy packages selectively
	let copiedCount = 0;
	let skippedCount = 0;

	for (const pkg of packages) {
		const pkgName = pkg.name;

		// Skip if it's not a directory
		if (!pkg.isDirectory()) {
			continue;
		}

		// Skip if it's in the exclude list (but keep packages in keepPackages list)
		const shouldExclude = !keepPackages.includes(pkgName) && excludePackages.some(exclude => {
			if (exclude.startsWith('@')) {
				return pkgName === exclude || pkgName.startsWith(exclude + '/');
			}
			// Exact match only for non-scoped packages to avoid excluding electron-store when excluding electron
			return pkgName === exclude;
		});

		if (shouldExclude) {
			skippedCount++;
			continue;
		}

		// Copy the package
		const srcPkg = path.join(srcNodeModules, pkgName);
		const destPkg = path.join(destNodeModules, pkgName);

		try {
			await copyDirectory(srcPkg, destPkg);
			copiedCount++;
		} catch (error) {
			fancyLog(ansiColors.yellow(`Warning: Failed to copy ${pkgName}: ${error.message}`));
			skippedCount++;
		}
	}

	fancyLog(ansiColors.green(`Copied ${copiedCount} packages, skipped ${skippedCount} packages`));
}

/**
 * Rebuild native modules for Electron ABI
 * This is needed because native modules compiled for system Node.js won't work with Electron
 */
async function rebuildNativeModules() {
	fancyLog(ansiColors.cyan('Rebuilding native modules for Electron...'));

	const destNodeModules = path.join(OUT_DIR, 'node_modules');

	// Check if node_modules exists
	if (!directoryExists(destNodeModules)) {
		fancyLog(ansiColors.yellow('node_modules not found, skipping native module rebuild'));
		return;
	}

	// Get Electron version from VS Code's package.json
	const vscodePackageJsonPath = path.join(root, 'package.json');
	let electronVersion = '39.8.3'; // Default fallback based on actual version

	if (fs.existsSync(vscodePackageJsonPath)) {
		try {
			const vscodePackageJson = JSON.parse(fs.readFileSync(vscodePackageJsonPath, 'utf8'));
			if (vscodePackageJson.devDependencies && vscodePackageJson.devDependencies.electron) {
				electronVersion = vscodePackageJson.devDependencies.electron.replace('^', '');
			}
		} catch (err) {
			fancyLog(ansiColors.yellow(`Failed to read Electron version: ${err.message}`));
		}
	}

	fancyLog(ansiColors.cyan(`Using Electron version: ${electronVersion}`));

	// List of native modules that need rebuilding
	const nativeModules = ['better-sqlite3'];

	for (const moduleName of nativeModules) {
		const modulePath = path.join(destNodeModules, moduleName);

		if (!directoryExists(modulePath)) {
			fancyLog(ansiColors.yellow(`${moduleName} not found, skipping rebuild`));
			continue;
		}

		try {
			fancyLog(ansiColors.cyan(`Rebuilding ${moduleName} for Electron...`));

			// Use electron-rebuild to rebuild native modules
			// This is more reliable than node-gyp for Electron
			try {
				await runCommand('npx', [
					'@electron/rebuild',
					'-f',
					'-w', moduleName,
					'--version', electronVersion,
					'--arch', 'arm64',
					'--module-dir', destNodeModules
				], OUT_DIR);

				fancyLog(ansiColors.green(`Successfully rebuilt ${moduleName}`));
			} catch (err) {
				fancyLog(ansiColors.yellow(`Warning: Failed to rebuild ${moduleName} with electron-rebuild: ${err.message}`));

				// Fallback to node-gyp if electron-rebuild fails
				const bindingGypPath = path.join(modulePath, 'binding.gyp');
				if (fs.existsSync(bindingGypPath)) {
					fancyLog(ansiColors.cyan(`Trying node-gyp fallback for ${moduleName}...`));
					try {
						await runCommand('npx', [
							'node-gyp', 'rebuild',
							'--runtime=electron',
							`--target=${electronVersion}`,
							'--arch=arm64',
							'--dist-url=https://electronjs.org/headers'
						], modulePath);
						fancyLog(ansiColors.green(`Successfully rebuilt ${moduleName} with node-gyp`));
					} catch (gypErr) {
						fancyLog(ansiColors.yellow(`Warning: node-gyp rebuild also failed: ${gypErr.message}`));
						fancyLog(ansiColors.yellow('The module may still work if prebuilt binaries are available'));
					}
				}
			}
		} catch (error) {
			fancyLog(ansiColors.yellow(`Warning: Failed to process ${moduleName}: ${error.message}`));
		}
	}

	fancyLog(ansiColors.green('Native module rebuild complete'));
}

/**
 * Copy AionUI resources to VS Code output directory
 */
async function copyResources() {
	fancyLog(ansiColors.cyan('Copying AionUI resources...'));

	const resourcesDir = path.join(AIONUI_ROOT, 'resources');
	const destResourcesDir = path.join(OUT_DIR, 'resources');

	// Check if resources directory exists
	if (!directoryExists(resourcesDir)) {
		fancyLog(ansiColors.yellow(`AionUI resources directory not found at ${resourcesDir}, skipping...`));
		return;
	}

	// Copy resources
	await copyDirectory(resourcesDir, destResourcesDir);

	fancyLog(ansiColors.green(`Copied resources from ${resourcesDir} to ${destResourcesDir}`));
}

/**
 * Copy AionUI integration files to VS Code output directory
 * Only copies .js files to avoid including uncompiled TypeScript
 */
async function copyIntegrationFiles() {
	fancyLog(ansiColors.cyan('Copying AionUI integration files...'));

	const srcAionuiDir = path.join(root, 'src', 'vs', 'aionui');

	// Check if source directory exists
	if (!directoryExists(srcAionuiDir)) {
		fancyLog(ansiColors.yellow(`AionUI integration files not found at ${srcAionuiDir}, skipping...`));
		return;
	}

	// Copy to both out-vscode and out-vscode-min directories
	const outputDirs = ['out-vscode', 'out-vscode-min'];

	for (const outDir of outputDirs) {
		const outVscodeDir = path.join(root, outDir);
		const destAionuiDir = path.join(outVscodeDir, 'vs', 'aionui');

		// Check if output directory exists
		if (!directoryExists(outVscodeDir)) {
			fancyLog(ansiColors.yellow(`VS Code output directory not found at ${outVscodeDir}, skipping...`));
			continue;
		}

		// Copy only .js files (skip TypeScript files)
		await copyJavaScriptFiles(srcAionuiDir, destAionuiDir);

		fancyLog(ansiColors.green(`Copied integration files from ${srcAionuiDir} to ${destAionuiDir}`));
	}

	// test-workbench_change: Also copy AionUI build artifacts to out-vscode-min
	// This is needed for the final packaging step
	fancyLog(ansiColors.cyan('Copying AionUI build artifacts to out-vscode-min...'));

	for (const outDir of outputDirs) {
		const outVscodeDir = path.join(root, outDir);
		const destAionuiOutDir = path.join(outVscodeDir, 'aionui');

		// Check if output directory exists
		if (!directoryExists(outVscodeDir)) {
			fancyLog(ansiColors.yellow(`VS Code output directory not found at ${outVscodeDir}, skipping...`));
			continue;
		}

		// Copy the entire out/aionui directory
		await copyDirectory(OUT_DIR, destAionuiOutDir);

		fancyLog(ansiColors.green(`Copied AionUI artifacts from ${OUT_DIR} to ${destAionuiOutDir}`));
	}
}

/**
 * Copy only JavaScript files from source to destination
 */
function copyJavaScriptFiles(src, dest) {
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
					return copyJavaScriptFiles(srcPath, destPath);
				} else if (entry.name.endsWith('.js')) {
					return new Promise((res, rej) => {
						fs.copyFile(srcPath, destPath, (err) => {
							if (err) rej(err);
							else res();
						});
					});
				} else {
					// Skip non-.js files
					return Promise.resolve();
				}
			});

			Promise.all(promises).then(resolve).catch(reject);
		});
	});
}

/**
 * Main build task for AionUI
 */
gulp.task('build-aionui', async () => {
	try {
		fancyLog(ansiColors.cyan('=== Starting AionUI Build ==='));

		// Build AionUI
		await buildAionUI();

		// Copy build artifacts
		await copyBuildArtifacts();

		// Copy node_modules (needed for runtime dependencies)
		await copyNodeModules();

		// Rebuild native modules for Electron ABI
		await rebuildNativeModules();

		// Copy resources
		await copyResources();

		// Copy integration files to out-vscode
		await copyIntegrationFiles();

		fancyLog(ansiColors.green('=== AionUI Build Complete ==='));
	} catch (error) {
		fancyLog(ansiColors.red('AionUI build failed:'), error.message);

		// In development mode, allow continuing with existing build
		if (process.env.NODE_ENV === 'development') {
			fancyLog(ansiColors.yellow('Development mode: Continuing with existing AionUI build if available...'));

			// Check if we have existing build artifacts
			const existingBuild = directoryExists(path.join(OUT_DIR, 'dist'));
			if (existingBuild) {
				fancyLog(ansiColors.yellow('Using existing AionUI build artifacts'));
				return;
			}
		}

		// In production mode or if no existing build, fail the task
		throw error;
	}
});

/**
 * Clean AionUI build artifacts
 */
gulp.task('clean-aionui', async () => {
	fancyLog(ansiColors.cyan('Cleaning AionUI build artifacts...'));

	// Clean VS Code output directory
	await removeDirectory(OUT_DIR);
	fancyLog(ansiColors.green(`Cleaned ${OUT_DIR}`));

	// Clean AionUI build directory
	const aionuiOutDir = path.join(AIONUI_ROOT, 'out');
	await removeDirectory(aionuiOutDir);
	fancyLog(ansiColors.green(`Cleaned ${aionuiOutDir}`));

	fancyLog(ansiColors.green('AionUI clean complete'));
});

/**
 * Watch task for AionUI development
 * Note: This task doesn't actually watch files, it just provides instructions
 * for running AionUI in development mode
 */
gulp.task('watch-aionui', () => {
	fancyLog(ansiColors.cyan('=== AionUI Development Mode ==='));
	fancyLog('');
	fancyLog('To develop AionUI with hot reload, run the following in a separate terminal:');
	fancyLog('');
	fancyLog(ansiColors.yellow('  cd extensions/aionui-main'));
	fancyLog(ansiColors.yellow('  bun run start'));
	fancyLog('');
	fancyLog('This will start the AionUI development server on http://localhost:5173');
	fancyLog('VS Code will automatically detect and use the dev server when opening AionUI window.');
	fancyLog('');
	fancyLog(ansiColors.green('Note: Make sure to run VS Code in development mode for this to work.'));
	fancyLog('');

	// Return a never-ending stream to keep the task running
	return new Promise(() => {
		// This promise never resolves, keeping the task alive
	});
});


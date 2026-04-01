// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ModeSwitchService } from '../../browser/modeSwitchService.js';
import { WorkbenchMode } from '../../common/modeSwitchService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { TestLayoutService } from '../../../../test/browser/workbenchTestServices.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';

suite('ModeSwitchService', () => {

	let storageService: TestStorageService;
	let layoutService: TestLayoutService;
	let logService: NullLogService;
	let notificationService: TestNotificationService;

	setup(() => {
		storageService = new TestStorageService();
		layoutService = new TestLayoutService();
		logService = new NullLogService();
		notificationService = new TestNotificationService();
	});

	teardown(() => {
		storageService.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('should initialize with IDE mode by default', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		assert.strictEqual(service.currentMode, WorkbenchMode.IDE);
		service.dispose();
	});

	test('should toggle from IDE to Partner mode', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		assert.strictEqual(service.currentMode, WorkbenchMode.IDE);
		service.toggleMode();
		assert.strictEqual(service.currentMode, WorkbenchMode.Partner);
		service.dispose();
	});

	test('should toggle from Partner to IDE mode', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		service.setMode(WorkbenchMode.Partner);
		assert.strictEqual(service.currentMode, WorkbenchMode.Partner);
		service.toggleMode();
		assert.strictEqual(service.currentMode, WorkbenchMode.IDE);
		service.dispose();
	});

	test('should set mode directly', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		service.setMode(WorkbenchMode.Partner);
		assert.strictEqual(service.currentMode, WorkbenchMode.Partner);

		service.setMode(WorkbenchMode.IDE);
		assert.strictEqual(service.currentMode, WorkbenchMode.IDE);
		service.dispose();
	});

	test('should not change mode when setting to current mode', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		let eventFired = false;
		const listener = service.onDidChangeMode(() => {
			eventFired = true;
		});

		service.setMode(WorkbenchMode.IDE); // Already in IDE mode
		assert.strictEqual(eventFired, false);

		listener.dispose();
		service.dispose();
	});

	test('should fire onDidChangeMode event when mode changes', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		let eventFired = false;
		let newMode: WorkbenchMode | undefined;

		const listener = service.onDidChangeMode((mode) => {
			eventFired = true;
			newMode = mode;
		});

		service.setMode(WorkbenchMode.Partner);

		assert.strictEqual(eventFired, true);
		assert.strictEqual(newMode, WorkbenchMode.Partner);

		listener.dispose();
		service.dispose();
	});

	test('should toggle mode twice to return to original mode', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		const initialMode = service.currentMode;
		service.toggleMode();
		service.toggleMode();
		assert.strictEqual(service.currentMode, initialMode);
		service.dispose();
	});

	test('should persist mode to storage when mode changes', () => {
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		// Change to Partner mode
		service.setMode(WorkbenchMode.Partner);

		// Verify it was saved to storage
		const savedMode = storageService.get('workbench.mode.state', 0 /* StorageScope.PROFILE */);
		assert.strictEqual(savedMode, WorkbenchMode.Partner);

		service.dispose();
	});

	test('should restore mode from storage on initialization', () => {
		// Pre-populate storage with Partner mode
		storageService.store('workbench.mode.state', WorkbenchMode.Partner, 0 /* StorageScope.PROFILE */, 0 /* StorageTarget.USER */);

		// Create new service instance - it should restore from storage
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		assert.strictEqual(service.currentMode, WorkbenchMode.Partner);
		service.dispose();
	});

	test('should default to IDE mode when no saved state exists', () => {
		// Don't pre-populate storage - should default to IDE mode
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		assert.strictEqual(service.currentMode, WorkbenchMode.IDE);
		service.dispose();
	});

	test('should handle invalid stored mode gracefully', () => {
		// Pre-populate storage with invalid mode
		storageService.store('workbench.mode.state', 'invalid-mode', 0 /* StorageScope.PROFILE */, 0 /* StorageTarget.USER */);

		// Create new service instance - should default to IDE mode
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		assert.strictEqual(service.currentMode, WorkbenchMode.IDE);
		service.dispose();
	});

	// test-workbench_change start
	test('should call layoutService.setPartHidden when switching to Partner mode', async () => {
		// Track calls to setPartHidden
		const hiddenParts: { hidden: boolean; part: string }[] = [];
		layoutService.setPartHidden = async (hidden: boolean, part: string) => {
			hiddenParts.push({ hidden, part });
		};

		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		// Clear the initialization calls
		hiddenParts.length = 0;

		// Switch to Partner mode
		service.setMode(WorkbenchMode.Partner);

		// Verify all parts except title bar are hidden
		assert.strictEqual(hiddenParts.length, 6);
		assert.ok(hiddenParts.every(call => call.hidden === true));

		service.dispose();
	});

	test('should call layoutService.setPartHidden when switching to IDE mode', async () => {
		// Track calls to setPartHidden
		const hiddenParts: { hidden: boolean; part: string }[] = [];
		layoutService.setPartHidden = async (hidden: boolean, part: string) => {
			hiddenParts.push({ hidden, part });
		};

		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		// Clear the initialization calls
		hiddenParts.length = 0;

		// Switch to Partner mode first
		service.setMode(WorkbenchMode.Partner);
		hiddenParts.length = 0;

		// Switch back to IDE mode
		service.setMode(WorkbenchMode.IDE);

		// Verify all parts are shown
		assert.strictEqual(hiddenParts.length, 6);
		assert.ok(hiddenParts.every(call => call.hidden === false));

		service.dispose();
	});

	test('should apply layout on initialization', async () => {
		// Track calls to setPartHidden
		const hiddenParts: { hidden: boolean; part: string }[] = [];
		layoutService.setPartHidden = async (hidden: boolean, part: string) => {
			hiddenParts.push({ hidden, part });
		};

		// Create service - should apply IDE mode layout on init
		const service = new ModeSwitchService(storageService, layoutService, logService, notificationService);

		// Verify layout was applied during initialization
		assert.strictEqual(hiddenParts.length, 6);
		assert.ok(hiddenParts.every(call => call.hidden === false));

		service.dispose();
	});
	// test-workbench_change end
});

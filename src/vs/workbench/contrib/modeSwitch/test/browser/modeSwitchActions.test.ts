// test-workbench_change - new file
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ToggleModeAction, TOGGLE_MODE_COMMAND_ID } from '../../browser/modeSwitchActions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';

suite('ModeSwitchActions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('ToggleModeAction', () => {
		test('should have correct command ID', () => {
			const action = new ToggleModeAction();
			assert.strictEqual(action.desc.id, TOGGLE_MODE_COMMAND_ID);
			assert.strictEqual(action.desc.id, 'workbench.action.toggleMode');
		});

		test('should have hover tooltip (title)', () => {
			// **Validates: Requirements 1.3, 7.3**
			const action = new ToggleModeAction();
			assert.ok(action.desc.title, 'Action should have a title');
			assert.strictEqual(typeof action.desc.title, 'object', 'Title should be a localized string object');
		});

		test('should have toggled icon state', () => {
			// **Validates: Requirements 1.2, 7.2**
			const action = new ToggleModeAction();

			// Verify default icon
			assert.ok(action.desc.icon, 'Action should have an icon');
			assert.strictEqual(action.desc.icon, Codicon.layout, 'Default icon should be Codicon.layout');

			// Verify toggled state configuration
			assert.ok(action.desc.toggled, 'Action should have toggled state configuration');

			if (typeof action.desc.toggled === 'object' && 'icon' in action.desc.toggled) {
				// Verify toggled icon is Codicon.layoutPanel for Partner mode
				assert.strictEqual(
					action.desc.toggled.icon,
					Codicon.layoutPanel,
					'Toggled icon should be Codicon.layoutPanel for Partner mode'
				);

				// Verify toggled condition checks for Partner mode
				assert.ok(action.desc.toggled.condition, 'Toggled state should have a condition');
				const expectedCondition = ContextKeyExpr.equals('workbench.mode', 'partner');
				assert.strictEqual(
					action.desc.toggled.condition.serialize(),
					expectedCondition.serialize(),
					'Toggled condition should check for Partner mode'
				);
			} else {
				assert.fail('Toggled state should be an object with icon property');
			}
		});

		test('should be keyboard accessible via F1 command palette', () => {
			// **Validates: Requirements 1.4, 7.4**
			const action = new ToggleModeAction();
			assert.strictEqual(action.desc.f1, true, 'Action should be accessible via F1 command palette');
		});

		test('should be registered in title bar menu', () => {
			// **Validates: Requirements 1.1**
			const action = new ToggleModeAction();
			assert.ok(action.desc.menu, 'Action should have menu configuration');

			if (Array.isArray(action.desc.menu)) {
				const titleBarMenu = action.desc.menu.find(m => m.id === MenuId.TitleBar);
				assert.ok(titleBarMenu, 'Action should be registered in TitleBar menu');
				assert.strictEqual(titleBarMenu?.group, 'navigation', 'Action should be in navigation group');
				assert.strictEqual(titleBarMenu?.order, 1, 'Action should have order 1');
			} else {
				assert.fail('Menu configuration should be an array');
			}
		});

		test('should have correct category', () => {
			const action = new ToggleModeAction();
			assert.ok(action.desc.category, 'Action should have a category');
		});
	});
});

# Implementation Plan: Title Bar Mode Switch

## Overview

This implementation plan breaks down the title bar mode switch feature into discrete coding tasks. The feature adds a button to the VS Code title bar that toggles between IDE mode (standard workbench) and Partner mode (blank layout). Implementation follows VS Code's contribution-based architecture with proper service registration, action handling, and state persistence.

## Tasks

- [ ] 1. Create mode switch service infrastructure
  - [x] 1.1 Create service interface and implementation files
    - Create `src/vs/workbench/services/modeSwitch/common/modeSwitchService.ts` with `IModeSwitchService` interface
    - Create `src/vs/workbench/services/modeSwitch/browser/modeSwitchService.ts` with `ModeSwitchService` implementation
    - Define `WorkbenchMode` enum with IDE and Partner values
    - Add fork-specific change markers to new files
    - _Requirements: 1.1, 2.1, 5.1_

  - [x] 1.2 Implement core service functionality
    - Implement mode state management with `_currentMode` property
    - Implement `toggleMode()` method for mode switching
    - Implement `setMode()` method for direct mode setting
    - Add `onDidChangeMode` event emitter for mode change notifications
    - _Requirements: 2.1, 2.4_

  - [ ]* 1.3 Write property test for mode toggle idempotence
    - **Property 1: Mode Toggle Idempotence**
    - **Validates: Requirements 2.1, 2.4**
    - Test that toggling mode twice returns to original state
    - _Requirements: 2.1, 2.4_

- [ ] 2. Implement mode persistence
  - [x] 2.1 Add storage service integration
    - Inject `IStorageService` into `ModeSwitchService` constructor
    - Implement `saveMode()` method using `StorageScope.PROFILE` and `StorageTarget.USER`
    - Use storage key `workbench.mode.state`
    - _Requirements: 5.1_

  - [x] 2.2 Implement mode restoration on startup
    - Load saved mode from storage in constructor
    - Default to IDE mode if no saved state exists
    - Handle invalid stored mode values gracefully
    - _Requirements: 5.2, 5.3_

  - [ ]* 2.3 Write property test for mode persistence round trip
    - **Property 3: Mode Persistence Round Trip**
    - **Validates: Requirements 5.1, 5.2**
    - Test that saving then restoring preserves exact mode
    - _Requirements: 5.1, 5.2_

  - [ ]* 2.4 Write unit tests for storage edge cases
    - Test default mode when no saved state exists
    - Test invalid stored mode handling
    - Test storage service unavailable scenario
    - _Requirements: 5.3_

- [ ] 3. Implement layout management integration
  - [x] 3.1 Add layout service integration
    - Inject `IWorkbenchLayoutService` into `ModeSwitchService` constructor
    - Implement `applyMode()` method to coordinate layout changes
    - Implement `applyIDEMode()` to show all workbench parts
    - Implement `applyPartnerMode()` to hide workbench parts except title bar
    - _Requirements: 2.2, 2.3, 3.1, 4.1, 4.2_

  - [x] 3.2 Add logging for mode transitions
    - Inject `ILogService` into `ModeSwitchService` constructor
    - Log mode transitions with current and new mode
    - Log errors during layout operations
    - _Requirements: 2.1_

  - [ ]* 3.3 Write unit tests for layout integration
    - Test IDE mode shows all UI elements (sidebar, panel, editor, statusbar, activitybar, auxiliarybar)
    - Test Partner mode hides workbench parts
    - Test title bar remains visible in Partner mode
    - _Requirements: 3.1, 4.2, 4.3_

- [ ] 4. Register mode switch service
  - [x] 4.1 Register service as singleton
    - Add `registerSingleton()` call for `IModeSwitchService` in service implementation file
    - Use `InstantiationType.Delayed` for lazy initialization
    - Add fork-specific change markers
    - _Requirements: 2.1_

- [x] 5. Checkpoint - Verify service implementation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Create mode switch action and context keys
  - [x] 6.1 Create context key definition
    - Create `src/vs/workbench/contrib/modeSwitch/common/modeSwitchContextKeys.ts`
    - Define `WorkbenchModeContext` with key `workbench.mode` and default value `ide`
    - Add fork-specific change markers
    - _Requirements: 1.2, 7.2_

  - [x] 6.2 Create mode switch action
    - Create `src/vs/workbench/contrib/modeSwitch/browser/modeSwitchActions.ts`
    - Define `TOGGLE_MODE_COMMAND_ID` constant as `workbench.action.toggleMode`
    - Implement `ToggleModeAction` extending `Action2`
    - Configure action with title, icon (Codicon.layout), and toggled state
    - Add action to `MenuId.TitleBar` with navigation group and order 1
    - Implement `run()` method to call `modeSwitchService.toggleMode()`
    - Register action with `registerAction2()`
    - Add fork-specific change markers
    - _Requirements: 1.1, 1.2, 1.3, 2.1_

  - [ ]* 6.3 Write unit tests for action execution
    - Test action calls `toggleMode()` on service
    - Test action is registered in title bar menu
    - Test action icon and title are correct
    - _Requirements: 1.1, 1.3_

- [ ] 7. Create mode switch contribution
  - [x] 7.1 Implement workbench contribution
    - Create `src/vs/workbench/contrib/modeSwitch/browser/modeSwitch.contribution.ts`
    - Implement `ModeSwitchContribution` class extending `Disposable` and implementing `IWorkbenchContribution`
    - Inject `IModeSwitchService` and `IContextKeyService` in constructor
    - Bind `WorkbenchModeContext` to context key service
    - Set initial context key value from current mode
    - Listen to `onDidChangeMode` event and update context key
    - Register contribution with `LifecyclePhase.Restored`
    - Import actions file to ensure action registration
    - Add fork-specific change markers
    - _Requirements: 1.2, 7.2_

  - [ ]* 7.2 Write property test for button visual state
    - **Property 2: Button Visual State Reflects Current Mode**
    - **Validates: Requirements 1.2**
    - Test that button visual properties match current mode
    - _Requirements: 1.2_

- [ ] 8. Add visual feedback and accessibility
  - [x] 8.1 Configure action visual properties
    - Verify action has hover tooltip
    - Verify action has toggled icon state (Codicon.layoutPanel for Partner mode)
    - Verify action is keyboard accessible via F1 command palette
    - _Requirements: 1.3, 1.4, 7.3, 7.4_

  - [ ]* 8.2 Write unit tests for accessibility
    - Test button is keyboard accessible
    - Test button provides hover feedback
    - Test button provides active/pressed feedback
    - _Requirements: 1.4, 7.3, 7.4_

- [x] 9. Checkpoint - Verify UI integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Add performance monitoring
  - [x] 10.1 Add timing measurements for layout updates
    - Add performance timing in `applyMode()` method
    - Log warning if layout update exceeds 100ms
    - _Requirements: 7.1_

  - [x] 10.2 Add timing measurements for button updates
    - Add performance timing in context key update handler
    - Log warning if button update exceeds 100ms
    - _Requirements: 7.2_

  - [ ]* 10.3 Write property tests for performance
    - **Property 4: Layout Update Performance**
    - **Validates: Requirements 7.1**
    - Test layout updates within 100ms
    - **Property 5: Button Visual Update Performance**
    - **Validates: Requirements 7.2**
    - Test button updates within 100ms
    - _Requirements: 7.1, 7.2_

- [ ] 11. Add error handling
  - [x] 11.1 Implement service initialization error handling
    - Add try-catch in constructor for storage service errors
    - Default to IDE mode on initialization failure
    - Log errors with `ILogService`
    - _Requirements: 5.3_

  - [x] 11.2 Implement layout service error handling
    - Add try-catch in `applyMode()` for layout service errors
    - Attempt to revert to previous mode on failure
    - Log errors and show notification if revert fails
    - _Requirements: 2.2, 2.3_

  - [x] 11.3 Implement storage error handling
    - Add try-catch in `saveMode()` for storage errors
    - Log warning but continue operation
    - _Requirements: 5.1_

  - [ ]* 11.4 Write unit tests for error scenarios
    - Test service initialization with unavailable storage
    - Test layout service operation failures
    - Test storage persistence failures
    - Test invalid stored mode values
    - _Requirements: 5.1, 5.3_

- [ ] 12. Verify fork-specific change markers
  - [x] 12.1 Review all modified and new files
    - Verify all new files have `// test-workbench_change - new file` at top
    - Verify all single-line changes in existing files have `// test-workbench_change` suffix
    - Verify all multi-line changes have start/end markers
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 13. Final checkpoint - Integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- All new files must include fork-specific change markers per Requirement 6
- Service follows VS Code's dependency injection pattern with proper service registration
- Action follows VS Code's Action2 pattern with menu contribution
- Contribution follows VS Code's workbench contribution pattern with lifecycle phase
- Property tests validate universal correctness properties across all mode states
- Unit tests validate specific examples, edge cases, and integration points

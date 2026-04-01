# Requirements Document

## Introduction

This feature adds a mode switching button to the VS Code title bar that allows users to toggle between IDE mode (standard workbench layout) and Partner mode (blank layout page). This is part of a VS Code fork and requires special change markers to minimize merge conflicts with upstream.

## Glossary

- **Title_Bar**: The top bar of the VS Code window containing window controls and title information
- **Mode_Switch_Button**: A clickable UI control in the Title_Bar that toggles between modes
- **IDE_Mode**: The standard VS Code workbench layout with all panels, sidebars, and editors visible
- **Partner_Mode**: A blank layout page with minimal or no workbench UI elements visible
- **Workbench**: The main VS Code UI framework that manages layout, panels, and views
- **Mode_State**: The current active mode (either IDE_Mode or Partner_Mode)

## Requirements

### Requirement 1: Mode Switch Button Display

**User Story:** As a user, I want to see a mode switch button in the title bar, so that I can easily identify and access the mode switching functionality.

#### Acceptance Criteria

1. THE Title_Bar SHALL display the Mode_Switch_Button in a visible location
2. THE Mode_Switch_Button SHALL indicate the current Mode_State visually
3. THE Mode_Switch_Button SHALL be accessible via mouse interaction
4. THE Mode_Switch_Button SHALL be accessible via keyboard navigation

### Requirement 2: Mode Switching Behavior

**User Story:** As a user, I want to switch between IDE and Partner modes, so that I can choose the appropriate interface for my current task.

#### Acceptance Criteria

1. WHEN the Mode_Switch_Button is clicked, THE Workbench SHALL toggle the Mode_State
2. WHEN Mode_State changes to IDE_Mode, THE Workbench SHALL display the standard workbench layout
3. WHEN Mode_State changes to Partner_Mode, THE Workbench SHALL display a blank layout page
4. THE Workbench SHALL preserve the Mode_State across button clicks (toggle behavior)

### Requirement 3: IDE Mode Layout

**User Story:** As a user, I want IDE mode to show the standard workbench, so that I can use all existing VS Code features.

#### Acceptance Criteria

1. WHILE Mode_State is IDE_Mode, THE Workbench SHALL display all standard UI elements
2. WHILE Mode_State is IDE_Mode, THE Workbench SHALL maintain existing editor functionality
3. WHILE Mode_State is IDE_Mode, THE Workbench SHALL maintain existing panel functionality
4. WHILE Mode_State is IDE_Mode, THE Workbench SHALL maintain existing sidebar functionality

### Requirement 4: Partner Mode Layout

**User Story:** As a user, I want Partner mode to show a blank layout, so that I can have a clean interface for partner-specific workflows.

#### Acceptance Criteria

1. WHILE Mode_State is Partner_Mode, THE Workbench SHALL display a blank layout page
2. WHILE Mode_State is Partner_Mode, THE Workbench SHALL hide standard workbench UI elements
3. WHILE Mode_State is Partner_Mode, THE Title_Bar SHALL remain visible with the Mode_Switch_Button
4. WHILE Mode_State is Partner_Mode, THE Workbench SHALL maintain window controls functionality

### Requirement 5: Mode State Persistence

**User Story:** As a user, I want my mode preference to be remembered, so that I don't have to switch modes every time I open VS Code.

#### Acceptance Criteria

1. WHEN the user closes VS Code, THE Workbench SHALL save the current Mode_State
2. WHEN the user opens VS Code, THE Workbench SHALL restore the previously saved Mode_State
3. IF no saved Mode_State exists, THEN THE Workbench SHALL default to IDE_Mode

### Requirement 6: Fork-Specific Change Markers

**User Story:** As a maintainer, I want fork-specific changes to be clearly marked, so that I can minimize merge conflicts when syncing with upstream VS Code.

#### Acceptance Criteria

1. THE implementation SHALL mark single-line changes with `// test-workbench_change` comments
2. THE implementation SHALL mark multi-line changes with `// test-workbench_change start` and `// test-workbench_change end` comments
3. THE implementation SHALL mark new files with `// test-workbench_change - new file` at the top
4. THE implementation SHALL apply these markers to all code modifications in existing VS Code files

### Requirement 7: Visual Feedback

**User Story:** As a user, I want immediate visual feedback when switching modes, so that I know the mode change was successful.

#### Acceptance Criteria

1. WHEN Mode_State changes, THE Workbench SHALL update the layout within 100ms
2. WHEN Mode_State changes, THE Mode_Switch_Button SHALL update its visual state within 100ms
3. THE Mode_Switch_Button SHALL provide hover feedback to indicate interactivity
4. THE Mode_Switch_Button SHALL provide active/pressed feedback during click interaction

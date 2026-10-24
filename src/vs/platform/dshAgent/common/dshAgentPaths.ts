/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

/** Runtime layout marker written by `scripts/dsh-agent/prepare-runtime.mjs`. */
export const DSH_AGENT_RUNTIME_FORMAT = 1;

/** Absolute locations used by the Agent integration. */
export interface IDshAgentPaths {
	/** Root of the packaged or development runtime assets. */
	readonly runtimeRoot: string;
	/** Node executable that runs the Host outside the Electron process. */
	readonly node: string;
	/** dsh CLI entry point; `undefined` when the packaged installer is used as a command. */
	readonly dshEntry: string | undefined;
	/** dsh command used when no entry point is bundled. */
	readonly dshCommand: string | undefined;
	/** Isolated dsh home (`~/.tscode-dsh` unless overridden). */
	readonly dshHome: string;
	/** Directory for Host and proxy logs. */
	readonly logDirectory: string;
	/** dsh profile booted by the Agent window. */
	readonly profile: string;
	/** Bundled web frontend used for diagnostics and offline error pages. */
	readonly webDist: string | undefined;
	/** Version marker of the installed runtime, when governed by the app build. */
	readonly runtimeVersion: string | undefined;
}

/** Configuration read from the `dsh.agentWindow` settings section. */
export interface IDshAgentWindowSettings {
	readonly enabled: boolean;
	readonly requireTrustedWorkspace: boolean;
	readonly nodePath?: string;
	readonly dshHome?: string;
	readonly dshEntry?: string;
	readonly profile: string;
	readonly autoRestart: boolean;
}

/** Default settings used before configuration is available. */
export const DEFAULT_DSH_AGENT_WINDOW_SETTINGS: IDshAgentWindowSettings = {
	enabled: true,
	requireTrustedWorkspace: true,
	profile: 'web',
	autoRestart: true
};

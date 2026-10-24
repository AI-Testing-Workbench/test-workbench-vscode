/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// test-workbench_change - new file

/** Telemetry events for the dsh Agent window. Payloads never contain prompts or file contents. */
export interface IDshAgentTelemetryEvents {
	/** The Agent window reached the Host-ready state. */
	readonly dshAgentWindowOpened: {
		readonly coldStartMs: number;
		readonly restartCount: number;
		readonly safeMode: boolean;
	};

	/** The Agent Host process exited unexpectedly. */
	readonly dshAgentHostFailed: {
		readonly exitCode: number | undefined;
		readonly restartCount: number;
		readonly errorCode: string;
	};

	/** The Agent Host was restarted after an unexpected exit. */
	readonly dshAgentHostRestarted: {
		readonly attempt: number;
		readonly delayMs: number;
	};

	/** The Agent window was closed by the user. */
	readonly dshAgentWindowClosed: {
		readonly uptimeMs: number;
	};

	/** A bridge request was rejected by validation. */
	readonly dshAgentBridgeRejected: {
		readonly operation: string;
		readonly reason: string;
	};
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createWriteStream, WriteStream, promises } from 'fs';
import { Readable } from 'stream';
import { createCancelablePromise, Sequencer } from '../common/async.js';
import { CancellationToken } from '../common/cancellation.js';
import * as path from '../common/path.js';
import { assertReturnsDefined } from '../common/types.js';
import { Promises } from './pfs.js';
import * as nls from '../../nls.js';
import type { Entry, ZipFile } from 'yauzl';

export const CorruptZipMessage: string = 'end of central directory record signature not found';
const CORRUPT_ZIP_PATTERN = new RegExp(CorruptZipMessage);

export interface IExtractOptions {
	overwrite?: boolean;

	/**
	 * Source path within the ZIP archive. Only the files contained in this
	 * path will be extracted.
	 */
	sourcePath?: string;
}

interface IOptions {
	sourcePathRegex: RegExp;
}

export type ExtractErrorType = 'CorruptZip' | 'Incomplete';

export class ExtractError extends Error {

	readonly type?: ExtractErrorType;

	constructor(type: ExtractErrorType | undefined, cause: Error) {
		let message = cause.message;

		switch (type) {
			case 'CorruptZip': message = `Corrupt ZIP: ${message}`; break;
		}

		super(message);
		this.type = type;
		this.cause = cause;
	}
}

function modeFromEntry(entry: Entry) {
	const attr = entry.externalFileAttributes >> 16 || 33188;

	return [448 /* S_IRWXU */, 56 /* S_IRWXG */, 7 /* S_IRWXO */]
		.map(mask => attr & mask)
		.reduce((a, b) => a + b, attr & 61440 /* S_IFMT */);
}

function toExtractError(err: Error): ExtractError {
	if (err instanceof ExtractError) {
		return err;
	}

	let type: ExtractErrorType | undefined = undefined;

	if (CORRUPT_ZIP_PATTERN.test(err.message)) {
		type = 'CorruptZip';
	}

	return new ExtractError(type, err);
}

function extractEntry(stream: Readable, fileName: string, mode: number, targetPath: string, options: IOptions, token: CancellationToken): Promise<void> {
	const dirName = path.dirname(fileName);
	const targetDirName = path.join(targetPath, dirName);
	if (!targetDirName.startsWith(targetPath)) {
		return Promise.reject(new Error(nls.localize('invalid file', "Error extracting {0}. Invalid file.", fileName)));
	}
	const targetFileName = path.join(targetPath, fileName);

	let istream: WriteStream;

	token.onCancellationRequested(() => {
		istream?.destroy();
	});

	return Promise.resolve(promises.mkdir(targetDirName, { recursive: true })).then(() => new Promise<void>((c, e) => {
		if (token.isCancellationRequested) {
			return;
		}

		try {
			istream = createWriteStream(targetFileName, { mode });
			let bytesWritten = 0;
			let finished = false;

			// Use 'finish' event to ensure all data is flushed to disk
			// This is especially important for large files on Windows
			istream.once('finish', () => {
				finished = true;
				// Log for debugging
				if (bytesWritten === 0) {
					console.warn(`[ZIP] Warning: Extracted ${fileName} with 0 bytes`);
				}
				c();
			});

			istream.once('error', (err) => {
				console.error(`[ZIP] Write error for ${fileName}:`, err.message);
				e(new Error(`Failed to write ${fileName}: ${err.message}`));
			});

			stream.once('error', (err) => {
				console.error(`[ZIP] Read error for ${fileName}:`, err.message);
				e(new Error(`Failed to read ${fileName} from zip: ${err.message}`));
			});

			// Track data flow for debugging
			stream.on('data', (chunk: Buffer) => {
				bytesWritten += chunk.length;
			});

			stream.on('end', () => {
				// Ensure we actually received data
				if (bytesWritten === 0 && !finished) {
					console.warn(`[ZIP] Stream ended for ${fileName} but no data was received`);
				}
			});

			stream.pipe(istream);
		} catch (error) {
			console.error(`[ZIP] Exception during ${fileName} extraction:`, error);
			e(error);
		}
	}));
}

function extractZip(zipfile: ZipFile, targetPath: string, options: IOptions, token: CancellationToken): Promise<void> {
	let last = createCancelablePromise<void>(() => Promise.resolve());
	let extractedEntriesCount = 0;
	const failedFiles: string[] = [];
	const successFiles: string[] = [];

	const listener = token.onCancellationRequested(() => {
		last.cancel();
		zipfile.close();
	});

	return new Promise<void>((c, e) => {
		const throttler = new Sequencer();

		const readNextEntry = (token: CancellationToken) => {
			if (token.isCancellationRequested) {
				return;
			}

			extractedEntriesCount++;
			zipfile.readEntry();
		};

		zipfile.once('error', e);
		zipfile.once('close', () => last.then(() => {
			console.log(`[ZIP] Extraction complete. Total entries: ${zipfile.entryCount}, Processed: ${extractedEntriesCount}`);
			console.log(`[ZIP] Successfully extracted: ${successFiles.length} files`);
			if (failedFiles.length > 0) {
				console.error(`[ZIP] Failed to extract ${failedFiles.length} files:`, failedFiles);
			}

			if (token.isCancellationRequested || zipfile.entryCount === extractedEntriesCount) {
				c();
			} else {
				e(new ExtractError('Incomplete', new Error(nls.localize('incompleteExtract', "Incomplete. Found {0} of {1} entries", extractedEntriesCount, zipfile.entryCount))));
			}
		}, e));
		zipfile.readEntry();
		zipfile.on('entry', (entry: Entry) => {

			if (token.isCancellationRequested) {
				return;
			}

			// Log every entry for debugging
			console.log(`[ZIP] Processing entry: ${entry.fileName} (${entry.uncompressedSize} bytes)`);

			// Skip macOS metadata files that can cause conflicts on Windows
			if (entry.fileName.includes('__MACOSX/') || entry.fileName.startsWith('._')) {
				console.log(`[ZIP] Skipping macOS metadata: ${entry.fileName}`);
				readNextEntry(token);
				return;
			}

			if (!options.sourcePathRegex.test(entry.fileName)) {
				console.log(`[ZIP] Skipping (regex mismatch): ${entry.fileName}`);
				readNextEntry(token);
				return;
			}

			const fileName = entry.fileName.replace(options.sourcePathRegex, '');

			// directory file names end with '/'
			if (/\/$/.test(fileName)) {
				console.log(`[ZIP] Creating directory: ${fileName}`);
				const targetFileName = path.join(targetPath, fileName);
				last = createCancelablePromise(token => promises.mkdir(targetFileName, { recursive: true }).then(() => readNextEntry(token)).then(undefined, e));
				return;
			}

			console.log(`[ZIP] Queueing file extraction: ${fileName}`);
			const stream = openZipStream(zipfile, entry);
			const mode = modeFromEntry(entry);

			last = createCancelablePromise(token => throttler.queue(async () => {
				try {
					console.log(`[ZIP] Starting extraction: ${fileName}`);
					const readableStream = await stream;
					await extractEntry(readableStream, fileName, mode, targetPath, options, token);
					console.log(`[ZIP] Successfully extracted: ${fileName}`);
					successFiles.push(fileName);
					readNextEntry(token);
				} catch (err) {
					// Log extraction failure but continue with other files
					console.error(`[ZIP] Failed to extract ${fileName}:`, err);
					failedFiles.push(fileName);
					// Still read next entry to continue extraction
					readNextEntry(token);
					// Don't re-throw - we want to continue extracting other files
				}
			}));
		});
	}).finally(() => listener.dispose());
}

async function openZip(zipFile: string, lazy: boolean = false): Promise<ZipFile> {
	const { open } = await import('yauzl');

	return new Promise<ZipFile>((resolve, reject) => {
		open(zipFile, lazy ? { lazyEntries: true } : undefined!, (error: Error | null, zipfile?: ZipFile) => {
			if (error) {
				reject(toExtractError(error));
			} else {
				resolve(assertReturnsDefined(zipfile));
			}
		});
	});
}

function openZipStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
	return new Promise<Readable>((resolve, reject) => {
		zipFile.openReadStream(entry, (error: Error | null, stream?: Readable) => {
			if (error) {
				reject(toExtractError(error));
			} else {
				resolve(assertReturnsDefined(stream));
			}
		});
	});
}

export interface IFile {
	path: string;
	contents?: Buffer | string;
	localPath?: string;
}

export async function zip(zipPath: string, files: IFile[]): Promise<string> {
	const { ZipFile } = await import('yazl');

	return new Promise<string>((c, e) => {
		const zip = new ZipFile();
		files.forEach(f => {
			if (f.contents) {
				zip.addBuffer(typeof f.contents === 'string' ? Buffer.from(f.contents, 'utf8') : f.contents, f.path);
			} else if (f.localPath) {
				zip.addFile(f.localPath, f.path);
			}
		});
		zip.end();

		const zipStream = createWriteStream(zipPath);
		zip.outputStream.pipe(zipStream);

		zip.outputStream.once('error', e);
		zipStream.once('error', e);
		zipStream.once('finish', () => c(zipPath));
	});
}

export function extract(zipPath: string, targetPath: string, options: IExtractOptions = {}, token: CancellationToken): Promise<void> {
	const sourcePathRegex = new RegExp(options.sourcePath ? `^${options.sourcePath}` : '');

	let promise = openZip(zipPath, true);

	if (options.overwrite) {
		promise = promise.then(zipfile => Promises.rm(targetPath).then(() => zipfile));
	}

	return promise.then(zipfile => extractZip(zipfile, targetPath, { sourcePathRegex }, token));
}

function read(zipPath: string, filePath: string): Promise<Readable> {
	return openZip(zipPath).then(zipfile => {
		return new Promise<Readable>((c, e) => {
			zipfile.on('entry', (entry: Entry) => {
				if (entry.fileName === filePath) {
					openZipStream(zipfile, entry).then(stream => c(stream), err => e(err));
				}
			});

			zipfile.once('close', () => e(new Error(nls.localize('notFound', "{0} not found inside zip.", filePath))));
		});
	});
}

export function buffer(zipPath: string, filePath: string): Promise<Buffer> {
	return read(zipPath, filePath).then(stream => {
		return new Promise<Buffer>((c, e) => {
			const buffers: Buffer[] = [];
			stream.once('error', e);
			stream.on('data', (b: Buffer) => buffers.push(b));
			stream.on('end', () => c(Buffer.concat(buffers)));
		});
	});
}

/**
 * Streaming gzip + tar (ustar / POSIX pax) writer, lister, reader and safe extractor.
 *
 * Pure Node builtins — no runtime dependencies. Offline artifacts can be hundreds of
 * megabytes, so every read path streams: a `node:zlib` gunzip stream feeds a small
 * tar header parser that works over chunks and never buffers the whole archive.
 *
 * The writer emits npm-style tarballs with one top-level `package/` directory and is
 * deterministic: mtime 0, uid/gid 0, empty uname/gname, mode 0755 for executables and
 * directories, 0644 otherwise. Non-representable (long or non-ASCII) paths are carried
 * in a pax extended header (`type 'x'`); everything else uses plain ustar, including
 * the ustar `prefix` field for paths that fit in 100 + 155 bytes.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BLOCK_SIZE = 512;
const ZERO_BLOCK = Buffer.alloc(BLOCK_SIZE);
const CONTENT_CHUNK_SIZE = 64 * 1024;
const MAX_PAX_HEADER_BYTES = 1024 * 1024;
const MAX_USTAR_FILE_BYTES = 0o77777777777; // largest value of an 11-digit octal size field
const MAX_WALK_DEPTH = 128;
const USTAR_NAME_BYTES = 100;
const USTAR_PREFIX_BYTES = 155;

/** Error raised for malformed, unsupported or unsafe tar archives. */
export class TarFormatError extends Error {
  /**
   * @param {string} code machine readable reason: 'too-large' | 'unsupported-entry' |
   *   'unsafe-path' | 'invalid-header' | 'invalid-gzip' | 'truncated'
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = 'TarFormatError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write `sourceDir` as a gzipped ustar/pax tarball containing `prefix/`.
 *
 * @param {{ sourceDir: string, outFile: string, prefix?: string }} options
 * @returns {Promise<{ file: string, bytes: number, fileCount: number, entries: number }>}
 */
export async function packDirectoryToTarGz({ sourceDir, outFile, prefix = 'package' } = {}) {
  if (typeof sourceDir !== 'string' || sourceDir === '') throw new TypeError('sourceDir is required');
  if (typeof outFile !== 'string' || outFile === '') throw new TypeError('outFile is required');

  const entries = await collectEntries(sourceDir, prefix);
  const outDir = path.dirname(path.resolve(outFile));
  await fsp.mkdir(outDir, { recursive: true });

  let stats;
  try {
    await pipeline(
      Readable.from(tarByteStream(entries), { objectMode: false }),
      createGzip({ level: 9 }),
      createWriteStream(outFile),
    );
    stats = await fsp.stat(outFile);
  } catch (err) {
    await fsp.rm(outFile, { force: true }).catch(() => {});
    throw err;
  }

  return {
    file: outFile,
    bytes: stats.size,
    fileCount: entries.filter((entry) => entry.type === 'file').length,
    entries: entries.length,
  };
}

/** Normalize and validate the top-level archive prefix ('package' by default). */
function normalizePrefix(prefix) {
  if (prefix === undefined || prefix === null) return 'package';
  let value = String(prefix).replace(/\\/g, '/');
  value = value.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (value === '' || value === '.') return '';
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TarFormatError('unsafe-path', `invalid archive prefix: ${String(prefix)}`);
    }
  }
  return value;
}

function ustarFileMode(stats) {
  return (stats.mode & 0o111) !== 0 ? 0o755 : 0o644;
}

/**
 * Walk `sourceDir` into a sorted, deterministic entry list. `path` values use '/'
 * separators and directory names end with '/'.
 */
async function collectEntries(sourceDir, prefix) {
  const rootAbs = path.resolve(sourceDir);
  let rootStats;
  try {
    rootStats = await fsp.stat(rootAbs);
  } catch (err) {
    throw new TarFormatError('unsupported-entry', `cannot read source directory: ${rootAbs}`, { cause: err });
  }
  if (!rootStats.isDirectory()) {
    throw new TarFormatError('unsupported-entry', `source is not a directory: ${rootAbs}`);
  }

  const rootPrefix = normalizePrefix(prefix);
  const entries = [];

  const visit = async (absDir, relDir, depth) => {
    if (depth > MAX_WALK_DEPTH) {
      throw new TarFormatError('unsupported-entry', `directory tree too deep below: ${absDir}`);
    }
    if (relDir !== '') entries.push({ path: `${relDir}/`, abs: absDir, type: 'dir', mode: 0o755, size: 0 });
    const names = (await fsp.readdir(absDir)).sort();
    for (const name of names) {
      const abs = path.join(absDir, name);
      const rel = relDir === '' ? name : `${relDir}/${name}`;
      const linkStats = await fsp.lstat(abs);
      if (linkStats.isSymbolicLink()) {
        let targetStats;
        try {
          targetStats = await fsp.stat(abs); // follow links (package content is materialized)
        } catch (err) {
          throw new TarFormatError('unsupported-entry', `broken symlink: ${rel}`, { cause: err });
        }
        if (targetStats.isDirectory()) {
          await visit(abs, rel, depth + 1);
        } else if (targetStats.isFile()) {
          entries.push({ path: rel, abs, type: 'file', mode: ustarFileMode(targetStats), size: targetStats.size });
        } else {
          throw new TarFormatError('unsupported-entry', `unsupported symlink target: ${rel}`);
        }
      } else if (linkStats.isDirectory()) {
        await visit(abs, rel, depth + 1);
      } else if (linkStats.isFile()) {
        entries.push({ path: rel, abs, type: 'file', mode: ustarFileMode(linkStats), size: linkStats.size });
      } else {
        throw new TarFormatError('unsupported-entry', `unsupported file type: ${rel}`);
      }
    }
  };

  await visit(rootAbs, rootPrefix, 0);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/** Async generator producing the raw (uncompressed) tar byte stream. */
async function* tarByteStream(entries) {
  for (const entry of entries) {
    const entryPath = entry.path;
    const split = trySplitUstarPath(entryPath);

    if (split === null) {
      // pax extended header carries the real path (UTF-8, any length).
      const paxData = Buffer.from(paxRecord('path', entryPath), 'utf8');
      if (paxData.length > MAX_PAX_HEADER_BYTES) {
        throw new TarFormatError('too-large', `path too long to encode: ${entryPath.slice(0, 80)}…`);
      }
      yield buildHeader({
        name: paxHeaderName(entryPath),
        prefix: '',
        mode: 0o644,
        size: paxData.length,
        typeflag: 'x',
        mtime: 0,
      });
      yield paxData;
      const padding = paddingFor(paxData.length);
      if (padding > 0) yield ZERO_BLOCK.subarray(0, padding);
    }

    const isDir = entry.type === 'dir';
    const size = isDir ? 0 : entry.size;
    if (size > MAX_USTAR_FILE_BYTES) {
      throw new TarFormatError('too-large', `file too large for ustar: ${entryPath}`);
    }

    yield buildHeader({
      name: split === null ? fallbackUstarName(entryPath) : split.name,
      prefix: split === null ? '' : split.prefix,
      mode: entry.mode,
      size,
      typeflag: isDir ? '5' : '0',
      mtime: 0,
    });

    if (isDir) continue;

    let written = 0;
    for await (const chunk of createReadStream(entry.abs)) {
      written += chunk.length;
      yield chunk;
    }
    if (written !== size) {
      throw new TarFormatError(
        'source-changed',
        `file changed while packing (expected ${size} bytes, read ${written}): ${entryPath}`,
      );
    }
    const padding = paddingFor(size);
    if (padding > 0) yield ZERO_BLOCK.subarray(0, padding);
  }

  // End of archive: two zero blocks.
  yield ZERO_BLOCK;
  yield ZERO_BLOCK;
}

function paddingFor(length) {
  return (BLOCK_SIZE - (length % BLOCK_SIZE)) % BLOCK_SIZE;
}

function isAsciiPath(value) {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/**
 * Split an ASCII path into ustar name/prefix fields, or return null when it cannot be
 * represented (too long or non-ASCII → caller uses pax).
 */
function trySplitUstarPath(value) {
  if (!isAsciiPath(value)) return null;
  if (value.length <= USTAR_NAME_BYTES) return { name: value, prefix: '' };
  if (value.length > USTAR_NAME_BYTES + 1 + USTAR_PREFIX_BYTES) return null;

  const minSplit = Math.max(0, value.length - (USTAR_NAME_BYTES + 1));
  const maxSplit = Math.min(USTAR_PREFIX_BYTES, value.length - 2);
  for (let i = maxSplit; i >= minSplit; i -= 1) {
    if (value[i] !== '/') continue;
    const prefix = value.slice(0, i);
    const name = value.slice(i + 1);
    if (name.length === 0) continue;
    if (name.length <= USTAR_NAME_BYTES && prefix.length <= USTAR_PREFIX_BYTES) {
      return { name, prefix };
    }
  }
  return null;
}

/** ASCII-only fallback name written in the real header behind a pax path record. */
function fallbackUstarName(value) {
  const base = value.replace(/\/+$/, '').split('/').pop() || 'entry';
  let ascii = '';
  for (const char of base) {
    const code = char.codePointAt(0);
    ascii += code >= 0x20 && code <= 0x7e ? char : '_';
  }
  return (ascii.slice(0, USTAR_NAME_BYTES) || 'entry');
}

/** Name for the pax extended-header entry itself; must be ASCII and <= 100 bytes. */
function paxHeaderName(value) {
  const base = fallbackUstarName(value);
  return `PaxHeaders/${base.slice(0, USTAR_NAME_BYTES - 'PaxHeaders/'.length)}`;
}

/** One pax record: "<length> <key>=<value>\n" where <length> counts the whole record. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const bodyLength = Buffer.byteLength(body, 'utf8');
  let length = bodyLength + 1;
  for (;;) {
    const digits = String(length).length;
    if (digits + bodyLength === length) break;
    length = digits + bodyLength;
  }
  return `${length}${body}`;
}

function octalField(value, fieldBytes) {
  const digits = fieldBytes - 1;
  const encoded = Math.trunc(value).toString(8);
  if (!Number.isSafeInteger(Math.trunc(value)) || encoded.length > digits) {
    throw new TarFormatError('too-large', `numeric value ${value} does not fit in a ${fieldBytes}-byte tar field`);
  }
  return encoded.padStart(digits, '0') + '\0';
}

function writeLatin1(target, offset, length, value) {
  target.write(value, offset, length, 'latin1');
}

/** Build one 512-byte ustar header block. */
function buildHeader({ name, prefix = '', mode = 0o644, size = 0, typeflag = '0', mtime = 0, uid = 0, gid = 0, linkname = '' }) {
  if (!isAsciiPath(name) || !isAsciiPath(prefix) || !isAsciiPath(linkname)) {
    throw new TarFormatError('unsupported-entry', 'ustar header fields must be ASCII');
  }
  if (name.length > USTAR_NAME_BYTES || prefix.length > USTAR_PREFIX_BYTES || linkname.length > 100) {
    throw new TarFormatError('too-large', 'ustar header field overflow');
  }

  const block = Buffer.alloc(BLOCK_SIZE);
  writeLatin1(block, 0, USTAR_NAME_BYTES, name);
  block.write(octalField(mode, 8), 100, 8, 'latin1');
  block.write(octalField(uid, 8), 108, 8, 'latin1');
  block.write(octalField(gid, 8), 116, 8, 'latin1');
  block.write(octalField(size, 12), 124, 12, 'latin1');
  block.write(octalField(mtime, 12), 136, 12, 'latin1');
  block.fill(0x20, 148, 156); // checksum is computed with these 8 bytes as spaces
  block.write(typeflag, 156, 1, 'latin1');
  writeLatin1(block, 157, 100, linkname);
  block.write('ustar\0', 257, 6, 'latin1');
  block.write('00', 263, 2, 'latin1');
  // uname / gname stay empty (deterministic), devmajor/devminor are 0.
  block.write(octalField(0, 8), 329, 8, 'latin1');
  block.write(octalField(0, 8), 337, 8, 'latin1');
  writeLatin1(block, 345, USTAR_PREFIX_BYTES, prefix);

  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i += 1) checksum += block[i];
  const encoded = checksum.toString(8).padStart(6, '0');
  if (encoded.length > 6) throw new TarFormatError('too-large', 'tar checksum overflow');
  block.write(`${encoded}\0 `, 148, 8, 'latin1');
  return block;
}

// ---------------------------------------------------------------------------
// Streaming reader
// ---------------------------------------------------------------------------

function isZlibError(err) {
  return Boolean(err) && typeof err.code === 'string' && (err.code.startsWith('Z_') || err.code.startsWith('ERR_ZLIB'));
}

/** Pull-based byte reader over a decompressed chunk stream. */
class ByteSource {
  constructor(stream) {
    this.stream = stream;
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.finished = false;
  }

  async next() {
    let result;
    try {
      result = await this.iterator.next();
    } catch (err) {
      this.finished = true;
      if (isZlibError(err)) {
        throw new TarFormatError('invalid-gzip', `corrupt gzip stream: ${err.message}`, { cause: err });
      }
      throw err;
    }
    if (result.done) {
      this.finished = true;
      return false;
    }
    this.buffer = this.buffer.length === 0 ? result.value : Buffer.concat([this.buffer, result.value]);
    return true;
  }

  async readExact(length, what) {
    while (this.buffer.length < length) {
      if (!(await this.next())) {
        throw new TarFormatError('truncated', `unexpected end of archive while reading ${what}`);
      }
    }
    const out = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return out;
  }

  async readUpTo(maxLength) {
    if (this.buffer.length === 0 && !(await this.next())) return null;
    const length = Math.min(maxLength, this.buffer.length);
    const out = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return out;
  }

  async skip(length, what) {
    let remaining = length;
    while (remaining > 0) {
      const chunk = await this.readUpTo(remaining);
      if (chunk === null) {
        throw new TarFormatError('truncated', `unexpected end of archive while skipping ${what}`);
      }
      remaining -= chunk.length;
    }
  }

  async close() {
    try {
      await this.iterator.return?.();
    } catch {
      // Streams that are already finished/errored do not need a clean return.
    }
  }
}

function openTarGz(file) {
  const raw = createReadStream(file, { highWaterMark: 64 * 1024 });
  const gunzip = createGunzip();
  raw.on('error', (err) => gunzip.destroy(err));
  gunzip.on('error', () => {}); // consumed through the async iterator; avoid unhandled events
  raw.pipe(gunzip);
  const byteSource = new ByteSource(gunzip);
  return {
    byteSource,
    async close() {
      await byteSource.close();
      raw.destroy();
      gunzip.destroy();
    },
  };
}

function readCString(block, offset, length) {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end += 1;
  return block.toString('utf8', offset, end);
}

/** Parse a numeric tar field (octal, or GNU base-256 for very large values). */
function parseNumericField(block, offset, length, what) {
  if ((block[offset] & 0x80) !== 0) {
    const negative = (block[offset] & 0x40) !== 0;
    let accumulator = 0n;
    for (let i = 0; i < length; i += 1) {
      let byte = block[offset + i];
      if (i === 0) byte &= 0x7f;
      accumulator = (accumulator << 8n) | BigInt(byte);
    }
    if (negative) accumulator -= 1n << BigInt(length * 8 - 1);
    if (accumulator > BigInt(Number.MAX_SAFE_INTEGER) || accumulator < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new TarFormatError('too-large', `${what} field is too large`);
    }
    return Number(accumulator);
  }

  let index = offset;
  const limit = offset + length;
  while (index < limit && (block[index] === 0x20 || block[index] === 0x00)) index += 1;
  let value = 0;
  let sawDigit = false;
  while (index < limit) {
    const byte = block[index];
    if (byte < 0x30 || byte > 0x37) break;
    value = value * 8 + (byte - 0x30);
    sawDigit = true;
    index += 1;
  }
  if (!sawDigit) {
    if (block[offset] === 0 || block[offset] === 0x20) return 0;
    throw new TarFormatError('invalid-header', `invalid ${what} field in tar header`);
  }
  return value;
}

function decodeHeader(block) {
  const storedChecksum = parseNumericField(block, 148, 8, 'checksum');
  let unsignedSum = 0;
  let signedSum = 0;
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    const byte = i >= 148 && i < 156 ? 0x20 : block[i];
    unsignedSum += byte;
    signedSum += byte > 0x7f ? byte - 0x100 : byte;
  }
  if (storedChecksum !== unsignedSum && storedChecksum !== signedSum) {
    throw new TarFormatError(
      'invalid-header',
      `bad tar header checksum (stored ${storedChecksum}, computed ${unsignedSum})`,
    );
  }

  const typeByte = block[156];
  const magic = block.toString('latin1', 257, 263);
  return {
    name: readCString(block, 0, USTAR_NAME_BYTES),
    mode: parseNumericField(block, 100, 8, 'mode'),
    uid: parseNumericField(block, 108, 8, 'uid'),
    gid: parseNumericField(block, 116, 8, 'gid'),
    size: parseNumericField(block, 124, 12, 'size'),
    mtime: parseNumericField(block, 136, 12, 'mtime'),
    typeflag: typeByte === 0 ? '0' : String.fromCharCode(typeByte),
    linkname: readCString(block, 157, 100),
    prefix: magic.startsWith('ustar') ? readCString(block, 345, USTAR_PREFIX_BYTES) : '',
    magic,
  };
}

const PAX_NUMBER_KEYS = new Set(['size', 'mode', 'uid', 'gid', 'mtime', 'atime', 'ctime']);

function parsePaxData(data) {
  const result = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) break; // trailing NUL padding is tolerated
    const lengthText = data.toString('latin1', offset, space);
    const recordLength = Number.parseInt(lengthText, 10);
    if (!Number.isFinite(recordLength) || recordLength <= 0 || offset + recordLength > data.length) {
      throw new TarFormatError('invalid-header', 'malformed pax extended header record');
    }
    const record = data.subarray(space + 1, offset + recordLength);
    const equals = record.indexOf(0x3d); // '='
    if (equals <= 0) throw new TarFormatError('invalid-header', 'malformed pax extended header record');
    const key = record.toString('latin1', 0, equals);
    let valueBuffer = record.subarray(equals + 1);
    if (valueBuffer.length > 0 && valueBuffer[valueBuffer.length - 1] === 0x0a) {
      valueBuffer = valueBuffer.subarray(0, valueBuffer.length - 1);
    }
    const rawValue = valueBuffer.toString('utf8');
    if (PAX_NUMBER_KEYS.has(key)) {
      const numeric = Number(rawValue);
      if (Number.isFinite(numeric)) result[key] = numeric;
    } else {
      result[key] = rawValue;
    }
    offset += recordLength;
  }
  return result;
}

function typeOfFlag(typeflag) {
  switch (typeflag) {
    case '0':
    case '\0':
    case '7':
      return 'file';
    case '5':
      return 'dir';
    case '2':
      return 'symlink';
    default:
      return 'other';
  }
}

/** One tar entry; content must be consumed or discarded before advancing. */
function createEntry(byteSource, header, pax) {
  const paxPath = pax && typeof pax.path === 'string' ? pax.path : undefined;
  const entryPath = paxPath !== undefined
    ? paxPath
    : header.prefix !== ''
      ? `${header.prefix}/${header.name}`
      : header.name;
  const size = pax && typeof pax.size === 'number' && pax.size >= 0 ? pax.size : header.size;
  const mode = pax && typeof pax.mode === 'number' ? pax.mode : header.mode;

  let remaining = size;
  let paddingDone = false;
  const padding = paddingFor(size);

  const skipPadding = async () => {
    if (paddingDone) return;
    paddingDone = true;
    if (padding > 0) await byteSource.skip(padding, 'entry padding');
  };

  const entry = {
    path: entryPath,
    type: typeOfFlag(header.typeflag),
    size,
    mode,
    uid: header.uid,
    gid: header.gid,
    mtime: header.mtime,
    typeflag: header.typeflag,
    linkname: header.linkname,

    async *content() {
      while (remaining > 0) {
        const chunk = await byteSource.readUpTo(Math.min(remaining, CONTENT_CHUNK_SIZE));
        if (chunk === null) {
          throw new TarFormatError('truncated', `unexpected end of archive inside entry: ${entryPath}`);
        }
        remaining -= chunk.length;
        yield chunk;
      }
      await skipPadding();
    },

    async readAll() {
      const chunks = [];
      let total = 0;
      for await (const chunk of entry.content()) {
        chunks.push(chunk);
        total += chunk.length;
      }
      return Buffer.concat(chunks, total);
    },

    async discard() {
      if (remaining > 0) {
        await byteSource.skip(remaining, `entry ${entryPath}`);
        remaining = 0;
      }
      await skipPadding();
    },
  };

  return entry;
}

/** Async generator over all entries of a decompressed tar stream. */
async function* iterateEntries(byteSource) {
  let pendingPax = null;
  for (;;) {
    let block;
    try {
      block = await byteSource.readExact(BLOCK_SIZE, 'tar header');
    } catch (err) {
      if (err instanceof TarFormatError && err.code === 'truncated') return; // tolerate missing end blocks
      throw err;
    }
    if (block.equals(ZERO_BLOCK)) return;

    const header = decodeHeader(block);
    if (header.typeflag === 'x') {
      if (header.size > MAX_PAX_HEADER_BYTES) {
        throw new TarFormatError('too-large', 'pax extended header is too large');
      }
      const data = await byteSource.readExact(header.size, 'pax extended header');
      const padding = paddingFor(header.size);
      if (padding > 0) await byteSource.skip(padding, 'pax extended header padding');
      pendingPax = Object.assign(pendingPax ?? {}, parsePaxData(data));
      continue;
    }
    if (header.typeflag === 'g') {
      const padding = paddingFor(header.size);
      if (header.size > 0) await byteSource.skip(header.size, 'global pax extended header');
      if (padding > 0) await byteSource.skip(padding, 'global pax extended header padding');
      continue;
    }

    const entry = createEntry(byteSource, header, pendingPax);
    pendingPax = null;
    yield entry;
    await entry.discard(); // no-op when the consumer already drained the content
  }
}

// ---------------------------------------------------------------------------
// Public readers / extractor
// ---------------------------------------------------------------------------

/**
 * List entries without extracting.
 *
 * @param {string} file
 * @returns {Promise<Array<{ path: string, type: 'file'|'dir'|'symlink'|'other', size: number, mode: number }>>}
 */
export async function listTarGz(file) {
  if (typeof file !== 'string' || file === '') throw new TypeError('file is required');
  const source = openTarGz(file);
  const entries = [];
  try {
    for await (const entry of iterateEntries(source.byteSource)) {
      entries.push({ path: entry.path, type: entry.type, size: entry.size, mode: entry.mode });
      await entry.discard();
    }
    return entries;
  } finally {
    await source.close();
  }
}

function normalizeEntryPath(entryPath) {
  if (typeof entryPath !== 'string' || entryPath === '') {
    throw new TypeError('entryPath must be a non-empty string');
  }
  return entryPath.replace(/^\.\//, '').replace(/\/+$/, '');
}

function entryPathMatches(candidate, wanted) {
  if (candidate === wanted) return true;
  // Be forgiving when a caller passes the path without the default 'package/' prefix.
  if (!wanted.startsWith('package/')) return candidate === `package/${wanted}`;
  return false;
}

/**
 * Read one UTF-8 file entry, streaming and stopping as soon as it is found.
 *
 * @param {string} file
 * @param {string} entryPath raw entry path including the archive prefix, e.g. 'package/package.json'
 * @returns {Promise<string | null>}
 */
export async function readTarGzTextEntry(file, entryPath) {
  if (typeof file !== 'string' || file === '') throw new TypeError('file is required');
  const wanted = normalizeEntryPath(entryPath);
  const source = openTarGz(file);
  try {
    for await (const entry of iterateEntries(source.byteSource)) {
      if (entry.type === 'file' && entryPathMatches(entry.path, wanted)) {
        const data = await entry.readAll();
        return data.toString('utf8');
      }
      await entry.discard();
    }
    return null;
  } finally {
    await source.close();
  }
}

const WINDOWS_ABSOLUTE = /^[A-Za-z]:/;

/**
 * Split an already prefix-stripped entry path into safe path segments.
 * Rejects traversal, NUL bytes and absolute paths.
 */
function safeSegments(relativePath) {
  const segments = [];
  for (const rawSegment of relativePath.split('/')) {
    if (rawSegment === '' || rawSegment === '.') continue;
    if (rawSegment.includes('\0')) {
      throw new TarFormatError('unsafe-path', 'entry path contains a NUL byte');
    }
    // A literal '..' segment escapes; on Windows a backslash-separated '..' does too,
    // so check both encodings while preserving POSIX file names that contain '\\'.
    if (rawSegment === '..' || rawSegment.split('\\').includes('..')) {
      throw new TarFormatError('unsafe-path', `entry path escapes the destination: ${relativePath}`);
    }
    segments.push(rawSegment);
  }
  return segments;
}

function stripArchivePrefix(entryPath, prefix) {
  if (entryPath.includes('\0')) {
    throw new TarFormatError('unsafe-path', 'entry path contains a NUL byte');
  }
  if (entryPath.startsWith('/') || entryPath.startsWith('\\') || WINDOWS_ABSOLUTE.test(entryPath)) {
    throw new TarFormatError('unsafe-path', `refusing absolute entry path: ${entryPath}`);
  }
  let relative = entryPath;
  if (prefix !== '') {
    if (relative === prefix || relative === `${prefix}/`) return '';
    if (!relative.startsWith(`${prefix}/`)) {
      throw new TarFormatError('unsafe-path', `entry is outside archive prefix "${prefix}": ${entryPath}`);
    }
    relative = relative.slice(prefix.length + 1);
  }
  return relative;
}

/**
 * Verify that `candidate` (an existing path inside destDir) really lives below the
 * destination root — catches symlinked directories planted before extraction.
 */
async function ensureInsideDestination(candidate, realDestRoot, entryPath) {
  const real = await fsp.realpath(candidate);
  if (real !== realDestRoot && !real.startsWith(realDestRoot + path.sep)) {
    throw new TarFormatError('unsafe-path', `entry path escapes the destination through a symlink: ${entryPath}`);
  }
  return real;
}

/**
 * Extract safely into `destDir`, stripping `prefix` from entry paths.
 *
 * @param {{ file: string, destDir: string, prefix?: string }} options
 * @returns {Promise<{ files: number, dirs: number, bytes: number }>}
 */
export async function extractTarGz({ file, destDir, prefix = 'package' } = {}) {
  if (typeof file !== 'string' || file === '') throw new TypeError('file is required');
  if (typeof destDir !== 'string' || destDir === '') throw new TypeError('destDir is required');

  const destRoot = path.resolve(destDir);
  await fsp.mkdir(destRoot, { recursive: true });
  const realDestRoot = await fsp.realpath(destRoot);
  const archivePrefix = normalizePrefix(prefix);
  const source = openTarGz(file);
  const dirModes = [];
  let files = 0;
  let dirs = 0;
  let bytes = 0;

  try {
    for await (const entry of iterateEntries(source.byteSource)) {
      if (entry.type !== 'file' && entry.type !== 'dir') {
        throw new TarFormatError(
          'unsupported-entry',
          `refusing to extract ${entry.type} entry (type ${JSON.stringify(entry.typeflag)}): ${entry.path}`,
        );
      }

      const relative = stripArchivePrefix(entry.path, archivePrefix);
      const segments = safeSegments(relative);
      const target = segments.length === 0 ? destRoot : path.resolve(destRoot, ...segments);
      if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
        throw new TarFormatError('unsafe-path', `entry path escapes the destination: ${entry.path}`);
      }

      if (entry.type === 'dir') {
        await fsp.mkdir(target, { recursive: true });
        await ensureInsideDestination(target, realDestRoot, entry.path);
        if (target !== destRoot) {
          dirModes.push({ dir: target, mode: (entry.mode & 0o777) || 0o755 });
          dirs += 1;
        }
        await entry.discard();
        continue;
      }

      if (segments.length === 0) {
        throw new TarFormatError('unsupported-entry', `file entry cannot be the archive prefix: ${entry.path}`);
      }

      await fsp.mkdir(path.dirname(target), { recursive: true });
      await ensureInsideDestination(path.dirname(target), realDestRoot, entry.path);
      const existing = await fsp.lstat(target).catch(() => null);
      if (existing !== null && existing.isSymbolicLink()) {
        throw new TarFormatError('unsafe-path', `refusing to write through an existing symlink: ${entry.path}`);
      }
      const mode = (entry.mode & 0o777) || 0o644;
      await pipeline(Readable.from(entry.content(), { objectMode: false }), createWriteStream(target, { mode }));
      await fsp.chmod(target, mode);
      files += 1;
      bytes += entry.size;
    }
  } finally {
    await source.close();
  }

  // Apply directory modes last (deepest first) so read-only dirs cannot block extraction.
  dirModes.sort((a, b) => b.dir.length - a.dir.length);
  for (const { dir, mode } of dirModes) {
    await fsp.chmod(dir, mode).catch(() => {});
  }

  return { files, dirs, bytes };
}

import { gunzipSync } from 'node:zlib';

// Reads the parts of a Mihon backup (.tachibk) that Doctor needs. A backup is a gzipped
// protobuf `Backup` message; field numbers follow Mihon's backup models:
//   Backup:       1 backupManga (repeated), 101 backupSources (repeated)
//   BackupManga:  1 source (int64), 2 url, 3 title, 4 artist, 5 author, 6 description,
//                 18 tracking (repeated), 100 favorite (bool, defaults to true)
//   BackupTracking: 1 syncId (tracker), 3 mediaIdInt (old), 5 title, 100 mediaId (int64)
//   BackupSource: 1 name, 2 sourceId (int64)

export interface MihonTrack {
  /** Tracker id; Mihon and Suwayomi number them the same (1 MyAnimeList, 2 AniList, ...). */
  trackerId: number;
  /** The series' id on that tracker. */
  remoteId: string;
  /** The title the tracker uses, often the romanized or English one. */
  title: string;
}

export interface MihonManga {
  sourceId: string;
  url: string;
  title: string;
  author: string;
  artist: string;
  description: string;
  tracks: MihonTrack[];
  favorite: boolean;
}

export interface MihonSource {
  sourceId: string;
  name: string;
}

export interface MihonBackup {
  manga: MihonManga[];
  sources: MihonSource[];
}

export class BackupFormatError extends Error {}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.pos >= this.buf.length) throw new BackupFormatError('Unexpected end of backup');
      const byte = this.buf[this.pos++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) throw new BackupFormatError('Malformed number in backup');
    }
  }

  bytes(): Uint8Array {
    const len = Number(this.varint());
    if (this.pos + len > this.buf.length) throw new BackupFormatError('Unexpected end of backup');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  /** Calls `onField` for each field, skipping the ones it doesn't consume. */
  fields(onField: (field: number, wireType: number) => boolean): void {
    while (!this.done) {
      const key = Number(this.varint());
      const field = key >>> 3;
      const wireType = key & 7;
      if (onField(field, wireType)) continue;
      this.skip(wireType);
    }
  }

  private skip(wireType: number): void {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.bytes();
    else if (wireType === 5) this.pos += 4;
    else throw new BackupFormatError(`Unsupported field type ${wireType} in backup`);
  }
}

const utf8 = new TextDecoder();

/** Protobuf int64 is two's complement in a 64-bit varint. */
function int64(v: bigint): string {
  return BigInt.asIntN(64, v).toString();
}

function readTrack(buf: Uint8Array): MihonTrack {
  const t = { trackerId: 0, remoteId: '0', oldRemoteId: '0', title: '' };
  const r = new Reader(buf);
  r.fields((field, wire) => {
    if (field === 1 && wire === 0) t.trackerId = Number(r.varint());
    else if (field === 3 && wire === 0) t.oldRemoteId = int64(r.varint());
    else if (field === 5 && wire === 2) t.title = utf8.decode(r.bytes());
    else if (field === 100 && wire === 0) t.remoteId = int64(r.varint());
    else return false;
    return true;
  });
  return { trackerId: t.trackerId, remoteId: t.remoteId !== '0' ? t.remoteId : t.oldRemoteId, title: t.title };
}

function readManga(buf: Uint8Array): MihonManga {
  const m: MihonManga = { sourceId: '0', url: '', title: '', author: '', artist: '', description: '', tracks: [], favorite: true };
  const r = new Reader(buf);
  r.fields((field, wire) => {
    if (field === 1 && wire === 0) m.sourceId = int64(r.varint());
    else if (field === 2 && wire === 2) m.url = utf8.decode(r.bytes());
    else if (field === 3 && wire === 2) m.title = utf8.decode(r.bytes());
    else if (field === 4 && wire === 2) m.artist = utf8.decode(r.bytes());
    else if (field === 5 && wire === 2) m.author = utf8.decode(r.bytes());
    else if (field === 6 && wire === 2) m.description = utf8.decode(r.bytes());
    else if (field === 18 && wire === 2) m.tracks.push(readTrack(r.bytes()));
    else if (field === 100 && wire === 0) m.favorite = r.varint() !== 0n;
    else return false;
    return true;
  });
  return m;
}

function readSource(buf: Uint8Array): MihonSource {
  const s: MihonSource = { sourceId: '0', name: '' };
  const r = new Reader(buf);
  r.fields((field, wire) => {
    if (field === 1 && wire === 2) s.name = utf8.decode(r.bytes());
    else if (field === 2 && wire === 0) s.sourceId = int64(r.varint());
    else return false;
    return true;
  });
  return s;
}

export function parseBackup(file: Uint8Array): MihonBackup {
  let raw: Uint8Array = file;
  if (file[0] === 0x1f && file[1] === 0x8b) {
    try {
      raw = gunzipSync(file);
    } catch {
      throw new BackupFormatError("This file looks compressed but couldn't be unpacked. Is it a complete .tachibk backup?");
    }
  }
  const backup: MihonBackup = { manga: [], sources: [] };
  const r = new Reader(raw);
  try {
    r.fields((field, wire) => {
      if (field === 1 && wire === 2) backup.manga.push(readManga(r.bytes()));
      else if (field === 101 && wire === 2) backup.sources.push(readSource(r.bytes()));
      else return false;
      return true;
    });
  } catch (err) {
    if (err instanceof BackupFormatError) throw new BackupFormatError("This doesn't look like a Mihon backup. Choose the .tachibk file Mihon created.");
    throw err;
  }
  if (backup.manga.length === 0) throw new BackupFormatError('No library entries found in this file. Is it a Mihon .tachibk backup?');
  return backup;
}

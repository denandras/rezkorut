/**
 * Minimal store-only (no compression) ZIP archive writer.
 *
 * Photos/videos/scores (jpg, heic, mp4, pdf) barely compress, so we skip
 * DEFLATE entirely — this keeps the code dependency-free and lets us stream
 * S3 objects straight into the HTTP response without buffering.
 *
 * Format: local file headers with the data-descriptor flag (bit 3) so CRC
 * and sizes are written AFTER each file's data (unknown until streamed),
 * UTF-8 filename flag (bit 11) so Hungarian names survive, then the central
 * directory. No ZIP64: individual files and the total archive are capped by
 * the caller well below 4 GiB.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Init(): number {
  return 0xffffffff;
}

function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < chunk.length; i += 1) {
    c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  }
  return c;
}

function crc32Final(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  const time =
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export type ZipEntry = {
  /** Full path inside the archive, `/`-separated, UTF-8. */
  name: string;
  lastModified?: Date;
  /** Returns the file's byte stream. */
  getStream: () => AsyncIterable<Uint8Array>;
};

type WrittenEntry = {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

const encoder = new TextEncoder();

const LOCAL_FLAG = 0x0808; // bit 3: data descriptor, bit 11: UTF-8 names
const ZIP_VERSION = 20;

/**
 * Streams a ZIP archive into a web ReadableStream. Entries are written
 * sequentially; nothing but the running CRC/offset is held in memory.
 */
export function streamZip(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const central: WrittenEntry[] = [];
      let offset = 0;

      const push = (chunk: Uint8Array) => {
        controller.enqueue(chunk);
        offset += chunk.length;
      };

      try {
        for (const entry of entries) {
          const nameBytes = encoder.encode(entry.name);
          const { time, date } = dosDateTime(entry.lastModified ?? new Date());
          const entryOffset = offset;

          // Local file header
          push(u32(0x04034b50));
          push(u16(ZIP_VERSION));
          push(u16(LOCAL_FLAG));
          push(u16(0)); // store
          push(u16(time));
          push(u16(date));
          push(u32(0)); // crc in descriptor
          push(u32(0)); // compressed size in descriptor
          push(u32(0)); // uncompressed size in descriptor
          push(u16(nameBytes.length));
          push(u16(0)); // no extra field
          push(nameBytes);

          let crc = crc32Init();
          let size = 0;
          for await (const chunk of entry.getStream()) {
            const bytes =
              chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            crc = crc32Update(crc, bytes);
            size += bytes.length;
            push(bytes);
          }
          const crcFinal = crc32Final(crc);
          if (size > 0xffffffff) {
            throw new Error(`File too large for ZIP: ${entry.name}`);
          }

          // Data descriptor (with signature — some unzip tools require it)
          push(u32(0x08074b50));
          push(u32(crcFinal));
          push(u32(size)); // compressed == uncompressed (store)
          push(u32(size));

          central.push({
            nameBytes,
            crc: crcFinal,
            size,
            offset: entryOffset,
            time,
            date,
          });
        }

        const centralStart = offset;

        for (const e of central) {
          push(u32(0x02014b50));
          push(u16(ZIP_VERSION)); // version made by
          push(u16(ZIP_VERSION)); // version needed
          push(u16(LOCAL_FLAG));
          push(u16(0)); // store
          push(u16(e.time));
          push(u16(e.date));
          push(u32(e.crc));
          push(u32(e.size));
          push(u32(e.size));
          push(u16(e.nameBytes.length));
          push(u16(0)); // extra
          push(u16(0)); // comment
          push(u16(0)); // disk number
          push(u16(0)); // internal attrs
          push(u32(0)); // external attrs
          push(u32(e.offset));
          push(e.nameBytes);
        }

        const centralSize = offset - centralStart;

        push(u32(0x06054b50));
        push(u16(0)); // disk
        push(u16(0)); // central dir disk
        push(u16(central.length));
        push(u16(central.length));
        push(u32(centralSize));
        push(u32(centralStart));
        push(u16(0)); // comment length

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

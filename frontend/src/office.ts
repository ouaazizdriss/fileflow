// Dependency-free reader for Office Open XML Word documents (.docx).
//
// docx files are ZIP archives of XML parts. We avoid pulling in a heavy
// office-rendering dependency (the Docker build installs with a frozen
// lockfile) by reading the ZIP central directory ourselves and inflating the
// few XML parts we need with the browser's native `DecompressionStream`.
//
// Output is plain text that the React viewer renders as escaped text nodes —
// never via innerHTML — so a malicious document cannot inject script
// (consistent with the app's no-raw-HTML policy). PowerPoint has no in-app
// preview (it is download-only), so no pptx parsing lives here.

interface ZipEntry {
  name: string
  method: number // 0 = stored, 8 = deflate
  compSize: number
  offset: number // local-header offset
}

interface Zip {
  entries: ZipEntry[]
  view: DataView
  bytes: Uint8Array
}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

function parseZip(buf: ArrayBuffer): Zip {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)

  // Locate the End Of Central Directory record (scan back; max comment 65535).
  let eocd = -1
  const minEnd = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= minEnd; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a valid Office file (no ZIP end record)')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true) // central directory offset
  const entries: ZipEntry[] = []
  const dec = new TextDecoder()

  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== SIG_CENTRAL) break
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const offset = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    entries.push({ name, method, compSize, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries, view, bytes }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: unknown }).DecompressionStream as
    | (new (format: string) => ReadableWritablePair<Uint8Array, Uint8Array>)
    | undefined
  if (!DS) {
    throw new Error('This browser cannot decompress Office files (no DecompressionStream)')
  }
  // Copy into a fresh ArrayBuffer-backed array so the Blob part type is exact
  // (avoids the SharedArrayBuffer union in newer TS typed-array generics).
  const copy = new Uint8Array(data.length)
  copy.set(data)
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DS('deflate-raw'))
  const ab = await new Response(stream as unknown as ReadableStream).arrayBuffer()
  return new Uint8Array(ab)
}

async function readEntry(z: Zip, e: ZipEntry): Promise<Uint8Array> {
  const lo = e.offset
  if (z.view.getUint32(lo, true) !== SIG_LOCAL) throw new Error('Corrupt Office file (bad local header)')
  // The local header may carry different extra-field length than the central
  // directory, so the data offset is computed from the local header itself.
  const nameLen = z.view.getUint16(lo + 26, true)
  const extraLen = z.view.getUint16(lo + 28, true)
  const start = lo + 30 + nameLen + extraLen
  const comp = z.bytes.subarray(start, start + e.compSize)
  if (e.method === 0) return comp.slice()
  if (e.method === 8) return inflateRaw(comp)
  throw new Error(`Unsupported ZIP compression method ${e.method}`)
}

async function readText(z: Zip, name: string): Promise<string | null> {
  const entry = z.entries.find((e) => e.name === name)
  if (!entry) return null
  return new TextDecoder().decode(await readEntry(z, entry))
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&') // must run last
}

/** A docx is a sequence of paragraphs; we keep each paragraph's plain text. */
export async function extractDocx(buf: ArrayBuffer): Promise<string[]> {
  const z = parseZip(buf)
  const xml = await readText(z, 'word/document.xml')
  if (xml == null) throw new Error('Not a Word document (missing word/document.xml)')

  const paragraphs: string[] = []
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(xml))) {
    const inner = pm[1]
    let text = ''
    const tRe = /<w:tab\b[^>]*\/>|<w:br\b[^>]*\/?>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(inner))) {
      if (tm[0].startsWith('<w:tab')) text += '\t'
      else if (tm[0].startsWith('<w:br')) text += '\n'
      else text += decodeEntities(tm[1] ?? '')
    }
    paragraphs.push(text)
  }
  return paragraphs
}

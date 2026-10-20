// File output: atomic writes (temp file + rename), JSON reading with a fallback, and directory swaps so a reader of
// the data branch never sees half of a dataset.
import { mkdir, rename, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { stableStringify } from './util.mjs'

let counter = 0
export async function writeFileAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${++counter}`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

export const writeJSON = (file, value, { pretty = false } = {}) => writeFileAtomic(file, stableStringify(value, pretty ? 1 : 0) + '\n')

export async function readJSON(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}
export function readJSONSync(file, fallback = null) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback } catch { return fallback }
}

/** Every file under dir (relative paths, sorted). */
export async function listFiles(dir) {
  if (!existsSync(dir)) return []
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath ?? d.path, d.name)))
    .sort()
}

/**
 * Replaces target with the fully written staging directory: target → target.old, staging → target, remove old.
 * If the second rename fails the old directory is put back, so the previous dataset is never lost.
 */
export async function swapDir(staging, target) {
  const old = target + '.old-' + process.pid
  const had = existsSync(target)
  if (had) await rename(target, old)
  try { await rename(staging, target) } catch (e) { if (had) await rename(old, target); throw e }
  if (had) await rm(old, { recursive: true, force: true })
}

export async function dirSize(dir) {
  let total = 0
  for (const f of await listFiles(dir)) total += (await stat(path.join(dir, f))).size
  return total
}

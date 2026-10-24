// Site visit reports: notes and photos taken at the site, printed as a site
// observation report. Photos are shrunk on the phone before uploading (so they
// upload quickly on a weak signal) and kept in a private storage bucket.
import { useEffect, useState } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import type { Store } from './store'
import type { SitePhoto, SiteVisit, Task } from './types'
import { supabase } from './supabase'
import { taskDay } from './views'
import { todayISO } from './utils'

export const PHOTO_BUCKET = 'site-photos'

export const DEFAULT_VISIT_CLOSING = 'These observations are based on a visual review of the work that was accessible at the time of the visit. The visit was made to observe general conformance with the structural design; it is not a special inspection and does not guarantee the contractor\'s work. The contractor remains responsible for construction means, methods and safety, and for building the work to the approved plans. Please contact me with any questions.'

/** The closing paragraph a new report starts with. */
export const visitClosing = (settings: Pick<Store['settings'], 'visit_closing'>) => settings.visit_closing?.trim() || DEFAULT_VISIT_CLOSING

/** Lines of a notes box as report items, without any bullets or numbers typed in front. */
export function listItems(text: string): string[] {
  return text.split('\n').map(l => l.replace(/^\s*(?:[•●▪◦*–—-]|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean)
}

/** Nothing has been written or photographed yet. */
export function isBlankVisit(v: SiteVisit, photos: number): boolean {
  return photos === 0 && ![v.purpose, v.weather, v.present, v.observations, v.corrections].some(s => s.trim())
}

/** The scheduled site visit a new report is most likely for: one in the last few days without a report. */
export function visitTaskFor(store: Pick<Store, 'tasks' | 'siteVisits'>, jobId: string, today = todayISO()): Task | undefined {
  const reported = new Set(store.siteVisits.map(v => v.task_id))
  const earliest = format(subDays(parseISO(today), 3), 'yyyy-MM-dd')
  return store.tasks
    .filter(t => { const day = taskDay(t); return t.job_id === jobId && t.is_site_visit && !reported.has(t.id) && day != null && day >= earliest && day <= today })
    .sort((a, b) => (taskDay(b) ?? '').localeCompare(taskDay(a) ?? ''))[0]
}

/** A report's visit date: the scheduled day if it has passed (written up afterwards), else today. */
export function visitDateFor(task: Task | undefined, today = todayISO()): string {
  const day = task ? taskDay(task) : null
  return day && day < today ? day : today
}

type VisitStore = Pick<Store, 'insert' | 'toast' | 'sitePhotos'>

/* ---------------- Photos ---------------- */

const MAX_EDGE = 1600

/** Shrink a photo to at most 1600 px on its long side, as a JPEG (about 300–500 KB). */
export async function prepareImage(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode() // browsers turn phone photos upright here (EXIF orientation)
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No canvas')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not read the photo')), 'image/jpeg', 0.82))
  } finally {
    URL.revokeObjectURL(url)
  }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * Upload photos to a visit, one at a time so each one shows as soon as it's in.
 * Returns how many were added; problems are reported as toasts.
 */
export async function addPhotos(store: VisitStore, visit: Pick<SiteVisit, 'id' | 'job_id'>, files: File[], onProgress?: (done: number) => void): Promise<number> {
  let order = Math.max(0, ...store.sitePhotos.filter(p => p.visit_id === visit.id).map(p => p.sort_order))
  let added = 0
  for (const [i, file] of files.entries()) {
    let blob: Blob
    try { blob = await prepareImage(file) }
    catch { store.toast(`Couldn't open ${file.name || 'that photo'}. Use a JPEG or PNG photo (take it with the camera, or export it from Photos).`, 'error'); continue }
    const path = `${visit.job_id}/${visit.id}/${newId()}.jpg`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
    if (error) { store.toast(`Photo not uploaded (${error.message}). Check your signal and try again.`, 'error'); continue }
    rememberLocal(path, blob)
    const row = await store.insert('site_photos', { visit_id: visit.id, path, caption: '', sort_order: ++order })
    if (!row) { await supabase.storage.from(PHOTO_BUCKET).remove([path]); continue }
    added++
    onProgress?.(i + 1)
  }
  return added
}

export async function deletePhoto(store: Pick<Store, 'remove'>, photo: SitePhoto): Promise<boolean> {
  const ok = await store.remove('site_photos', photo.id)
  if (ok) await supabase.storage.from(PHOTO_BUCKET).remove([photo.path])
  return ok
}

/** Delete a visit, its photo records and the photo files. */
export async function deleteVisit(store: Pick<Store, 'remove' | 'sitePhotos'>, visit: SiteVisit): Promise<boolean> {
  const paths = store.sitePhotos.filter(p => p.visit_id === visit.id).map(p => p.path)
  const ok = await store.remove('site_visits', visit.id)
  if (ok) await removePhotoFiles(paths)
  return ok
}

/** Photo files of a job's visits, so they can be cleaned up after the job is deleted. */
export function jobPhotoPaths(store: Pick<Store, 'siteVisits' | 'sitePhotos'>, jobId: string): string[] {
  const visits = new Set(store.siteVisits.filter(v => v.job_id === jobId).map(v => v.id))
  return store.sitePhotos.filter(p => visits.has(p.visit_id)).map(p => p.path)
}

export async function removePhotoFiles(paths: string[]): Promise<void> {
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths)
}

/* ---------------- Showing photos ---------------- */

// Private photos are shown through links that expire; keep them for a while
// so lists and the printed report don't ask again for every photo.
const LINK_SECONDS = 12 * 60 * 60
const urls = new Map<string, { url: string; expires: number }>()

function rememberLocal(path: string, blob: Blob) {
  if (typeof URL.createObjectURL === 'function') urls.set(path, { url: URL.createObjectURL(blob), expires: Infinity })
}

const fresh = (path: string) => { const u = urls.get(path); return u && u.expires > Date.now() + 5 * 60_000 ? u.url : null }

/** Viewable links for photo paths. Missing ones fill in once they've loaded. */
export function usePhotoUrls(paths: string[]): Record<string, string> {
  const [, setVersion] = useState(0)
  const key = paths.join('|')
  useEffect(() => {
    const missing = key ? key.split('|').filter(p => !fresh(p)) : []
    if (!missing.length) return
    let cancelled = false
    void supabase.storage.from(PHOTO_BUCKET).createSignedUrls(missing, LINK_SECONDS).then(({ data }) => {
      const expires = Date.now() + LINK_SECONDS * 1000
      for (const item of data ?? []) if (item.path && item.signedUrl) urls.set(item.path, { url: item.signedUrl, expires })
      if (!cancelled) setVersion(v => v + 1)
    })
    return () => { cancelled = true }
  }, [key])
  const out: Record<string, string> = {}
  for (const p of paths) { const u = urls.get(p); if (u) out[p] = u.url }
  return out
}

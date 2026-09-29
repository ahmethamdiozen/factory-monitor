import { createAvatar } from '@dicebear/core'
import { avataaarsNeutral } from '@dicebear/collection'

const cache = new Map<string, string>()

/** Offline, deterministik profil görseli (data URI). */
export function avatarUri(seed: string): string {
  let uri = cache.get(seed)
  if (!uri) {
    uri = createAvatar(avataaarsNeutral, { seed, radius: 50, backgroundColor: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'] }).toDataUri()
    cache.set(seed, uri)
  }
  return uri
}

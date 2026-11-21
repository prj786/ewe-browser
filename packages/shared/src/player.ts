// What "Play in ewe Player" offers itself for: a link or a page that is a video on a
// site yt-dlp knows (ewe Player plays those links through yt-dlp, `ewe-player <url>`),
// or a direct media file. Pure, so main decides from its own copy of the menu.

/** Direct media files ewe Player opens as they are (GStreamer, HLS through the loopback server). */
const MEDIA_FILE = /\.(mp4|m4v|webm|mkv|mov|ogv|avi|m3u8|mpd)$/i

interface SiteRule {
  hosts: readonly string[]
  path: RegExp
  /** a query parameter that must be present (YouTube's watch?v=) */
  param?: string
}

/** Video pages of the sites people paste most; every one is a yt-dlp extractor. */
const SITES: readonly SiteRule[] = [
  { hosts: ['youtube.com', 'm.youtube.com', 'music.youtube.com'], path: /^\/watch$/, param: 'v' },
  { hosts: ['youtube.com', 'm.youtube.com'], path: /^\/(shorts|live|embed)\/[\w-]{6,}/ },
  { hosts: ['youtu.be'], path: /^\/[\w-]{6,}$/ },
  { hosts: ['youtube-nocookie.com'], path: /^\/embed\/[\w-]{6,}/ },
  { hosts: ['vimeo.com'], path: /^\/(\d+|channels\/[^/]+\/\d+|video\/\d+)\/?$/ },
  { hosts: ['player.vimeo.com'], path: /^\/video\/\d+/ },
  { hosts: ['twitch.tv', 'm.twitch.tv'], path: /^\/(videos\/\d+|[\w]+\/clip\/[\w-]+)/ },
  { hosts: ['clips.twitch.tv'], path: /^\/[\w-]+$/ },
  { hosts: ['dailymotion.com'], path: /^\/video\/[a-z0-9]+/i },
  { hosts: ['dai.ly'], path: /^\/[a-z0-9]+$/i },
  { hosts: ['tiktok.com'], path: /^\/@[^/]+\/video\/\d+/ },
  { hosts: ['rumble.com'], path: /^\/v[a-z0-9]+-/i },
  { hosts: ['streamable.com'], path: /^\/[a-z0-9]+$/i },
  { hosts: ['bilibili.com'], path: /^\/video\/[a-z0-9]+/i },
  { hosts: ['instagram.com'], path: /^\/(reel|reels|tv)\/[\w-]+/ },
  { hosts: ['facebook.com'], path: /^\/(watch\/?$|[^/]+\/videos\/|reel\/)/ },
  { hosts: ['fb.watch'], path: /^\/[\w-]+/ },
  { hosts: ['v.redd.it'], path: /^\/[a-z0-9]+/i },
  { hosts: ['odysee.com'], path: /^\/@[^/]+\/[^/]+/ },
  { hosts: ['archive.org'], path: /^\/details\/[^/]+/ },
  { hosts: ['ted.com'], path: /^\/talks\/[\w-]+/ },
  { hosts: ['soundcloud.com'], path: /^\/[\w-]+\/[\w-]+\/?$/ },
]

function hostMatches(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return hosts.some((x) => h === x)
}

/** Whether ewe Player can take this http(s) address: a video page or a media file. */
export function isPlayableUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (MEDIA_FILE.test(url.pathname)) return true
  return SITES.some(
    (rule) =>
      hostMatches(url.hostname, rule.hosts) &&
      rule.path.test(url.pathname) &&
      (rule.param === undefined || (url.searchParams.get(rule.param) ?? '') !== ''),
  )
}

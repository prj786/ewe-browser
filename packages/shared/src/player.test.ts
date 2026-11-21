import { describe, expect, it } from 'vitest'
import { isPlayableUrl } from './player'

describe('isPlayableUrl', () => {
  it('takes video pages of the sites yt-dlp knows', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      'https://music.youtube.com/watch?v=abc123def45',
      'https://www.youtube.com/shorts/abc123def45',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://vimeo.com/76979871',
      'https://www.twitch.tv/videos/123456789',
      'https://www.dailymotion.com/video/x8abcd1',
      'https://www.tiktok.com/@someone/video/7234567890123456789',
      'https://streamable.com/abc12',
      'https://www.bilibili.com/video/BV1xx411c7mD',
      'https://www.ted.com/talks/some_talk_name',
    ])
      expect(isPlayableUrl(url), url).toBe(true)
  })

  it('takes direct media files', () => {
    for (const url of [
      'https://example.org/clip.mp4',
      'http://example.org/a/b/movie.MKV',
      'https://cdn.example.org/live/index.m3u8?token=1',
      'https://example.org/v.webm',
    ])
      expect(isPlayableUrl(url), url).toBe(true)
  })

  it('leaves everything else alone', () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/watch',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com/results?search_query=sheep',
      'https://vimeo.com/channels',
      'https://example.org/watch?v=x',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'file:///home/me/clip.mp4',
      'app://files/clip.mp4',
      'javascript:alert(1)',
      'not a url',
      '',
    ])
      expect(isPlayableUrl(url), url).toBe(false)
  })
})

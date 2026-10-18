import { For, Match, Switch, type JSX } from 'solid-js'

type Shape =
  | { path: string }
  | { circle: { cx: number; cy: number; r: number } }
  | { rect: { x: number; y: number; width: number; height: number; rx: number } }
  | { line: { x1: number; x2: number; y1: number; y2: number } }

const ICONS = {
  house: [
    { path: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' },
    {
      path: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    },
  ],
  settings: [
    {
      path: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    },
    { circle: { cx: 12, cy: 12, r: 3 } },
  ],
  user: [
    { path: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' },
    { circle: { cx: 12, cy: 7, r: 4 } },
  ],
  plus: [{ path: 'M5 12h14' }, { path: 'M12 5v14' }],
  x: [{ path: 'M18 6 6 18' }, { path: 'm6 6 12 12' }],
  download: [
    { path: 'M12 15V3' },
    { path: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
    { path: 'm7 10 5 5 5-5' },
  ],
  sparkles: [
    {
      path: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    },
    { path: 'M20 2v4' },
    { path: 'M22 4h-4' },
    { circle: { cx: 4, cy: 20, r: 2 } },
  ],
  history: [
    { path: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
    { path: 'M3 3v5h5' },
    { path: 'M12 7v5l4 2' },
  ],
  search: [{ path: 'm21 21-4.34-4.34' }, { circle: { cx: 11, cy: 11, r: 8 } }],
  globe: [
    { circle: { cx: 12, cy: 12, r: 10 } },
    { path: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' },
    { path: 'M2 12h20' },
  ],
  'app-window': [
    { rect: { x: 2, y: 4, width: 20, height: 16, rx: 2 } },
    { path: 'M10 4v4' },
    { path: 'M2 8h20' },
    { path: 'M6 4v4' },
  ],
  'arrow-right': [{ path: 'M5 12h14' }, { path: 'm12 5 7 7-7 7' }],
  'rotate-cw': [
    { path: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' },
    { path: 'M21 3v5h-5' },
  ],
  'volume-2': [
    {
      path: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
    },
    { path: 'M16 9a5 5 0 0 1 0 6' },
    { path: 'M19.364 18.364a9 9 0 0 0 0-12.728' },
  ],
  'volume-x': [
    {
      path: 'M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z',
    },
    { path: 'm16.5 14.5 5-5' },
    { path: 'm16.5 9.5 5 5' },
  ],
  'circle-alert': [
    { circle: { cx: 12, cy: 12, r: 10 } },
    { line: { x1: 12, x2: 12, y1: 8, y2: 12 } },
    { line: { x1: 12, x2: 12.01, y1: 16, y2: 16 } },
  ],
  'chevron-down': [{ path: 'm6 9 6 6 6-6' }],
  'chevron-right': [{ path: 'm9 18 6-6-6-6' }],
  copy: [
    { rect: { x: 8, y: 8, width: 14, height: 14, rx: 2 } },
    { path: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' },
  ],
  link: [
    { path: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' },
    { path: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' },
  ],
  layers: [
    {
      path: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
    },
    { path: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' },
    { path: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
  ],
  pencil: [
    {
      path: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    },
    { path: 'm15 5 4 4' },
  ],
  moon: [
    {
      path: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401',
    },
  ],
  pin: [
    { path: 'M12 17v5' },
    {
      path: 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    },
  ],
  'pin-off': [
    { path: 'M12 17v5' },
    { path: 'M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89' },
    { path: 'm2 2 20 20' },
    { path: 'M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11' },
  ],
  bookmark: [{ path: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' }],
  star: [
    {
      path: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
    },
  ],
  folder: [
    {
      path: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    },
  ],
  'folder-plus': [
    { path: 'M12 10v6' },
    { path: 'M9 13h6' },
    {
      path: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
    },
  ],
  'trash-2': [
    { path: 'M3 6h18' },
    { path: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' },
    { path: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' },
    { line: { x1: 10, x2: 10, y1: 11, y2: 17 } },
    { line: { x1: 14, x2: 14, y1: 11, y2: 17 } },
  ],
  'external-link': [
    { path: 'M15 3h6v6' },
    { path: 'M10 14 21 3' },
    { path: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' },
  ],
  'chevron-left': [{ path: 'm15 18-6-6 6-6' }],
  import: [
    { path: 'M12 3v12' },
    { path: 'm8 11 4 4 4-4' },
    { path: 'M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4' },
  ],
  pause: [
    { rect: { x: 14, y: 3, width: 5, height: 18, rx: 1 } },
    { rect: { x: 5, y: 3, width: 5, height: 18, rx: 1 } },
  ],
  play: [
    {
      path: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
    },
  ],
  'rotate-ccw': [
    { path: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' },
    { path: 'M3 3v5h5' },
  ],
  'folder-open': [
    {
      path: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
    },
  ],
  file: [
    { path: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' },
    { path: 'M14 2v4a2 2 0 0 0 2 2h4' },
  ],
  check: [{ path: 'M20 6 9 17l-5-5' }],
  'arrow-left': [{ path: 'm12 19-7-7 7-7' }, { path: 'M19 12H5' }],
  'refresh-cw': [
    { path: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' },
    { path: 'M21 3v5h-5' },
    { path: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' },
    { path: 'M8 16H3v5' },
  ],
  puzzle: [
    {
      path: 'M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z',
    },
  ],
  zap: [
    {
      path: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
    },
  ],
  power: [{ path: 'M12 2v10' }, { path: 'M18.4 6.6a9 9 0 1 1-12.77.04' }],
  'key-round': [
    {
      path: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z',
    },
    { circle: { cx: 16.5, cy: 7.5, r: 0.5 } },
  ],
  lock: [
    { rect: { x: 3, y: 11, width: 18, height: 11, rx: 2 } },
    { path: 'M7 11V7a5 5 0 0 1 10 0v4' },
  ],
  'lock-open': [
    { rect: { x: 3, y: 11, width: 18, height: 11, rx: 2 } },
    { path: 'M7 11V7a5 5 0 0 1 9.9-1' },
  ],
  camera: [
    {
      path: 'M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z',
    },
    { circle: { cx: 12, cy: 13, r: 3 } },
  ],
  mic: [
    { path: 'M12 19v3' },
    { path: 'M19 10v2a7 7 0 0 1-14 0v-2' },
    { rect: { x: 9, y: 2, width: 6, height: 13, rx: 3 } },
  ],
  'map-pin': [
    {
      path: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
    },
    { circle: { cx: 12, cy: 10, r: 3 } },
  ],
  bell: [
    { path: 'M10.268 21a2 2 0 0 0 3.464 0' },
    {
      path: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
    },
  ],
  network: [
    { rect: { x: 16, y: 16, width: 6, height: 6, rx: 1 } },
    { rect: { x: 2, y: 16, width: 6, height: 6, rx: 1 } },
    { rect: { x: 9, y: 2, width: 6, height: 6, rx: 1 } },
    { path: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' },
    { path: 'M12 12V8' },
  ],
  'shield-check': [
    {
      path: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    },
    { path: 'm9 12 2 2 4-4' },
  ],
  'triangle-alert': [
    { path: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' },
    { path: 'M12 9v4' },
    { path: 'M12 17h.01' },
  ],
  fingerprint: [
    { path: 'M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4' },
    { path: 'M14 13.12c0 2.38 0 6.38-1 8.88' },
    { path: 'M17.29 21.02c.12-.6.43-2.3.5-3.02' },
    { path: 'M2 12a10 10 0 0 1 18-6' },
    { path: 'M2 16h.01' },
    { path: 'M21.8 16c.2-2 .131-5.354 0-6' },
    { path: 'M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2' },
    { path: 'M8.65 22c.21-.66.45-1.32.57-2' },
    { path: 'M9 6.8a6 6 0 0 1 9 5.2v2' },
  ],
  usb: [
    { circle: { cx: 10, cy: 7, r: 1 } },
    { circle: { cx: 4, cy: 20, r: 1 } },
    { path: 'M4.7 19.3 19 5' },
    { path: 'm21 3-3 1 2 2Z' },
    { path: 'M9.26 7.68 5 12l2 5' },
    { path: 'm10 14 5 2 3.5-3.5' },
    { path: 'm18 12 1-1 1 1-1 1Z' },
  ],
  'panel-left': [{ rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } }, { path: 'M9 3v18' }],
  'panel-right': [{ rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } }, { path: 'M15 3v18' }],
  image: [
    { rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } },
    { circle: { cx: 9, cy: 9, r: 2 } },
    { path: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' },
  ],
  'credit-card': [
    { rect: { x: 2, y: 5, width: 20, height: 14, rx: 2 } },
    { line: { x1: 2, x2: 22, y1: 10, y2: 10 } },
  ],
  music: [
    { path: 'M9 18V5l12-2v13' },
    { circle: { cx: 6, cy: 18, r: 3 } },
    { circle: { cx: 18, cy: 16, r: 3 } },
  ],
  video: [
    { rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } },
    { path: 'M7 3v18' },
    { path: 'M3 7.5h4' },
    { path: 'M3 12h18' },
    { path: 'M3 16.5h4' },
    { path: 'M17 3v18' },
    { path: 'M17 7.5h4' },
    { path: 'M17 16.5h4' },
  ],
  code: [{ path: 'm16 18 6-6-6-6' }, { path: 'm8 6-6 6 6 6' }],
  cloud: [{ path: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z' }],
  'hard-drive': [
    { line: { x1: 22, x2: 2, y1: 12, y2: 12 } },
    {
      path: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    },
    { line: { x1: 6, x2: 6.01, y1: 16, y2: 16 } },
    { line: { x1: 10, x2: 10.01, y1: 16, y2: 16 } },
  ],
  server: [
    { rect: { x: 2, y: 2, width: 20, height: 8, rx: 2 } },
    { rect: { x: 2, y: 14, width: 20, height: 8, rx: 2 } },
    { line: { x1: 6, x2: 6.01, y1: 6, y2: 6 } },
    { line: { x1: 6, x2: 6.01, y1: 18, y2: 18 } },
  ],
  monitor: [
    { rect: { x: 2, y: 3, width: 20, height: 14, rx: 2 } },
    { line: { x1: 8, x2: 16, y1: 21, y2: 21 } },
    { line: { x1: 12, x2: 12, y1: 17, y2: 21 } },
  ],
  'file-text': [
    { path: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' },
    { path: 'M14 2v4a2 2 0 0 0 2 2h4' },
    { path: 'M10 9H8' },
    { path: 'M16 13H8' },
    { path: 'M16 17H8' },
  ],
  archive: [
    { rect: { x: 2, y: 3, width: 20, height: 5, rx: 1 } },
    { path: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' },
    { path: 'M10 12h4' },
  ],
  'layout-grid': [
    { rect: { x: 3, y: 3, width: 7, height: 7, rx: 1 } },
    { rect: { x: 14, y: 3, width: 7, height: 7, rx: 1 } },
    { rect: { x: 14, y: 14, width: 7, height: 7, rx: 1 } },
    { rect: { x: 3, y: 14, width: 7, height: 7, rx: 1 } },
  ],
  list: [
    { path: 'M3 12h.01' },
    { path: 'M3 18h.01' },
    { path: 'M3 6h.01' },
    { path: 'M8 12h13' },
    { path: 'M8 18h13' },
    { path: 'M8 6h13' },
  ],
  'arrow-up': [{ path: 'm5 12 7-7 7 7' }, { path: 'M12 19V5' }],
  eye: [
    {
      path: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
    },
    { circle: { cx: 12, cy: 12, r: 3 } },
  ],
  'eye-off': [
    {
      path: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
    },
    { path: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' },
    {
      path: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
    },
    { path: 'm2 2 20 20' },
  ],
  terminal: [{ path: 'M12 19h8' }, { path: 'm4 17 6-6-6-6' }],
  scissors: [
    { circle: { cx: 6, cy: 6, r: 3 } },
    { path: 'M8.12 8.12 12 12' },
    { path: 'M20 4 8.12 15.88' },
    { circle: { cx: 6, cy: 18, r: 3 } },
    { path: 'M14.8 14.8 20 20' },
  ],
  clipboard: [
    { rect: { x: 8, y: 2, width: 8, height: 4, rx: 1 } },
    {
      path: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    },
  ],
  'arrow-up-down': [
    { path: 'm21 16-4 4-4-4' },
    { path: 'M17 20V4' },
    { path: 'm3 8 4-4 4 4' },
    { path: 'M7 4v16' },
  ],
  type: [
    { path: 'M12 4v16' },
    { path: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' },
    { path: 'M9 20h6' },
  ],
  package: [
    {
      path: 'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
    },
    { path: 'M12 22V12' },
    { path: 'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7' },
    { path: 'm7.5 4.27 9 5.15' },
  ],
  shuffle: [
    { path: 'm18 14 4 4-4 4' },
    { path: 'm18 2 4 4-4 4' },
    { path: 'M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22' },
    { path: 'M2 6h1.972a4 4 0 0 1 3.6 2.2' },
    { path: 'M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45' },
  ],
  repeat: [
    { path: 'm17 2 4 4-4 4' },
    { path: 'M3 11v-1a4 4 0 0 1 4-4h14' },
    { path: 'm7 22-4-4 4-4' },
    { path: 'M21 13v1a4 4 0 0 1-4 4H3' },
  ],
  'repeat-1': [
    { path: 'm17 2 4 4-4 4' },
    { path: 'M3 11v-1a4 4 0 0 1 4-4h14' },
    { path: 'm7 22-4-4 4-4' },
    { path: 'M21 13v1a4 4 0 0 1-4 4H3' },
    { path: 'M11 10h1v4' },
  ],
  'skip-back': [
    {
      path: 'M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z',
    },
    { path: 'M3 20V4' },
  ],
  'skip-forward': [
    { path: 'M21 4v16' },
    {
      path: 'M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z',
    },
  ],
  'audio-lines': [
    { path: 'M2 10v3' },
    { path: 'M6 6v11' },
    { path: 'M10 3v18' },
    { path: 'M14 8v7' },
    { path: 'M18 5v13' },
    { path: 'M22 10v3' },
  ],
  users: [
    { path: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' },
    { circle: { cx: 9, cy: 7, r: 4 } },
    { path: 'M22 21v-2a4 4 0 0 0-3-3.87' },
    { path: 'M16 3.13a4 4 0 0 1 0 7.75' },
  ],
  disc: [{ circle: { cx: 12, cy: 12, r: 10 } }, { circle: { cx: 12, cy: 12, r: 2 } }],
  table: [
    { rect: { x: 3, y: 3, width: 18, height: 18, rx: 2 } },
    { path: 'M3 9h18' },
    { path: 'M3 15h18' },
    { path: 'M9 3v18' },
  ],
  presentation: [
    { path: 'M2 3h20' },
    { path: 'M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3' },
    { path: 'm7 21 5-5 5 5' },
  ],
  'chevron-up': [{ path: 'm18 15-6-6-6 6' }],
  printer: [
    { path: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' },
    { path: 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6' },
    { rect: { x: 6, y: 14, width: 12, height: 8, rx: 1 } },
  ],
  'undo-2': [
    { path: 'M9 14 4 9l5-5' },
    { path: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' },
  ],
  'redo-2': [
    { path: 'm15 14 5-5-5-5' },
    { path: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13' },
  ],
  'clipboard-paste': [
    { path: 'M11 14h10' },
    { path: 'M16 4h2a2 2 0 0 1 2 2v1.344' },
    { path: 'm17 18 4-4-4-4' },
    { path: 'M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113' },
    { rect: { x: 8, y: 2, width: 8, height: 4, rx: 1 } },
  ],
  'file-code': [
    {
      path: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    },
    { path: 'M14 2v5a1 1 0 0 0 1 1h5' },
    { path: 'M10 12.5 8 15l2 2.5' },
    { path: 'm14 12.5 2 2.5-2 2.5' },
  ],
  'square-mouse-pointer': [
    {
      path: 'M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z',
    },
    { path: 'M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6' },
  ],
  'book-plus': [
    { path: 'M12 7v6' },
    {
      path: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20',
    },
    { path: 'M9 10h6' },
  ],
  save: [
    {
      path: 'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    },
    { path: 'M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7' },
    { path: 'M7 3v4a1 1 0 0 0 1 1h7' },
  ],
  'spell-check': [
    { path: 'm20 15-5.5 5.5L12 18' },
    { path: 'm4 16 6-12 5.115 10.23' },
    { path: 'M6 12h8' },
  ],
  'text-select': [
    { path: 'M14 21h1' },
    { path: 'M14 3h1' },
    { path: 'M19 3a2 2 0 0 1 2 2' },
    { path: 'M21 14v1' },
    { path: 'M21 19a2 2 0 0 1-2 2' },
    { path: 'M21 9v1' },
    { path: 'M3 14v1' },
    { path: 'M3 9v1' },
    { path: 'M5 21a2 2 0 0 1-2-2' },
    { path: 'M5 3a2 2 0 0 0-2 2' },
    { path: 'M7 12h10' },
    { path: 'M7 16h6' },
    { path: 'M7 8h8' },
    { path: 'M9 21h1' },
    { path: 'M9 3h1' },
  ],
} satisfies Record<string, Shape[]>

export type IconName = keyof typeof ICONS

function ShapeElement(props: { shape: Shape }): JSX.Element {
  return (
    <Switch>
      <Match when={'path' in props.shape && props.shape}>{(s) => <path d={s().path} />}</Match>
      <Match when={'circle' in props.shape && props.shape}>
        {(s) => <circle cx={s().circle.cx} cy={s().circle.cy} r={s().circle.r} />}
      </Match>
      <Match when={'rect' in props.shape && props.shape}>
        {(s) => (
          <rect
            x={s().rect.x}
            y={s().rect.y}
            width={s().rect.width}
            height={s().rect.height}
            rx={s().rect.rx}
          />
        )}
      </Match>
      <Match when={'line' in props.shape && props.shape}>
        {(s) => <line x1={s().line.x1} x2={s().line.x2} y1={s().line.y1} y2={s().line.y2} />}
      </Match>
    </Switch>
  )
}

export function Icon(props: {
  name: IconName
  size?: number | undefined
  class?: string | undefined
}): JSX.Element {
  const shapes = (): Shape[] => ICONS[props.name]
  return (
    <svg
      viewBox="0 0 24 24"
      width={props.size ?? 16}
      height={props.size ?? 16}
      class={props.class === undefined ? 'icon' : `icon ${props.class}`}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <For each={shapes()}>{(shape) => <ShapeElement shape={shape} />}</For>
    </svg>
  )
}

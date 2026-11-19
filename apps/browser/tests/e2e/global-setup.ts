import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enableTestWorkspace } from './hyprland'

export default function globalSetup(): void {
  process.env.EWE_REMOTE_BIN ??= join(tmpdir(), 'ewe-e2e-no-remote', 'ewe-remote')
  // a real ewe Player on the machine must never open from a test: the stubbed mpv takes over
  process.env.EWE_PLAYER_BIN ??= join(tmpdir(), 'ewe-e2e-no-player', 'ewe-player')
  enableTestWorkspace()
}

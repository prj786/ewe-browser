import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enableTestWorkspace } from './hyprland'

export default function globalSetup(): void {
  process.env.EWE_REMOTE_BIN ??= join(tmpdir(), 'ewe-e2e-no-remote', 'ewe-remote')
  enableTestWorkspace()
}

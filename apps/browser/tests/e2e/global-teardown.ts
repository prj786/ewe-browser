import { disableTestWorkspace } from './hyprland'

export default function globalTeardown(): void {
  disableTestWorkspace()
}

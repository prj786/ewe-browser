import { execFileSync } from 'node:child_process'

const RULE_VAR = /^[A-Za-z_][A-Za-z0-9_]*$/.test(process.env.EWE_TEST_RULE ?? '')
  ? (process.env.EWE_TEST_RULE ?? '')
  : '__ewe_test_rule'

function lua(code: string): string | null {
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE === undefined) return null
  try {
    return execFileSync('hyprctl', ['repl', code], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

export function enableTestWorkspace(workspace = process.env.EWE_TEST_WORKSPACE ?? '2'): void {
  lua(`(function()
    if _G.${RULE_VAR} then _G.${RULE_VAR}:set_enabled(true) return 'reused' end
    _G.${RULE_VAR} = hl.window_rule({
      name = 'ewe-test',
      match = { class = '(?i)^(ewe-browser|electron)$' },
      workspace = '${workspace} silent',
    })
    return 'created'
  end)()`)
}

export function disableTestWorkspace(): void {
  lua(`if _G.${RULE_VAR} then _G.${RULE_VAR}:set_enabled(false) end return 'off'`)
}

import { execFileSync } from 'node:child_process'

const RULE_BASE = /^[A-Za-z_][A-Za-z0-9_]*$/.test(process.env.EWE_TEST_RULE ?? '')
  ? (process.env.EWE_TEST_RULE ?? '')
  : '__ewe_test_rule'

let ruleVar: string | null = null

function lua(code: string): string | null {
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE === undefined) return null
  try {
    return execFileSync('hyprctl', ['repl', code], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function visibleWorkspaces(): Set<string> {
  try {
    const monitors = JSON.parse(
      execFileSync('hyprctl', ['monitors', '-j'], { encoding: 'utf8' }),
    ) as {
      activeWorkspace: { id: number }
    }[]
    return new Set(monitors.map((m) => String(m.activeWorkspace.id)))
  } catch {
    return new Set()
  }
}

export function testWorkspace(preferred = process.env.EWE_TEST_WORKSPACE ?? '2'): string {
  const visible = visibleWorkspaces()
  if (!visible.has(preferred)) return preferred
  for (let n = 9; n < 100; n++) if (!visible.has(String(n))) return String(n)
  return preferred
}

export function enableTestWorkspace(workspace = testWorkspace()): void {
  if (!/^\d+$/.test(workspace)) return
  ruleVar = `${RULE_BASE}_${workspace}`
  process.env.EWE_TEST_RULE_ON = ruleVar
  lua(`(function()
    if _G.${ruleVar} then _G.${ruleVar}:set_enabled(true) return 'reused' end
    _G.${ruleVar} = hl.window_rule({
      name = 'ewe-test-${workspace}',
      match = { class = '(?i)^(ewe-browser|electron)$' },
      workspace = '${workspace} silent',
    })
    return 'created'
  end)()`)
}

export function disableTestWorkspace(): void {
  const rule = ruleVar ?? process.env.EWE_TEST_RULE_ON
  if (rule === undefined || !/^[A-Za-z_][A-Za-z0-9_]*_\d+$/.test(rule)) return
  lua(`if _G.${rule} then _G.${rule}:set_enabled(false) end return 'off'`)
}

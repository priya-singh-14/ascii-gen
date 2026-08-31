import {
  BUILT_IN_PRESETS,
  applyLook,
  captureLook,
  loadPresets,
  mergePresets,
  parsePresetFile,
  savePresets,
  type Preset,
} from '../presets'
import type { AppState } from '../state'
import { button, rowOf } from './controls'

export interface PresetBarHandlers {
  /** Called after a preset is applied so the panel and canvas can refresh. */
  onApply: () => void
  onStatus: (message: string) => void
}

/**
 * `pickerEl` is the dropdown at the top of the sidebar, `actionsEl` the save /
 * manage row down with the export buttons.
 *
 * Built-in presets are read-only; saving under a built-in's name creates a
 * user preset that shadows it in the list.
 */
export class PresetBar {
  readonly pickerEl = document.createElement('div')
  readonly actionsEl = document.createElement('div')

  private select = document.createElement('select')
  private saved: Preset[] = loadPresets()
  private fileInput = document.createElement('input')

  constructor(
    private state: AppState,
    private handlers: PresetBarHandlers,
  ) {
    this.pickerEl.className = 'preset-picker'
    this.actionsEl.className = 'preset-actions'

    this.fileInput.type = 'file'
    this.fileInput.accept = 'application/json,.json'
    this.fileInput.hidden = true
    this.fileInput.addEventListener('change', () => void this.importFile())

    const picker = document.createElement('label')
    picker.className = 'row row-inline'
    const label = document.createElement('span')
    label.textContent = 'Preset'
    picker.append(label, this.select)
    this.select.addEventListener('change', () => this.apply(this.select.value))
    this.pickerEl.append(picker)

    this.actionsEl.append(
      // Save as… doubles as update: naming an existing preset overwrites it
      // after a confirm.
      rowOf(button('Save as preset…', () => this.saveAs(), 'primary')),
      rowOf(
        button('Delete preset', () => this.deleteSelected()),
        button('Import .json', () => this.fileInput.click()),
        button('Export .json', () => this.exportAll()),
      ),
      this.fileInput,
    )

    this.refresh()
  }

  private all(): Array<{ preset: Preset; builtIn: boolean }> {
    const userNames = new Set(this.saved.map((p) => p.name))
    return [
      ...BUILT_IN_PRESETS.filter((p) => !userNames.has(p.name)).map((preset) => ({
        preset,
        builtIn: true,
      })),
      ...this.saved.map((preset) => ({ preset, builtIn: false })),
    ]
  }

  private refresh(selected = ''): void {
    this.select.textContent = ''

    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = this.saved.length ? '— pick a preset —' : '-select preset-'
    this.select.append(placeholder)

    const groups: Array<[string, Preset[]]> = [
      ['Built-in', this.all().filter((e) => e.builtIn).map((e) => e.preset)],
      ['Saved', this.saved],
    ]

    for (const [title, presets] of groups) {
      if (presets.length === 0) continue
      const group = document.createElement('optgroup')
      group.label = title
      for (const preset of presets) {
        const option = document.createElement('option')
        option.value = preset.name
        option.textContent = preset.name
        group.append(option)
      }
      this.select.append(group)
    }

    this.select.value = selected
  }

  private find(name: string): Preset | undefined {
    return this.all().find((e) => e.preset.name === name)?.preset
  }

  private apply(name: string): void {
    if (!name) return
    const preset = this.find(name)
    if (!preset) return
    applyLook(this.state, preset.look)
    this.handlers.onApply()
    this.handlers.onStatus(`Applied preset "${name}"`)
  }

  private saveAs(): void {
    const suggestion = this.select.value || 'My preset'
    const name = window.prompt('Save current look as:', suggestion)?.trim()
    if (!name) return

    const existing = this.saved.findIndex((p) => p.name === name)
    if (existing >= 0 && !window.confirm(`"${name}" already exists. Overwrite it?`)) return

    const preset: Preset = { name, look: captureLook(this.state) }
    if (existing >= 0) this.saved[existing] = preset
    else this.saved.push(preset)
    this.saved.sort((a, b) => a.name.localeCompare(b.name))

    savePresets(this.saved)
    this.refresh(name)
    this.handlers.onStatus(
      existing >= 0 ? `Updated preset "${name}"` : `Saved preset "${name}"`,
    )
  }

  private deleteSelected(): void {
    const name = this.select.value
    const at = this.saved.findIndex((p) => p.name === name)
    if (at < 0) {
      this.handlers.onStatus(
        name ? `"${name}" is built in and can't be deleted` : 'Pick a preset to delete',
      )
      return
    }
    if (!window.confirm(`Delete preset "${name}"?`)) return
    this.saved.splice(at, 1)
    savePresets(this.saved)
    this.refresh()
    this.handlers.onStatus(`Deleted preset "${name}"`)
  }

  private exportAll(): void {
    const payload = this.saved.length ? this.saved : BUILT_IN_PRESETS
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ascii-gen-presets.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    this.handlers.onStatus(`Exported ${payload.length} preset(s)`)
  }

  private async importFile(): Promise<void> {
    const file = this.fileInput.files?.[0]
    this.fileInput.value = ''
    if (!file) return
    try {
      const incoming = parsePresetFile(await file.text())
      this.saved = mergePresets(this.saved, incoming)
      savePresets(this.saved)
      this.refresh()
      this.handlers.onStatus(`Imported ${incoming.length} preset(s)`)
    } catch (err) {
      this.handlers.onStatus(`Import failed: ${(err as Error).message}`)
    }
  }
}

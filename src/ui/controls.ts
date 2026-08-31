/**
 * A two-way-bound control panel. Controls read and write a shared state object
 * directly, and each registers a `sync` function so bulk changes (loading a
 * preset, resetting) can push new values into the DOM without rebuilding.
 */
export class ControlPanel<S extends object> {
  readonly el = document.createElement('div')
  /** The `<details>` from the most recent `group()` call, for show/hide. */
  lastGroup: HTMLDetailsElement | null = null
  /** The row from the most recent control call, for show/hide. */
  lastRow: HTMLElement | null = null
  private syncs: Array<() => void> = []
  private section: HTMLElement | null = null

  constructor(
    private state: S,
    private onChange: () => void,
  ) {
    this.el.className = 'panel'
  }

  group(title: string, options: { collapsed?: boolean } = {}): this {
    const details = document.createElement('details')
    details.className = 'group'
    details.open = !options.collapsed

    const summary = document.createElement('summary')
    summary.textContent = title
    details.append(summary)

    const body = document.createElement('div')
    body.className = 'group-body'
    details.append(body)

    this.el.append(details)
    this.section = body
    this.lastGroup = details
    return this
  }

  private add(row: HTMLElement): void {
    ;(this.section ?? this.el).append(row)
    this.lastRow = row
  }

  custom(node: HTMLElement): this {
    this.add(node)
    return this
  }

  private commit<K extends keyof S>(key: K, value: S[K]): void {
    this.state[key] = value
    this.onChange()
  }

  range<K extends keyof S>(
    key: K,
    label: string,
    opts: { min: number; max: number; step: number; format?: (v: number) => string },
  ): this {
    const row = document.createElement('label')
    row.className = 'row row-range'

    const head = document.createElement('div')
    head.className = 'row-head'
    const name = document.createElement('span')
    name.textContent = label
    const readout = document.createElement('output')
    head.append(name, readout)

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(opts.min)
    input.max = String(opts.max)
    input.step = String(opts.step)

    const format = opts.format ?? ((v: number) => String(v))
    const sync = () => {
      const v = this.state[key] as number
      input.value = String(v)
      readout.textContent = format(v)
    }
    input.addEventListener('input', () => {
      const v = Number(input.value)
      readout.textContent = format(v)
      this.commit(key, v as S[K])
    })

    row.append(head, input)
    this.add(row)
    this.syncs.push(sync)
    sync()
    return this
  }

  select<K extends keyof S>(
    key: K,
    label: string,
    options: Array<{ value: string; label: string }>,
  ): this {
    const row = document.createElement('label')
    row.className = 'row row-inline'

    const name = document.createElement('span')
    name.textContent = label

    const select = document.createElement('select')
    for (const o of options) {
      const opt = document.createElement('option')
      opt.value = o.value
      opt.textContent = o.label
      select.append(opt)
    }

    const sync = () => {
      select.value = String(this.state[key])
    }
    select.addEventListener('change', () => this.commit(key, select.value as S[K]))

    row.append(name, select)
    this.add(row)
    this.syncs.push(sync)
    sync()
    return this
  }

  color<K extends keyof S>(key: K, label: string): this {
    const row = document.createElement('label')
    row.className = 'row row-inline'

    const name = document.createElement('span')
    name.textContent = label

    const wrap = document.createElement('div')
    wrap.className = 'color-wrap'
    const input = document.createElement('input')
    input.type = 'color'
    const hex = document.createElement('input')
    hex.type = 'text'
    hex.className = 'hex'
    hex.spellcheck = false
    wrap.append(input, hex)

    const sync = () => {
      const v = String(this.state[key])
      input.value = v
      hex.value = v
    }
    input.addEventListener('input', () => {
      hex.value = input.value
      this.commit(key, input.value as S[K])
    })
    hex.addEventListener('change', () => {
      const v = hex.value.trim()
      if (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(v)) {
        const normalised = v.startsWith('#') ? v : `#${v}`
        input.value = normalised
        this.commit(key, normalised as S[K])
      } else {
        sync()
      }
    })

    row.append(name, wrap)
    this.add(row)
    this.syncs.push(sync)
    sync()
    return this
  }

  check<K extends keyof S>(key: K, label: string): this {
    const row = document.createElement('label')
    row.className = 'row row-inline row-check'

    const name = document.createElement('span')
    name.textContent = label

    const input = document.createElement('input')
    input.type = 'checkbox'

    const sync = () => {
      input.checked = Boolean(this.state[key])
    }
    input.addEventListener('change', () => this.commit(key, input.checked as S[K]))

    row.append(name, input)
    this.add(row)
    this.syncs.push(sync)
    sync()
    return this
  }

  text<K extends keyof S>(key: K, label: string, placeholder = ''): this {
    const row = document.createElement('label')
    row.className = 'row row-text'

    const name = document.createElement('span')
    name.textContent = label

    const input = document.createElement('input')
    input.type = 'text'
    input.spellcheck = false
    input.placeholder = placeholder
    input.className = 'ramp-input'

    const sync = () => {
      input.value = String(this.state[key])
    }
    input.addEventListener('input', () => this.commit(key, input.value as S[K]))

    row.append(name, input)
    this.add(row)
    this.syncs.push(sync)
    sync()
    return this
  }

  syncAll(): void {
    for (const sync of this.syncs) sync()
  }
}

export function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.className = className
  b.addEventListener('click', onClick)
  return b
}

export function rowOf(...nodes: HTMLElement[]): HTMLElement {
  const div = document.createElement('div')
  div.className = 'row row-buttons'
  div.append(...nodes)
  return div
}

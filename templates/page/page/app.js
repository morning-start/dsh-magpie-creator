// The page. It runs in a sandboxed frame with its own origin: no network, no
// inline script, no storage of the window. Everything it knows comes from
// magpie.ready, magpie.read (only the reads package.json declares) and
// magpie.options. Treat what it can read as public.
(async () => {
  const $ = (id) => document.getElementById(id)
  const theme = await magpie.ready
  let lang = theme.lang
  let options = {}
  try {
    options = (await magpie.options.get()) || {}
  } catch {
    options = {}
  }
  const state = {
    period: ['today', '7d', '30d'].includes(options.period) ? options.period : 'today',
    summary: null,
  }

  const words = {
    en: { models: 'Top models', empty: 'Nothing recorded for this period.', failed: 'Could not read usage', calls: 'Calls', tokens: 'Tokens', cost: 'Cost' },
    zh: { models: '用量最多的模型', empty: '这段时间没有记录。', failed: '读取用量失败', calls: '调用', tokens: 'Token', cost: '费用' },
  }
  const t = () => words[lang?.startsWith('zh') ? 'zh' : 'en']

  function paintWords() {
    const w = t()
    for (const el of document.querySelectorAll('[data-t]')) {
      if (w[el.dataset.t]) el.textContent = w[el.dataset.t]
    }
  }

  function selectPeriod() {
    for (const button of $('periods').querySelectorAll('button')) {
      button.setAttribute('aria-selected', String(button.dataset.period === state.period))
    }
  }

  function tile(label, value, sub) {
    const box = document.createElement('div')
    box.className = 'tile'
    for (const [cls, text] of [['k', label], ['v', value], ['s', sub]]) {
      const line = document.createElement('div')
      line.className = cls
      line.textContent = text
      box.append(line)
    }
    return box
  }

  function paint() {
    selectPeriod()
    const summary = state.summary
    if (!summary) return
    const w = t()
    $('tiles').replaceChildren(
      tile(w.calls, String(summary.calls ?? 0), `${summary.errors ?? 0} errors`),
      tile(w.tokens, String(summary.tokens ?? 0), ''),
      tile(w.cost, String(summary.cost ?? 0), ''),
    )
    const models = Array.isArray(summary.models) ? summary.models.slice(0, 20) : []
    $('empty').hidden = models.length > 0
    $('models').replaceChildren(...models.map((model) => {
      const item = document.createElement('li')
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = name.title = model.name ?? model.id ?? '?'
      const value = document.createElement('span')
      value.className = 'num'
      value.textContent = String(model.tokens ?? model.calls ?? '')
      item.append(name, value)
      return item
    }))
  }

  async function load() {
    try {
      state.summary = await magpie.read('usage:summary', { period: state.period })
      $('error').hidden = true
    } catch (error) {
      $('error').hidden = false
      $('error').textContent = `${t().failed}: ${error.message}`
    }
    paint()
  }

  // options.set is allowed at most once a second.
  let saving = null
  function save() {
    if (saving) return
    saving = setTimeout(async () => {
      saving = null
      try {
        options = await magpie.options.set({ ...options, period: state.period })
      } catch {
        options = { ...options, period: state.period }
      }
    }, 1100)
  }

  $('periods').addEventListener('click', (event) => {
    const period = event.target.closest('button')?.dataset.period
    if (!period || period === state.period) return
    state.period = period
    paint()
    load()
    save()
  })

  magpie.onTheme((next) => {
    lang = next.lang
    paintWords()
    paint()
  })

  paintWords()
  await load()
})()

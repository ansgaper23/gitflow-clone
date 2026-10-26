// Diff de líneas simple basado en LCS. Suficiente para previsualizar cambios
// de archivos de tamaño moderado en el visor de la UI (no pretende ser un
// reemplazo de un algoritmo de diff de producción tipo Myers completo).
export function lineDiff(oldText = '', newText = '') {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const result = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'ctx', line: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'del', line: a[i] })
      i++
    } else {
      result.push({ type: 'add', line: b[j] })
      j++
    }
  }
  while (i < n) {
    result.push({ type: 'del', line: a[i] })
    i++
  }
  while (j < m) {
    result.push({ type: 'add', line: b[j] })
    j++
  }
  return result
}

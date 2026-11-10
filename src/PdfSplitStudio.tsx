import { useEffect, useMemo, useRef, useState } from 'react'
import { PDFDocument, degrees } from 'pdf-lib'
import JSZip from 'jszip'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft, Scissors, ZoomIn, LoaderCircle, Pencil, Save, Eye, Trash2, Check, X, FolderDown } from 'lucide-react'
import './PdfSplitStudio.css'

type Props = {
  pdf: PDFDocumentProxy
  pageOrder: number[]
  rotations: Record<number, number>
  fileName: string
  initialPage?: number
  onClose: () => void
}

type SplitPart = {
  id: number
  name: string
  bytes: Uint8Array
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function cleanPdfName(value: string) {
  const cleaned = value
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .trim()
    .replace(/\.+$/g, '')
  return (cleaned || 'documento') + '.pdf'
}

export default function PdfSplitStudio({ pdf, pageOrder, rotations, fileName, initialPage = 1, onClose }: Props) {
  const previewContainerRef = useRef<HTMLDivElement>(null)
  const [previewErrors, setPreviewErrors] = useState<Record<number, string>>({})
  const [splitMode, setSplitMode] = useState<'after' | 'before' | 'each' | 'ranges' | 'visual'>('after')
  const [cuts, setCuts] = useState<number[]>(() => initialPage < pageOrder.length ? [initialPage] : [])
  const [ranges, setRanges] = useState(() => pageOrder.length >= 10 ? '1-5, 6-10' : '1-' + pageOrder.length)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [parts, setParts] = useState<SplitPart[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [savingAll, setSavingAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    let activeTask: ReturnType<Awaited<ReturnType<typeof pdf.getPage>>['render']> | null = null

    async function renderPreviews() {
      setPreviewErrors({})
      for (let index = 0; index < pageOrder.length; index++) {
        if (cancelled) return
        const canvas = previewContainerRef.current?.querySelector<HTMLCanvasElement>(`canvas[data-pdf-page-index="${index}"]`)
        if (!canvas) continue
        try {
          const sourcePage = pageOrder[index]
          const page = await pdf.getPage(sourcePage)
          if (cancelled) return
          const viewport = page.getViewport({
            scale: 0.42,
            rotation: (page.rotate + (rotations[sourcePage] || 0)) % 360
          })
          canvas.width = Math.max(1, Math.ceil(viewport.width))
          canvas.height = Math.max(1, Math.ceil(viewport.height))
          const context = canvas.getContext('2d', { alpha: false })
          if (!context) throw new Error('Navegador não conseguiu criar o canvas.')
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          activeTask = page.render({ canvasContext: context, viewport })
          await activeTask.promise
          activeTask = null
          if (!cancelled) canvas.dataset.ready = 'true'
        } catch (error) {
          if (cancelled) return
          const reason = error instanceof Error ? error.message : 'Falha ao renderizar a página.'
          setPreviewErrors(current => ({ ...current, [index]: reason }))
          canvas.dataset.error = 'true'
        }
      }
    }

    void renderPreviews()
    return () => {
      cancelled = true
      try { activeTask?.cancel() } catch { /* render already completed */ }
    }
  }, [pdf, pageOrder, rotations])

  const cutSet = useMemo(() => new Set(cuts), [cuts])
  const cutCount = splitMode === 'each' ? Math.max(0, pageOrder.length - 1) : splitMode === 'after' ? (initialPage < pageOrder.length ? 1 : 0) : splitMode === 'before' ? (initialPage > 1 ? 1 : 0) : cuts.length
  const outputCount = splitMode === 'ranges' ? ranges.split(',').filter(value => value.trim()).length : pageOrder.length ? cutCount + 1 : 0

  function changeSplitMode(mode: typeof splitMode) {
    setSplitMode(mode)
    if (mode === 'after') setCuts(initialPage < pageOrder.length ? [initialPage] : [])
    else if (mode === 'before') setCuts(initialPage > 1 ? [initialPage - 1] : [])
    else if (mode === 'each' || mode === 'ranges') setCuts([])
    else setCuts([])
  }

  function toggleCut(afterPageIndex: number) {
    setSplitMode('visual')
    setCuts(current => current.includes(afterPageIndex)
      ? current.filter(value => value !== afterPageIndex)
      : [...current, afterPageIndex].sort((a, b) => a - b))
  }

  async function split() {
    if (!pageOrder.length || busy) return
    setBusy(true)
    setMessage('Preparando ' + outputCount + ' arquivo(s) PDF…')
    try {
      const source = await PDFDocument.load(await pdf.getData())
      const groups: number[][] = []
      if (splitMode === 'ranges') {
        const parsed = ranges.split(',').map(value => value.trim()).filter(Boolean).map(value => {
          const match = value.match(/^(\\d+)\\s*-\\s*(\\d+)$/)
          if (!match) throw new Error('Intervalo inválido: ' + value + '. Use o formato 1-5, 6-10.')
          const start = Number(match[1]), end = Number(match[2])
          if (start < 1 || end < start || end > pageOrder.length) throw new Error('Intervalo fora dos limites: ' + value + '. O documento possui ' + pageOrder.length + ' páginas.')
          return { start, end }
        }).sort((a, b) => a.start - b.start)
        if (!parsed.length) throw new Error('Informe pelo menos um intervalo de páginas.')
        for (let index = 1; index < parsed.length; index++) {
          if (parsed[index].start <= parsed[index - 1].end) throw new Error('Os intervalos não podem se sobrepor.')
        }
        parsed.forEach(range => groups.push(pageOrder.slice(range.start - 1, range.end)))
      } else {
        const activeCuts = splitMode === 'each'
          ? pageOrder.slice(0, -1).map((_, index) => index + 1)
          : splitMode === 'after' ? (initialPage < pageOrder.length ? [initialPage] : [])
          : splitMode === 'before' ? (initialPage > 1 ? [initialPage - 1] : [])
          : cuts
        let current: number[] = []
        pageOrder.forEach((sourcePage, index) => {
          current.push(sourcePage)
          if (activeCuts.includes(index + 1) || index === pageOrder.length - 1) {
            groups.push(current)
            current = []
          }
        })
      }
      if (!groups.length || groups.some(group => !group.length)) throw new Error('Não foi possível identificar as partes do documento.')
      const baseName = fileName.replace(/\.pdf$/i, '') || 'documento'
      const generatedParts: SplitPart[] = []

      for (let index = 0; index < groups.length; index++) {
        const output = await PDFDocument.create()
        const group = groups[index]
        const copied = await output.copyPages(source, group.map(pageNumber => pageNumber - 1))
        copied.forEach((page, pageIndex) => {
          const sourcePage = group[pageIndex]
          page.setRotation(degrees((page.getRotation().angle + (rotations[sourcePage] || 0)) % 360))
          output.addPage(page)
        })
        const bytes = await output.save()
        generatedParts.push({
          id: index + 1,
          name: baseName + '-parte-' + String(index + 1).padStart(2, '0') + '.pdf',
          bytes
        })
      }

      setParts(generatedParts)
      setEditingId(null)
      setMessage(generatedParts.length + ' PDF(s) gerado(s). Renomeie, abra, exclua ou guarde os arquivos abaixo.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível dividir o PDF.')
    } finally {
      setBusy(false)
    }
  }

  function startRename(part: SplitPart) {
    setEditingId(part.id)
    setDraftName(part.name.replace(/\.pdf$/i, ''))
  }

  function confirmRename(partId: number) {
    const nextName = cleanPdfName(draftName)
    setParts(current => current.map(part => part.id === partId ? { ...part, name: nextName } : part))
    setEditingId(null)
    setDraftName('')
    setMessage('Nome atualizado. Clique em Guardar para baixar com o novo nome.')
  }

  function savePart(part: SplitPart) {
    downloadBlob(new Blob([part.bytes], { type: 'application/pdf' }), cleanPdfName(part.name))
    setMessage('Arquivo "' + cleanPdfName(part.name) + '" enviado para download.')
  }

  function openPart(part: SplitPart) {
    const url = URL.createObjectURL(new Blob([part.bytes], { type: 'application/pdf' }))
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) {
      URL.revokeObjectURL(url)
      setMessage('O navegador bloqueou a nova aba. Permita pop-ups para abrir a prévia.')
      return
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  function deletePart(partId: number) {
    setParts(current => current.filter(part => part.id !== partId))
    if (editingId === partId) setEditingId(null)
    setMessage('PDF removido da lista. Essa ação não altera o documento original.')
  }

  async function saveAll() {
    if (!parts.length || savingAll) return
    setSavingAll(true)
    try {
      if (parts.length === 1) {
        savePart(parts[0])
        return
      }
      const zip = new JSZip()
      const folderName = cleanPdfName(fileName).replace(/\.pdf$/i, '') + '-partes'
      const folder = zip.folder(folderName)
      if (!folder) throw new Error('Não foi possível criar a pasta dos PDFs.')
      parts.forEach(part => folder.file(cleanPdfName(part.name), part.bytes))
      const archive = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })
      downloadBlob(archive, folderName + '.zip')
      setMessage(parts.length + ' PDFs guardados em uma pasta ZIP, com os nomes atualizados.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível guardar os PDFs.')
    } finally {
      setSavingAll(false)
    }
  }

  return <div className="pdf-split-overlay" role="dialog" aria-modal="true" aria-label="Dividir PDF">
    <div className="pdf-split-studio">
      <header className="pdf-split-header">
        <button className="pdf-split-back" onClick={onClose}><ArrowLeft size={17}/> Voltar ao editor</button>
        <div className="pdf-split-heading"><strong>DIVIDIR PDF</strong><span>{fileName} • {pageOrder.length} páginas</span></div>
        <button className="pdf-split-primary" disabled={busy || pageOrder.length === 0} onClick={() => void split()}>
          {busy ? <LoaderCircle className="pdf-split-spin" size={17}/> : <Scissors size={17}/>}
          {busy ? 'Processando…' : <>Dividir <b>{outputCount} PDFs</b></>}
        </button>
      </header>
      <div className="pdf-split-options pdf-split-mode-options">
        <label>Forma de divisão
          <select value={splitMode} onChange={event => changeSplitMode(event.target.value as typeof splitMode)}>
            <option value="after">Depois da página atual ({initialPage})</option>
            <option value="before">Antes da página atual ({initialPage})</option>
            <option value="each">Cada página em um PDF</option>
            <option value="ranges">Intervalos personalizados</option>
            <option value="visual">Escolher cortes nas miniaturas</option>
          </select>
        </label>
        {splitMode === 'ranges'
          ? <input className="pdf-split-ranges" value={ranges} onChange={event => setRanges(event.target.value)} placeholder="Ex.: 1-5, 6-10, 11-20" aria-label="Intervalos de páginas"/>
          : <span>{splitMode === 'after' ? 'Cria uma parte até a página atual e outra com as páginas restantes.' : splitMode === 'before' ? 'Cria uma parte antes da página atual e outra começando nela.' : splitMode === 'each' ? 'Cada página será salva em um PDF separado.' : 'Clique nas tesouras para marcar ou remover os pontos de corte.'}</span>}
      </div>
      <div className="pdf-split-canvas">
        <p className="pdf-split-instruction">{splitMode === 'each' ? 'Cada página será dividida em um arquivo independente' : splitMode === 'ranges' ? 'Confira os intervalos informados antes de dividir' : 'Clique sobre uma tesoura para marcar ou remover uma divisão'}</p>
        <div className="pdf-split-pages" ref={previewContainerRef}>
          {pageOrder.map((sourcePage, index) => <div className="pdf-split-item" key={sourcePage + '-' + index}>
            <button className="pdf-split-thumbnail" onClick={() => setMessage('Página ' + (index + 1) + ' do documento')} title={'Página ' + (index + 1)}>
              <canvas data-pdf-page-index={index} aria-label={'Prévia da página ' + (index + 1)} />
              {previewErrors[index] && <span className="pdf-split-preview-error" title={previewErrors[index]}>Falha na prévia</span>}
              {!previewErrors[index] && <span className="pdf-split-loading"><LoaderCircle size={20}/></span>}
              <span className="pdf-split-page-number">{index + 1}</span>
              <ZoomIn className="pdf-split-zoom" size={16}/>
            </button>
            <small>Página {index + 1}</small>
            {index < pageOrder.length - 1 && <button className={'pdf-split-cut ' + ((splitMode === 'each' || (splitMode === 'after' && index + 1 === initialPage) || (splitMode === 'before' && index + 1 === initialPage - 1) || cutSet.has(index + 1)) ? 'selected' : '')} onClick={() => toggleCut(index + 1)} title={splitMode === 'visual' ? 'Alternar ponto de divisão' : 'Selecionar cortes visualmente'} aria-label={'Dividir depois da página ' + (index + 1)} aria-pressed={splitMode === 'each' || cutSet.has(index + 1) || (splitMode === 'after' && index + 1 === initialPage) || (splitMode === 'before' && index + 1 === initialPage - 1)}>
              <span className="pdf-split-dotted"/>
              <span className="pdf-split-scissors"><Scissors size={17}/></span>
            </button>}
          </div>)}
        </div>
      </div>

      {parts.length > 0 && <section className="pdf-split-results" aria-label="PDFs gerados">
        <div className="pdf-split-results-heading">
          <div><strong>PDFs separados</strong><span>{parts.length} arquivo(s) pronto(s)</span></div>
          <button className="pdf-split-save-all" onClick={() => void saveAll()} disabled={savingAll}>
            {savingAll ? <LoaderCircle className="pdf-split-spin" size={16}/> : <FolderDown size={16}/>}
            {savingAll ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        <div className="pdf-split-file-list">
          {parts.map(part => <div className="pdf-split-file-row" key={part.id}>
            <div className="pdf-split-file-name">
              <span className="pdf-split-pdf-icon">PDF</span>
              {editingId === part.id
                ? <input autoFocus value={draftName} onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') confirmRename(part.id); if (event.key === 'Escape') setEditingId(null) }} aria-label="Novo nome do PDF"/>
                : <span title={part.name}>{part.name}</span>}
            </div>
            <div className="pdf-split-file-actions">
              {editingId === part.id
                ? <>
                    <button onClick={() => confirmRename(part.id)} title="Confirmar nome" aria-label="Confirmar nome"><Check size={17}/></button>
                    <button onClick={() => setEditingId(null)} title="Cancelar renomeação" aria-label="Cancelar renomeação"><X size={17}/></button>
                  </>
                : <>
                    <button onClick={() => startRename(part)} title="Renomear PDF" aria-label="Renomear PDF"><Pencil size={16}/></button>
                    <button onClick={() => savePart(part)} title="Guardar PDF" aria-label="Guardar PDF"><Save size={17}/></button>
                    <button onClick={() => openPart(part)} title="Abrir PDF" aria-label="Abrir PDF"><Eye size={17}/></button>
                    <button className="pdf-split-delete" onClick={() => deletePart(part.id)} title="Excluir PDF" aria-label="Excluir PDF"><Trash2 size={17}/></button>
                  </>}
            </div>
          </div>)}
        </div>
      </section>}

      <footer className="pdf-split-footer">
        <span>{outputCount} arquivo(s) serão gerados</span>
        {message && <span className="pdf-split-message">{message}</span>}
      </footer>
    </div>
  </div>
}

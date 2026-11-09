import { useEffect, useMemo, useState } from 'react'
import { PDFDocument, degrees } from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft, Scissors, ZoomIn, Download, LoaderCircle } from 'lucide-react'
import './PdfSplitStudio.css'

type Props = {
  pdf: PDFDocumentProxy
  pageOrder: number[]
  rotations: Record<number, number>
  fileName: string
  onClose: () => void
}

export default function PdfSplitStudio({ pdf, pageOrder, rotations, fileName, onClose }: Props) {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({})
  const [pageMode, setPageMode] = useState(true)
  const [cuts, setCuts] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function renderThumbnails() {
      for (let index = 0; index < pageOrder.length; index++) {
        const sourceIndex = pageOrder[index]
        try {
          const page = await pdf.getPage(sourceIndex)
          const viewport = page.getViewport({ scale: 0.34, rotation: (page.rotate + (rotations[sourceIndex] || 0)) % 360 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) continue
          await page.render({ canvasContext: context, viewport }).promise
          // Capture the image before releasing the canvas. React may execute a
          // functional state updater after this loop has already cleared it.
          const previewDataUrl = canvas.toDataURL('image/jpeg', 0.86)
          if (!cancelled) setThumbnails(current => ({ ...current, [index]: previewDataUrl }))
          canvas.width = 0
          canvas.height = 0
        } catch {
          if (!cancelled) setMessage('Não foi possível gerar a miniatura da página ' + (index + 1) + '.')
        }
      }
    }
    void renderThumbnails()
    return () => { cancelled = true }
  }, [pdf, pageOrder, rotations])

  const cutCount = pageMode ? Math.max(0, pageOrder.length - 1) : cuts.length
  const outputCount = pageOrder.length ? cutCount + 1 : 0
  const cutSet = useMemo(() => new Set(cuts), [cuts])

  function toggleCut(afterPageIndex: number) {
    setPageMode(false)
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
      let current: number[] = []
      pageOrder.forEach((sourcePage, index) => {
        current.push(sourcePage)
        const shouldCut = pageMode || cutSet.has(index + 1)
        if (shouldCut || index === pageOrder.length - 1) {
          groups.push(current)
          current = []
        }
      })
      const baseName = fileName.replace(/\.pdf$/i, '') || 'documento'
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
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
        const link = document.createElement('a')
        link.href = url
        link.download = groups.length === 1 ? baseName + '-parte-1.pdf' : baseName + '-parte-' + String(index + 1).padStart(2, '0') + '.pdf'
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 4000)
        if (index < groups.length - 1) await new Promise(resolve => window.setTimeout(resolve, 350))
      }
      setMessage('Divisão concluída: ' + groups.length + ' PDF(s) gerado(s).')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível dividir o PDF.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="pdf-split-overlay" role="dialog" aria-modal="true" aria-label="Dividir PDF">
    <div className="pdf-split-studio">
      <header className="pdf-split-header">
        <button className="pdf-split-back" onClick={onClose}><ArrowLeft size={17}/> Voltar ao editor</button>
        <div className="pdf-split-heading"><strong>DIVIDIR PDF</strong><span>{fileName} • {pageOrder.length} páginas</span></div>
        <button className="pdf-split-primary" disabled={busy || pageOrder.length === 0} onClick={() => void split()}>
          {busy ? <LoaderCircle className="pdf-split-spin" size={17}/> : <Download size={17}/>}
          {busy ? 'Processando…' : <>Dividir <b>{outputCount} PDFs</b></>}
        </button>
      </header>
      <div className="pdf-split-options">
        <button className={'pdf-split-mode ' + (pageMode ? 'active' : '')} onClick={() => { setPageMode(value => !value); setCuts([]) }} aria-pressed={pageMode}>
          <span className="pdf-split-switch"><i/></span> Modo página
        </button>
        <span>{pageMode ? 'Cada página será salva em um PDF separado.' : 'Clique nas tesouras para marcar onde deseja separar.'}</span>
      </div>
      <div className="pdf-split-canvas">
        <p className="pdf-split-instruction">{pageMode ? 'Cada página será dividida em um arquivo independente' : 'Clique sobre uma tesoura para marcar ou remover uma divisão'}</p>
        <div className="pdf-split-pages">
          {pageOrder.map((sourcePage, index) => <div className="pdf-split-item" key={sourcePage + '-' + index}>
            <button className="pdf-split-thumbnail" onClick={() => setMessage('Página ' + (index + 1) + ' do documento')} title={'Página ' + (index + 1)}>
              {thumbnails[index] ? <img src={thumbnails[index]} alt={'Prévia da página ' + (index + 1)}/> : <span className="pdf-split-loading"><LoaderCircle size={20}/></span>}
              <span className="pdf-split-page-number">{index + 1}</span>
              <ZoomIn className="pdf-split-zoom" size={16}/>
            </button>
            <small>Página {index + 1}</small>
            {index < pageOrder.length - 1 && <button className={'pdf-split-cut ' + (pageMode || cutSet.has(index + 1) ? 'selected' : '')} onClick={() => toggleCut(index + 1)} title={pageMode ? 'Usar divisão personalizada a partir daqui' : 'Alternar ponto de divisão'} aria-label={'Dividir depois da página ' + (index + 1)} aria-pressed={pageMode || cutSet.has(index + 1)}>
              <span className="pdf-split-dotted"/>
              <span className="pdf-split-scissors"><Scissors size={17}/></span>
            </button>}
          </div>)}
        </div>
      </div>
      <footer className="pdf-split-footer">
        <span>{outputCount} arquivo(s) serão gerados</span>
        {message && <span className="pdf-split-message">{message}</span>}
      </footer>
    </div>
  </div>
}

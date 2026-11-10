import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, RotateCw, Maximize, Minimize, Scissors, LoaderCircle, Expand, FileText } from 'lucide-react'
import './PdfPageViewer.css'

type Props = {
  pdf: PDFDocumentProxy
  pageOrder: number[]
  rotations: Record<number, number>
  fileName: string
  page: number
  onPageChange: (page: number) => void
  onRotate: (direction: number) => void
  onSplit: () => void
  onClose: () => void
}

export default function PdfPageViewer({ pdf, pageOrder, rotations, fileName, page, onPageChange, onRotate, onSplit, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState<'width' | 'height' | 'free'>('fit')
  const [available, setAvailable] = useState({ width: 900, height: 700 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const touchStartX = useRef<number | null>(null)

  const goTo = useCallback((next: number) => {
    onPageChange(Math.max(1, Math.min(pageOrder.length, next)))
  }, [onPageChange, pageOrder.length])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const update = () => setAvailable({ width: Math.max(240, node.clientWidth - 48), height: Math.max(240, node.clientHeight - 48) })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); goTo(page + 1) }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); goTo(page - 1) }
      if (event.key === 'Escape' && fullscreen) void document.exitFullscreen?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, page, fullscreen])

  useEffect(() => {
    let cancelled = false
    let task: ReturnType<Awaited<ReturnType<typeof pdf.getPage>>['render']> | null = null
    async function render() {
      const canvas = canvasRef.current
      if (!canvas || !pageOrder.length) return
      setLoading(true)
      setError('')
      try {
        const sourcePage = pageOrder[page - 1]
        const pageProxy = await pdf.getPage(sourcePage)
        if (cancelled) return
        const rotation = (pageProxy.rotate + (rotations[sourcePage] || 0)) % 360
        const unit = pageProxy.getViewport({ scale: 1, rotation })
        const fitWidth = available.width / unit.width
        const fitHeight = available.height / unit.height
        const baseScale = fitMode === 'width' ? fitWidth : fitMode === 'height' ? fitHeight : fitMode === 'free' ? 1 : Math.min(fitWidth, fitHeight)
        const scale = Math.max(.2, Math.min(4, baseScale * zoom))
        const viewport = pageProxy.getViewport({ scale, rotation })
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.ceil(viewport.width * outputScale)
        canvas.height = Math.ceil(viewport.height * outputScale)
        canvas.style.width = Math.ceil(viewport.width) + 'px'
        canvas.style.height = Math.ceil(viewport.height) + 'px'
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) throw new Error('Não foi possível preparar a visualização.')
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, viewport.width, viewport.height)
        task = pageProxy.render({ canvasContext: context, viewport })
        await task.promise
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Não foi possível renderizar esta página.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void render()
    return () => { cancelled = true; try { task?.cancel() } catch { /* render already ended */ } }
  }, [pdf, pageOrder, rotations, page, zoom, fitMode, available])

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  async function toggleFullscreen() {
    if (!document.fullscreenElement) await rootRef.current?.requestFullscreen?.()
    else await document.exitFullscreen?.()
  }

  function setFit(mode: 'width' | 'height') {
    setFitMode(mode)
    setZoom(1)
  }

  return <div className="pdf-viewer-overlay" ref={rootRef} role="dialog" aria-modal="true" aria-label="Visualizador de PDF">
    <header className="pdf-viewer-toolbar">
      <button className="pdf-viewer-back" onClick={onClose} title="Voltar ao editor"><ArrowLeft size={17}/><span>Voltar</span></button>
      <div className="pdf-viewer-file"><FileText size={17}/><span title={fileName}>{fileName}</span></div>
      <div className="pdf-viewer-navigation">
        <button onClick={() => goTo(page - 1)} disabled={page <= 1} title="Página anterior"><ChevronLeft/></button>
        <label><input aria-label="Número da página" type="number" min={1} max={pageOrder.length} value={page} onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n)) goTo(n) }} onBlur={event => { if (!event.target.value) goTo(1) }}/><span>/ {pageOrder.length}</span></label>
        <button onClick={() => goTo(page + 1)} disabled={page >= pageOrder.length} title="Próxima página"><ChevronRight/></button>
      </div>
      <div className="pdf-viewer-tools">
        <button onClick={() => setZoom(value => Math.max(.35, +(value - .15).toFixed(2)))} title="Diminuir zoom"><ZoomOut/></button>
        <span className="pdf-viewer-zoom">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(value => Math.min(3, +(value + .15).toFixed(2)))} title="Aumentar zoom"><ZoomIn/></button>
        <button onClick={() => setFit('width')} title="Ajustar à largura"><Expand/></button>
        <button onClick={() => setFit('height')} title="Ajustar à altura"><Minimize/></button>
        <button onClick={() => onRotate(-90)} title="Girar para esquerda"><RotateCcw/></button>
        <button onClick={() => onRotate(90)} title="Girar para direita"><RotateCw/></button>
        <button onClick={() => void toggleFullscreen()} title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}><Maximize/></button>
      </div>
      <button className="pdf-viewer-split" onClick={onSplit}><Scissors size={17}/> DIVIDIR PDF</button>
    </header>
    <main className="pdf-viewer-body" ref={viewportRef} onTouchStart={event => { touchStartX.current = event.touches[0]?.clientX ?? null }} onTouchEnd={event => {
      if (touchStartX.current === null) return
      const delta = event.changedTouches[0].clientX - touchStartX.current
      if (Math.abs(delta) > 65) goTo(page + (delta < 0 ? 1 : -1))
      touchStartX.current = null
    }}>
      <button className="pdf-viewer-side previous" onClick={() => goTo(page - 1)} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft/></button>
      <div className="pdf-viewer-page-wrap">
        <div className="pdf-viewer-page">
          <canvas ref={canvasRef}/>
          {loading && <div className="pdf-viewer-loading"><LoaderCircle className="pdf-viewer-spin" size={28}/><span>Carregando página {page}…</span></div>}
          {error && <div className="pdf-viewer-error">{error}</div>}
        </div>
      </div>
      <button className="pdf-viewer-side next" onClick={() => goTo(page + 1)} disabled={page >= pageOrder.length} aria-label="Próxima página"><ChevronRight/></button>
    </main>
    <footer className="pdf-viewer-footer"><span>Página {page} de {pageOrder.length}</span><span>Use ← → para navegar ou deslize para os lados</span></footer>
  </div>
}

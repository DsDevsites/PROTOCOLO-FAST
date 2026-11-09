import { useEffect, useRef, useState } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft, ChevronLeft, ChevronRight, Download, FilePlus2, ImagePlus, MousePointer2, RectangleHorizontal, Signature, Trash2, Type, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import './PdfOrganizer.css'

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
type Mark = { id: string; page: number; kind: 'text' | 'rect' | 'image' | 'signature'; x: number; y: number; w: number; h: number; text?: string; data?: string; color?: string; fontSize?: number }
type Tool = 'select' | 'text' | 'rect' | 'image' | 'signature'
const uid = () => globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random())

export default function PdfOrganizer({ onBack }: { onBack: () => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [fileName, setFileName] = useState('')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [marks, setMarks] = useState<Mark[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [color, setColor] = useState('#f97316')
  const [fontSize, setFontSize] = useState(18)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const [signaturePoints, setSignaturePoints] = useState<string>('')
  const [stageSize, setStageSize] = useState({ width: 612, height: 792 })
  const drawing = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function render() {
      if (!pdf || !canvasRef.current) return
      const current = await pdf.getPage(page)
      if (cancelled || !canvasRef.current) return
      const viewport = current.getViewport({ scale: zoom })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.style.width = viewport.width + 'px'
      canvas.style.height = viewport.height + 'px'
      setStageSize({ width: viewport.width, height: viewport.height })
      await current.render({ canvasContext: context, viewport }).promise
    }
    void render().catch(error => setMessage(error instanceof Error ? error.message : 'Falha ao renderizar página.'))
    return () => { cancelled = true }
  }, [pdf, page, zoom])

  async function openFile(file?: File) {
    if (!file) return
    if (file.type !== 'application/pdf') { setMessage('Selecione um arquivo PDF válido.'); return }
    setBusy(true); setMessage('')
    try {
      const bytes = await file.arrayBuffer()
      const loaded = await getDocument({ data: new Uint8Array(bytes) }).promise
      setPdf(loaded); setPageCount(loaded.numPages); setPage(1); setMarks([]); setSelected(null); setFileName(file.name)
      setMessage('PDF carregado. Escolha uma ferramenta para começar.')
    } catch { setMessage('Não foi possível abrir este PDF. Verifique se o arquivo não está protegido por senha ou danificado.') }
    finally { setBusy(false) }
  }

  function stagePoint(event: React.MouseEvent<HTMLDivElement>) {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return { x: 12, y: 12 }
    return { x: Math.max(0, Math.min(90, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(0, Math.min(90, ((event.clientY - rect.top) / rect.height) * 100)) }
  }
  function addMark(event: React.MouseEvent<HTMLDivElement>) {
    if (tool === 'select' || tool === 'signature' || tool === 'image') return
    const p = stagePoint(event)
    if (tool === 'text') {
      const text = window.prompt('Digite o texto que deseja inserir no PDF:')
      if (!text?.trim()) return
      const mark: Mark = { id: uid(), page, kind: 'text', x: p.x, y: p.y, w: 36, h: 8, text: text.trim(), color, fontSize }
      setMarks(old => [...old, mark]); setSelected(mark.id)
    } else {
      const mark: Mark = { id: uid(), page, kind: 'rect', x: p.x, y: p.y, w: 24, h: 12, color }
      setMarks(old => [...old, mark]); setSelected(mark.id)
    }
    setTool('select')
  }
  function startSignature(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== 'signature') return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }
    drawing.current = true; setSignaturePoints(`M ${p.x} ${p.y}`)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveSignature(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawing.current) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }
    setSignaturePoints(old => old + ` L ${p.x} ${p.y}`)
  }
  function endSignature() {
    if (!drawing.current) return
    drawing.current = false
    if (signaturePoints.length > 4) {
      const mark: Mark = { id: uid(), page, kind: 'signature', x: 0, y: 0, w: 100, h: 100, data: signaturePoints, color }
      setMarks(old => [...old, mark]); setSelected(mark.id)
    }
    setSignaturePoints(''); setTool('select')
  }
  async function addImage(file?: File) {
    if (!file || !file.type.startsWith('image/')) return
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    const mark: Mark = { id: uid(), page, kind: 'image', x: 15, y: 15, w: 30, h: 22, data }
    setMarks(old => [...old, mark]); setSelected(mark.id); setTool('select')
  }
  function updateMark(id: string, patch: Partial<Mark>) { setMarks(old => old.map(mark => mark.id === id ? { ...mark, ...patch } : mark)) }
  function dragMark(event: React.PointerEvent<HTMLDivElement>, mark: Mark) {
    if (tool !== 'select' || mark.kind === 'signature') return
    event.stopPropagation()
    const startX = event.clientX, startY = event.clientY, originX = mark.x, originY = mark.y
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      updateMark(mark.id, { x: Math.max(0, Math.min(95, originX + ((e.clientX - startX) / rect.width) * 100)), y: Math.max(0, Math.min(95, originY + ((e.clientY - startY) / rect.height) * 100)) })
    }
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop)
    setSelected(mark.id)
  }
  async function exportPdf() {
    if (!pdf) return
    setBusy(true); setMessage('Preparando PDF final…')
    try {
      // Keep the original PDF bytes so all original pages and content are preserved.
      const original = await pdf.getData()
      const output = await PDFDocument.load(original)
      const font = await output.embedFont(StandardFonts.Helvetica)
      const pages = output.getPages()
      for (const mark of marks) {
        const target = pages[mark.page - 1]
        if (!target) continue
        const { width, height } = target.getSize()
        const x = width * mark.x / 100
        const y = height - height * mark.y / 100
        const w = width * mark.w / 100, h = height * mark.h / 100
        const hex = (mark.color || '#f97316').replace('#', '')
        const c = rgb(parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255)
        if (mark.kind === 'text' && mark.text) target.drawText(mark.text, { x, y: y - (mark.fontSize || 18), size: mark.fontSize || 18, font, color: c, maxWidth: Math.max(40, w || 250) })
        if (mark.kind === 'rect') target.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: c, borderWidth: 2 })
        if (mark.kind === 'image' && mark.data) {
          const bytes = Uint8Array.from(atob(mark.data.split(',')[1]), ch => ch.charCodeAt(0))
          const embedded = mark.data.startsWith('data:image/png') ? await output.embedPng(bytes) : await output.embedJpg(bytes)
          target.drawImage(embedded, { x, y: y - h, width: w, height: h })
        }
        if (mark.kind === 'signature' && mark.data) {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 100 100"><path d="${mark.data}" fill="none" stroke="${mark.color || '#f97316'}" stroke-width="0.65" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          const png = await svgToPng(svg)
          const embedded = await output.embedPng(png)
          target.drawImage(embedded, { x: 0, y: 0, width, height })
        }
      }
      const bytes = await output.save()
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const link = document.createElement('a'); link.href = url; link.download = (fileName.replace(/\.pdf$/i, '') || 'documento') + '-editado.pdf'; link.click()
      URL.revokeObjectURL(url); setMessage('PDF exportado com sucesso.')
    } catch (error) { setMessage(error instanceof Error ? 'Erro ao exportar: ' + error.message : 'Não foi possível exportar o PDF.') }
    finally { setBusy(false) }
  }
  function svgToPng(svg: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const image = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; canvas.getContext('2d')?.drawImage(image,0,0); canvas.toBlob(blob => { if (!blob) return reject(new Error('Falha na assinatura')); blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer))) }, 'image/png'); URL.revokeObjectURL(url) }
      image.onerror = reject; image.src = url
    })
  }
  function removeSelected() { if (selected) { setMarks(old => old.filter(mark => mark.id !== selected)); setSelected(null) } }

  return <main className="app-shell pdf-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}><ArrowLeft size={15}/> VOLTAR AO NEXO</button><a className="brand" href="#"><span className="brand-mark">N</span><span><strong>NEXO<span> OPERACIONAL</span></strong><small>ORGANIZADOR E EDITOR DE PDF</small></span></a><span className="secure">PROCESSAMENTO LOCAL</span></header>
    <section className="pdf-heading"><div className="eyebrow"><span className="pulse"/> CENTRAL DE DOCUMENTOS</div><h1>Organize. Edite.<br/><em>Finalize seus PDFs.</em></h1><p>Junte, revise, anote e personalize documentos em um único ambiente.</p></section>
    {!pdf ? <section className="pdf-upload"><div className="pdf-upload-icon"><FilePlus2 size={34}/></div><h2>Comece com um documento PDF</h2><p>Selecione um arquivo do aparelho. O processamento acontece localmente no navegador.</p><button className="action-button" onClick={() => fileRef.current?.click()}><Upload size={17}/> ABRIR PDF</button><input ref={fileRef} hidden type="file" accept="application/pdf" onChange={e => void openFile(e.target.files?.[0])}/></section> :
    <section className="pdf-workspace">
      <div className="pdf-filebar"><div><strong>{fileName}</strong><small>{pageCount} páginas • alterações locais</small></div><button className="export-button" disabled={busy} onClick={() => void exportPdf()}><Download size={16}/> EXPORTAR PDF</button></div>
      <div className="pdf-toolbar">
        <div className="tool-group">
          <button className={tool==='select'?'active':''} title="Selecionar e mover" onClick={()=>setTool('select')}><MousePointer2/></button>
          <button className={tool==='text'?'active':''} title="Inserir texto" onClick={()=>setTool('text')}><Type/></button>
          <button className={tool==='rect'?'active':''} title="Desenhar retângulo" onClick={()=>setTool('rect')}><RectangleHorizontal/></button>
          <button className={tool==='signature'?'active':''} title="Desenhar assinatura" onClick={()=>setTool('signature')}><Signature/></button>
          <button className={tool==='image'?'active':''} title="Adicionar imagem" onClick={()=>{setTool('image');imageRef.current?.click()}}><ImagePlus/></button>
          <input ref={imageRef} hidden type="file" accept="image/*" onChange={e=>void addImage(e.target.files?.[0])}/>
        </div>
        <div className="tool-group"><button title="Diminuir zoom" onClick={()=>setZoom(z=>Math.max(.45,z-.15))}><ZoomOut/></button><span>{Math.round(zoom*100)}%</span><button title="Aumentar zoom" onClick={()=>setZoom(z=>Math.min(2.2,z+.15))}><ZoomIn/></button></div>
        <div className="tool-group"><label>Cor <input aria-label="Cor da ferramenta" type="color" value={color} onChange={e=>setColor(e.target.value)}/></label><label>Texto <select value={fontSize} onChange={e=>setFontSize(Number(e.target.value))}><option value="12">12</option><option value="16">16</option><option value="18">18</option><option value="24">24</option><option value="32">32</option></select></label><button disabled={!selected} title="Excluir elemento selecionado" onClick={removeSelected}><Trash2/></button></div>
      </div>
      <div className="pdf-instructions">{tool==='text'?'Toque na página para inserir um texto.':tool==='rect'?'Toque na página para adicionar um retângulo.':tool==='signature'?'Desenhe sua assinatura diretamente sobre a página.':tool==='image'?'Escolha uma imagem nos arquivos.':'Selecione e arraste os elementos adicionados.'}</div>
      <div className="pdf-stage-scroll"><div className="pdf-stage" ref={stageRef} onClick={addMark} onPointerDown={startSignature} onPointerMove={moveSignature} onPointerUp={endSignature} onPointerCancel={endSignature} style={{width:stageSize.width,height:stageSize.height,cursor:tool==='text'||tool==='rect'?'crosshair':tool==='signature'?'crosshair':'default'}}>
        <canvas ref={canvasRef}/>
        {marks.filter(mark=>mark.page===page).map(mark=>mark.kind==='signature'?<svg key={mark.id} className="pdf-signature" viewBox="0 0 100 100" preserveAspectRatio="none"><path d={mark.data} fill="none" stroke={mark.color} strokeWidth=".65" strokeLinecap="round" strokeLinejoin="round"/></svg>:<div key={mark.id} onPointerDown={e=>dragMark(e,mark)} onClick={e=>{e.stopPropagation();setSelected(mark.id)}} className={'pdf-mark '+(selected===mark.id?'selected':'')} style={{left:mark.x+'%',top:mark.y+'%',width:mark.w+'%',height:mark.h+'%',color:mark.color,borderColor:mark.color,background:mark.kind==='rect'?'transparent':'rgba(255,255,255,.88)',fontSize:mark.fontSize+'px'}}>{mark.kind==='text'?mark.text:mark.kind==='image'?<img src={mark.data} alt="Imagem adicionada"/>:null}</div>)}
        {signaturePoints&&<svg className="pdf-signature preview" viewBox="0 0 100 100" preserveAspectRatio="none"><path d={signaturePoints} fill="none" stroke={color} strokeWidth=".65" strokeLinecap="round"/></svg>}
      </div></div>
      <div className="pdf-pager"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}><ChevronLeft/> ANTERIOR</button><span>PÁGINA <strong>{page}</strong> DE {pageCount}</span><button disabled={page>=pageCount} onClick={()=>setPage(p=>p+1)}>PRÓXIMA <ChevronRight/></button></div>
      <div className="pdf-note">As anotações são adicionadas como uma nova camada. O conteúdo original do PDF é preservado; textos já gravados na página não são diretamente reescritos nesta versão.</div>
    </section>}
    {message&&<div className="notice success">{message}</div>}
    {busy&&<div className="processing">Processando documento…</div>}
    <footer><span>NEXO OPERACIONAL</span><span>ORGANIZADOR DE PDF • FERRAMENTA INDEPENDENTE</span></footer>
  </main>
}

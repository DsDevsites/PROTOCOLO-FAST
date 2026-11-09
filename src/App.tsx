import { useEffect, useMemo, useRef, useState } from 'react'
import Home from './Home'
import CardPrint from './CardPrint'
import Scanner from './Scanner'
import {
  AlertCircle, Camera, Check, CheckCircle2, ChevronDown, ChevronUp, ClipboardList,
  Download, ImagePlus, LoaderCircle, Minus, Plus, RotateCcw, Search,
  ShieldCheck, Trash2, X, Zap
} from 'lucide-react'

type Entry = { id: string; title: string; count: number; createdAt: string }
type ScanRecord = { id: string; title: string; date: string }
type OcrWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>

const STORAGE_KEY = 'protocolo-fast-v1'

function normalizeTitle(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
function makeId() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}` }

export default function App() {
  const [activeModule, setActiveModule] = useState<'home' | 'protocol' | 'cards' | 'scanner'>('home')
  const [entries, setEntries] = useState<Entry[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Entry[] } catch { return [] }
  })
  const [scans, setScans] = useState<ScanRecord[]>(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY + '-scans') || '[]') as ScanRecord[] } catch { return [] } })
  const [titleDraft, setTitleDraft] = useState('')
  const [recognizedText, setRecognizedText] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [lastImage, setLastImage] = useState<Blob | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [portraitFeed, setPortraitFeed] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workerRef = useRef<OcrWorker | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) } catch { setError('Não foi possível salvar o protocolo neste aparelho. Exporte o Excel para não perder os dados.') } }, [entries])
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY + '-scans', JSON.stringify(scans)) } catch { /* histórico complementar */ } }, [scans])

  // Attach the stream only after React has rendered the video element.
  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return
    const video = videoRef.current
    video.srcObject = streamRef.current
    video.onloadedmetadata = () => setPortraitFeed(video.videoHeight > video.videoWidth && window.matchMedia('(orientation: landscape)').matches)
    video.muted = true
    video.playsInline = true
    void video.play().catch(() => {
      setCameraError('A câmera foi autorizada, mas o navegador não iniciou o vídeo. Feche a câmera e tente novamente.')
    })
    return () => {
      video.pause()
      video.srcObject = null
      video.onloadedmetadata = null
    }
  }, [cameraOpen])
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    void workerRef.current?.terminate()
  }, [])

  const total = entries.reduce((sum, item) => sum + item.count, 0)
  const filtered = useMemo(() => entries.filter(item => item.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))), [entries, query])

  async function getWorker() {
    const { createWorker } = await import('tesseract.js')
    if (!workerRef.current) {
      setStatus('Preparando reconhecimento em português…')
      workerRef.current = await createWorker('por', 1, {
        logger: message => {
          if (message.status === 'recognizing text') setProgress(Math.round(message.progress * 100))
          else if (message.status) setStatus(message.status === 'loading language traineddata' ? 'Carregando idioma português…' : message.status)
        }
      })
    }
    return workerRef.current
  }

  async function recognize(source: Blob | string, mode: 'task-row' | 'full-page' = 'full-page') {
    setBusy(true); setError(''); setProgress(0); setRecognizedText(''); setTitleDraft('')
    try {
      const worker = await getWorker()
      setStatus('Preparando imagem e procurando o nome digitado da APR…')
      const imageBlob = source instanceof Blob ? source : await (await fetch(source)).blob()
      setLastImage(imageBlob)
      const bitmap = await createImageBitmap(imageBlob)
      const scale = Math.min(3, 2600 / bitmap.width)
      const base = document.createElement('canvas')
      base.width = Math.max(1, Math.round(bitmap.width * scale))
      base.height = Math.max(1, Math.round(bitmap.height * scale))
      const baseCtx = base.getContext('2d')
      if (!baseCtx) throw new Error('Não foi possível preparar a imagem.')
      baseCtx.drawImage(bitmap, 0, 0, base.width, base.height)
      bitmap.close()

      // APR title fields are normally typed. Read the full page and the upper/header area
      // with different segmentation modes to avoid losing a title because of page layout.
      const sources: HTMLCanvasElement[] = [base]
      if (mode === 'full-page') {
        const header = document.createElement('canvas')
        header.width = base.width
        header.height = Math.max(1, Math.round(base.height * 0.68))
        const headerCtx = header.getContext('2d')
        if (headerCtx) { headerCtx.drawImage(base, 0, 0, base.width, header.height, 0, 0, header.width, header.height); sources.push(header) }
      }
      const modes = mode === 'task-row' ? ['7', '6'] : ['6', '11', '4']
      const allLines: string[] = []
      const recognizer = worker as unknown as {
        setParameters: (value: Record<string, string>) => Promise<void>
        recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>
      }
      for (const canvas of sources) {
        for (const pageSegMode of modes) {
          setStatus(mode === 'task-row' ? 'Lendo a faixa da APR em mais de uma passagem…' : 'Analisando o cabeçalho e o conteúdo da APR…')
          await recognizer.setParameters({
            tessedit_pageseg_mode: pageSegMode,
            load_system_dawg: '0',
            load_freq_dawg: '0',
            preserve_interword_spaces: '1',
            user_defined_dpi: '300',
          })
          const result = await recognizer.recognize(canvas)
          allLines.push(...result.data.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
        }
      }

      const clean = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      const labelPatterns = [
        /T\s*[A4]\s*R\s*[E3]\s*F\s*[A4]\s*:?/,
        /NOME\s+DA\s+A\s*P\s*R\s*:?/,
        /TITULO\s+DA\s+A\s*P\s*R\s*:?/,
        /DESCRICAO\s+DA\s+ATIVIDADE\s*:?/,
      ]
      let title = ''
      for (const line of allLines) {
        const normalized = clean(line)
        const label = labelPatterns.map(pattern => normalized.match(pattern)).find(Boolean)
        if (!label) continue
        const index = label.index ?? -1
        const after = index >= 0 ? normalized.slice(index + label[0].length).replace(/^\s*[:;,\.\-–—]+/, '').trim() : ''
        const before = index > 0 ? normalized.slice(0, index).trim() : ''
        const candidate = after.length >= 8 ? after : before.length >= 8 ? before : ''
        if (candidate.length > title.length) title = candidate
      }

      // If the printed label was not detected, only use a strong, long text line from
      // the header area; never add a short fragment or a line made only of form labels.
      if (title.length < 8) {
        const excluded = /^(APR|ANALISE PRELIMINAR DE RISCO|DATA|EMPRESA|CONTRATADA|RESPONSAVEL|LOCAL|SETOR|CLIENTE|PAGINA|NUMERO|NOME|ASSINATURA|VALIDADE)$/
        const candidates = allLines.map(line => clean(line))
          .filter(line => line.length >= 16 && /[A-Z]/.test(line) && !excluded.test(line))
          .filter(line => !/^(\d+\s*)+$/.test(line))
        const likely = candidates.sort((a, b) => b.length - a.length)[0]
        if (likely && likely.length <= 110) title = likely
      }

      title = title.replace(/\s+/g, ' ').replace(/^[^A-Z0-9]+|[^A-Z0-9)]+$/g, '').trim()
      if (title.length < 8) {
        setRecognizedText('')
        setTitleDraft('')
        setError('Não consegui identificar com segurança o nome da APR. Envie uma foto mais próxima e nítida do campo onde o nome está digitado, sem cortar o texto.')
        return
      }
      setRecognizedText(title)
      setTitleDraft(title)
      setStatus('Nome da APR identificado. Confira o texto antes de adicionar ao protocolo.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível reconhecer o texto. Tente novamente.')
    } finally { setBusy(false); setProgress(0) }
  }


  async function recognizeWithAI() {
    if (!lastImage || aiBusy) return
    setAiBusy(true); setError(''); setStatus('A IA está analisando o título digitado da APR…')
    try {
      const bitmap = await createImageBitmap(lastImage)
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Não foi possível preparar a imagem para a IA.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const imageData = canvas.toDataURL('image/jpeg', 0.82)
      const response = await fetch('/api/analyze-apr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      })
      const result = await response.json() as { title?: string; confidence?: number; error?: string }
      if (!response.ok) throw new Error(result.error || 'A análise por IA não foi concluída.')
      const title = (result.title || '').trim().replace(/\\s+/g, ' ')
      if (title.length < 5) throw new Error('A IA não encontrou um título confiável. Tente uma foto mais próxima do campo TAREFA.')
      setTitleDraft(title)
      setRecognizedText(title)
      setError('')
      const confidence = typeof result.confidence === 'number' ? Math.round(result.confidence * 100) : null
      setStatus(confidence === null ? 'Título sugerido pela IA. Confira antes de adicionar.' : `Título sugerido pela IA • confiança estimada: ${confidence}%. Confira antes de adicionar.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao analisar a APR com IA.')
    } finally { setAiBusy(false) }
  }

  async function openCamera() {
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Seu navegador não liberou acesso à câmera. Use a opção Enviar foto.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 } }, audio: false })
      streamRef.current = stream
      setPortraitFeed(false)
      setCameraOpen(true)
    } catch {
      setCameraError('Não foi possível abrir a câmera. Verifique a permissão do navegador ou envie uma foto da galeria.')
    }
  }
  function closeCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOpen(false)
    setPortraitFeed(false)
  }
  async function capturePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return
    // Normalize portrait-oriented iPhone camera feeds into a real landscape frame.
    const rotated = video.videoHeight > video.videoWidth && window.matchMedia('(orientation: landscape)').matches
    const fullWidth = rotated ? video.videoHeight : video.videoWidth
    const fullHeight = rotated ? video.videoWidth : video.videoHeight
    const full = document.createElement('canvas')
    full.width = fullWidth
    full.height = fullHeight
    const fullCtx = full.getContext('2d')
    if (!fullCtx) return
    if (rotated) {
      fullCtx.translate(fullWidth, 0)
      fullCtx.rotate(Math.PI / 2)
      fullCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
    } else {
      fullCtx.drawImage(video, 0, 0, fullWidth, fullHeight)
    }
    const bandHeight = Math.round(fullHeight * 0.24)
    const sourceY = Math.round((fullHeight - bandHeight) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = fullWidth
    canvas.height = bandHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(full, 0, sourceY, fullWidth, bandHeight, 0, 0, fullWidth, bandHeight)
    closeCamera()
    canvas.toBlob(blob => { if (blob) void recognize(blob, 'task-row') }, 'image/jpeg', 0.96)
  }
  async function handleFile(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selecione uma imagem JPG, PNG ou WEBP.'); return }
    if (file.size > 15 * 1024 * 1024) { setError('A imagem deve ter no máximo 15 MB.'); return }
    await recognize(file, 'full-page')
    if (fileRef.current) fileRef.current.value = ''
  }

  function addTitle() {
    const title = titleDraft.trim().replace(/\s+/g, ' ')
    if (!title) { setError('Digite ou reconheça um título antes de adicionar.'); return }
    const key = normalizeTitle(title)
    if (!key) { setError('Esse título não parece válido. Confira o texto.'); return }
    setEntries(current => {
      const existing = current.find(item => normalizeTitle(item.title) === key)
      if (existing) return current.map(item => item.id === existing.id ? { ...item, count: item.count + 1 } : item)
      return [...current, { id: makeId(), title, count: 1, createdAt: new Date().toISOString() }]
    })
    setScans(current => [{ id: makeId(), title, date: new Date().toISOString() }, ...current])
    setTitleDraft(''); setRecognizedText(''); setError(''); setStatus('Título adicionado ao protocolo.')
  }
  function changeCount(id: string, delta: number) {
    setEntries(current => current.map(item => item.id === id ? { ...item, count: Math.max(1, item.count + delta) } : item))
  }
  function editTitle(id: string) {
    const item = entries.find(entry => entry.id === id)
    if (!item) return
    const next = window.prompt('Corrigir nome da atividade:', item.title)
    if (next === null) return
    const clean = next.trim().replace(/\s+/g, ' ')
    if (!clean) { setError('O título não pode ficar vazio.'); return }
    const duplicate = entries.find(entry => entry.id !== id && normalizeTitle(entry.title) === normalizeTitle(clean))
    if (duplicate) {
      setEntries(current => current.filter(entry => entry.id !== id).map(entry => entry.id === duplicate.id ? { ...entry, count: entry.count + item.count } : entry))
    } else setEntries(current => current.map(entry => entry.id === id ? { ...entry, title: clean } : entry))
  }
  function removeEntry(id: string) {
    const item = entries.find(entry => entry.id === id)
    if (!item || !window.confirm(`Excluir "${item.title}" do protocolo?`)) return
    setEntries(current => current.filter(entry => entry.id !== id))
  }
  function resetProtocol() {
    if (!entries.length || !window.confirm('Apagar todo o protocolo atual? Esta ação não pode ser desfeita.')) return
    setEntries([]); setScans([]); setRecognizedText(''); setTitleDraft(''); setError(''); setStatus('')
  }
  async function exportExcel() {
    if (!entries.length) { setError('Adicione pelo menos uma APR antes de exportar.'); return }
    setError('')
    try {
      const sorted = [...entries] // Preserve the order in which APR titles were first read
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'NEXO OPERACIONAL'
      workbook.created = new Date()
      const protocol = workbook.addWorksheet('Protocolo')
      protocol.columns = [
        { header: 'Nº', key: 'number', width: 8 },
        { header: 'Título / Nome da APR', key: 'title', width: 58 },
        { header: 'Quantidade', key: 'quantity', width: 14 },
      ]
      sorted.forEach((item, index) => protocol.addRow({ number: index + 1, title: item.title, quantity: item.count }))
      protocol.getRow(1).font = { bold: true }
      protocol.views = [{ state: 'frozen', ySplit: 1 }]
      if (scans.length) {
        const history = workbook.addWorksheet('Leituras')
        history.columns = [
          { header: 'Nº', key: 'number', width: 8 },
          { header: 'Título reconhecido', key: 'title', width: 58 },
          { header: 'Data e hora', key: 'date', width: 24 },
        ]
        scans.forEach((item, index) => history.addRow({ number: index + 1, title: item.title, date: new Date(item.date).toLocaleString('pt-BR') }))
        history.getRow(1).font = { bold: true }
        history.views = [{ state: 'frozen', ySplit: 1 }]
      }
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `NEXO-PROTOCOLO-${new Date().toISOString().slice(0,10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
      setStatus('Planilha Excel gerada com sucesso.')
    } catch (e) {
      setError(e instanceof Error ? `Falha ao gerar Excel: ${e.message}` : 'Não foi possível gerar o Excel. Tente novamente.')
    }
  }

  if (activeModule === 'home') return <Home onSelect={module => setActiveModule(module)} />
  if (activeModule === 'cards') return <CardPrint onBack={() => setActiveModule('home')} />
  if (activeModule === 'scanner') return <Scanner onBack={() => setActiveModule('home')} />

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="back-button" onClick={() => setActiveModule("home")}>← VOLTAR AOS SISTEMAS</button>
        <a className="brand" href="#" aria-label="NEXO Operacional início">
          <span className="brand-mark"><Zap size={22} fill="currentColor" /></span>
          <span><strong>NEXO<span> OPERACIONAL</span></strong><small>LEITURA INTELIGENTE DE APR</small></span>
        </a>
        <div className="secure"><ShieldCheck size={15} /> OCR LOCAL • IA SOB SOLICITAÇÃO</div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" /> CONTROLE DE APR</div>
          <h1>Seu protocolo.<br /><em>Sem contagem manual.</em></h1>
          <p>Fotografe o título de cada APR. O sistema reconhece, agrupa nomes iguais e soma as quantidades automaticamente.</p>
        </div>
        <div className="hero-stats">
          <div><span>APRs contabilizadas</span><strong>{total.toString().padStart(2, '0')}</strong></div>
          <div><span>Títulos diferentes</span><strong>{entries.length.toString().padStart(2, '0')}</strong></div>
        </div>
      </section>

      <section className="workspace">
        <div className="section-heading"><div><span className="step">01</span><div><h2>Adicionar APR</h2><p>Capture ou envie uma foto do título/nome.</p></div></div><span className="tag">OCR • PORTUGUÊS</span></div>
        <div className="capture-grid">
          <button className="capture-card primary" onClick={() => void openCamera()} disabled={busy}>
            <span className="capture-icon"><Camera size={25} /></span><strong>ABRIR CÂMERA</strong><small>Usar câmera do celular</small><span className="card-arrow">↗</span>
          </button>
          <button className="capture-card" onClick={() => fileRef.current?.click()} disabled={busy}>
            <span className="capture-icon"><ImagePlus size={25} /></span><strong>ENVIAR FOTO</strong><small>Escolher da galeria ou arquivos</small><span className="card-arrow">↗</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={event => void handleFile(event.target.files?.[0])} />
        </div>
        {cameraError && <div className="notice error"><AlertCircle size={17}/>{cameraError}</div>}
        {cameraOpen && <div className="camera-panel">
          <div className="camera-head"><strong><Camera size={17}/> CÂMERA ATIVA</strong><button className="icon-button" onClick={closeCamera} aria-label="Fechar câmera"><X size={19}/></button></div>
          <div className={`camera-view${portraitFeed ? " rotate-feed" : ""}`}><video ref={videoRef} autoPlay playsInline muted /><div className="scan-overlay"><div className="scan-window"><span>ALINHE A LINHA TAREFA AQUI</span></div></div></div>
          <p className="camera-tip">Enquadre a linha inteira, incluindo a palavra TAREFA e todo o texto ao lado, dentro da faixa laranja.</p>
          <button className="action-button full" onClick={() => void capturePhoto()}><Camera size={18}/> CAPTURAR FOTO</button>
        </div>}
        {busy && <div className="processing"><LoaderCircle className="spin" size={20}/><div><strong>{status || 'Processando imagem…'}</strong><div className="progress"><span style={{ width: progress + '%' }}/></div></div><b>{progress}%</b></div>}
        {recognizedText && !busy && <div className="review-card">
          <div className="review-title"><span><CheckCircle2 size={17}/> TEXTO IDENTIFICADO</span><button className="icon-button" onClick={() => { setRecognizedText(''); setTitleDraft('') }} aria-label="Limpar reconhecimento"><X size={18}/></button></div>
          <div className="recognized-lines">{recognizedText.split('\n').slice(0, 8).map((line, index) => <button key={index} className={titleDraft === line ? 'recognized-line selected' : 'recognized-line'} onClick={() => setTitleDraft(line)}>{line}<span>{titleDraft === line ? <Check size={15}/> : 'USAR'}</span></button>)}</div>
          <label className="field-label" htmlFor="title">CONFIRME OU CORRIJA O TÍTULO</label>
          <input id="title" className="title-input" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} placeholder="Nome da atividade" />
          <button className="action-button full" onClick={addTitle}><Plus size={18}/> ADICIONAR AO PROTOCOLO</button>
        </div>}
        {error && <div className="notice error"><AlertCircle size={17}/><span>{error}</span><button onClick={() => setError('')}><X size={15}/></button></div>}
        {error && lastImage && <button className="action-button full ai-retry-button" onClick={() => void recognizeWithAI()} disabled={aiBusy || busy}><Zap size={17}/>{aiBusy ? 'IA ANALISANDO APR…' : 'TENTAR RECONHECER COM IA'}</button>}
        {aiBusy && <div className="processing"><LoaderCircle className="spin" size={20}/><div><strong>Analisando a imagem com IA multimodal…</strong><small>A IA procura o título digitado e ignora nomes, datas e outros campos.</small></div></div>}
        {status && !busy && !recognizedText && <div className="notice success"><CheckCircle2 size={17}/>{status}</div>}
      </section>

      <section className="protocol">
        <div className="section-heading"><div><span className="step">02</span><div><h2>Protocolo consolidado</h2><p>Nomes repetidos são agrupados automaticamente.</p></div></div><span className="count-pill">{entries.length} ITENS</span></div>
        <div className="toolbar">
          <div className="searchbox"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar atividade…" /></div>
          <button className="export-button" onClick={() => void exportExcel()} disabled={!entries.length}><Download size={17}/> <span>EXCEL</span></button>
        </div>
        {entries.length === 0 ? <div className="empty-state"><span><ClipboardList size={30}/></span><strong>Seu protocolo está vazio</strong><p>Fotografe a primeira APR para começar a contagem.</p></div> :
          <div className="table-wrap"><table><thead><tr><th>ATIVIDADE / TÍTULO</th><th className="quantity-heading">QTD.</th><th aria-label="Ações"/></tr></thead><tbody>
            {filtered.map(item => <tr key={item.id}><td><div className="activity-name">{item.title}</div><button className="edit-link" onClick={() => editTitle(item.id)}>Editar nome</button></td><td><div className="quantity-control"><button onClick={() => changeCount(item.id, -1)} aria-label="Diminuir quantidade"><Minus size={13}/></button><strong>{item.count}</strong><button onClick={() => changeCount(item.id, 1)} aria-label="Aumentar quantidade"><Plus size={13}/></button></div></td><td><button className="delete-button" onClick={() => removeEntry(item.id)} aria-label="Excluir atividade"><Trash2 size={16}/></button></td></tr>)}
          </tbody></table>{filtered.length === 0 && <p className="no-results">Nenhuma atividade encontrada.</p>}</div>}
        {entries.length > 0 && <div className="protocol-footer"><span><CheckCircle2 size={15}/> {total} APRs contabilizadas</span><button onClick={resetProtocol}><RotateCcw size={14}/> NOVO PROTOCOLO</button></div>}
      </section>

      <section className="info-strip" onClick={() => setExpanded(!expanded)} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') setExpanded(!expanded) }}>
        <div><ShieldCheck size={19}/><span><strong>Seus dados ficam neste dispositivo</strong><small>O OCR funciona no aparelho; a imagem só é enviada à IA se você solicitar.</small></span></div>{expanded ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
      </section>
      {expanded && <p className="privacy-detail">O OCR comum e o protocolo funcionam neste aparelho. Se você tocar em “TENTAR RECONHECER COM IA”, a imagem será enviada ao serviço de IA da Vercel/Google para análise. Use essa opção apenas com documentos que você esteja autorizado a compartilhar. O título retornado deve ser conferido antes de entrar no protocolo.</p>}
      <footer><span>PROTOCOLO FAST</span><span>CONTROLE INTELIGENTE DE APR • v1.0</span></footer>
    </main>
  )
}

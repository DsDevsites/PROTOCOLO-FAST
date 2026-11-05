import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [entries, setEntries] = useState<Entry[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Entry[] } catch { return [] }
  })
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [recognizedText, setRecognizedText] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workerRef = useRef<OcrWorker | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)) }, [entries])

  // Attach the stream only after React has rendered the video element.
  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return
    const video = videoRef.current
    video.srcObject = streamRef.current
    video.muted = true
    video.playsInline = true
    void video.play().catch(() => {
      setCameraError('A câmera foi autorizada, mas o navegador não iniciou o vídeo. Feche a câmera e tente novamente.')
    })
    return () => {
      video.pause()
      video.srcObject = null
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

  async function recognize(source: Blob | string) {
    setBusy(true); setError(''); setProgress(0); setRecognizedText(''); setTitleDraft('')
    try {
      const worker = await getWorker()
      setStatus('Preparando imagem para localizar TAREFA…')

      // Enlarge and improve contrast so small printed letters are easier to read.
      const imageBlob = source instanceof Blob ? source : await (await fetch(source)).blob()
      const bitmap = await createImageBitmap(imageBlob)
      const scale = Math.max(2, Math.min(3, 1800 / bitmap.width))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('Não foi possível preparar a imagem.')
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        const gray = Math.min(255, Math.max(0, (pixels.data[i] * 0.299 + pixels.data[i + 1] * 0.587 + pixels.data[i + 2] * 0.114 - 128) * 1.35 + 128))
        pixels.data[i] = gray
        pixels.data[i + 1] = gray
        pixels.data[i + 2] = gray
      }
      ctx.putImageData(pixels, 0, 0)

      await worker.setParameters({ tessedit_pageseg_mode: '6' })
      setStatus('Localizando o campo TAREFA…')
      const result = await worker.recognize(canvas)
      const ocrLines = (result.data.lines || [])
        .map(line => line.text.trim())
        .filter(Boolean)
      const lines = ocrLines.length ? ocrLines : result.data.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

      // Never select an arbitrary long line: only accept text anchored to the TAREFA label.
      const taskLine = lines.find(line => {
        const normalized = line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
        return /T[A4]REF[A4]/.test(normalized)
      })
      if (!taskLine) {
        setRecognizedText('')
        setTitleDraft('')
        setError('Não encontrei o campo TAREFA nesta imagem. Envie uma foto que mostre a linha TAREFA: e o texto completo ao lado.')
        return
      }
      const normalizedLine = taskLine.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
      const labelMatch = normalizedLine.match(/T[A4]REF[A4]\s*:?/)
      const labelIndex = labelMatch?.index ?? -1
      let title = labelIndex >= 0 ? taskLine.slice(labelIndex + (labelMatch?.[0].length || 0)).replace(/^\s*[:;,.\-–—]+/, '').trim() : ''
      title = title.replace(/^TAREFA\s*/i, '').replace(/\s+/g, ' ').trim()

      if (title.length < 8) {
        setRecognizedText('')
        setTitleDraft('')
        setError('Encontrei TAREFA, mas não consegui ler o nome completo ao lado. Aproxime a câmera e tente novamente.')
        return
      }
      setRecognizedText(title)
      setTitleDraft(title)
      setStatus('Campo TAREFA localizado. Confira o texto antes de adicionar.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível reconhecer o texto. Tente novamente.')
    } finally { setBusy(false); setProgress(0) }
  }

  async function openCamera() {
    setCameraError('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Seu navegador não liberou acesso à câmera. Use a opção Enviar foto.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      streamRef.current = stream
      setCameraOpen(true)
    } catch {
      setCameraError('Não foi possível abrir a câmera. Verifique a permissão do navegador ou envie uma foto da galeria.')
    }
  }
  function closeCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOpen(false)
  }
  async function capturePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // Capture only the narrow central strip where the APR TAREFA row is aligned.
    const canvas = document.createElement('canvas')
    const bandHeight = Math.round(video.videoHeight * 0.22)
    const sourceY = Math.round((video.videoHeight - bandHeight) / 2)
    canvas.width = video.videoWidth
    canvas.height = bandHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, sourceY, video.videoWidth, bandHeight, 0, 0, canvas.width, canvas.height)
    closeCamera()
    canvas.toBlob(blob => { if (blob) void recognize(blob) }, 'image/jpeg', 0.96)
  }
  async function handleFile(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selecione uma imagem JPG, PNG ou WEBP.'); return }
    if (file.size > 15 * 1024 * 1024) { setError('A imagem deve ter no máximo 15 MB.'); return }
    await recognize(file)
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
    const sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'PROTOCOLO FAST'
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
    link.download = `PROTOCOLO-FAST-${new Date().toISOString().slice(0,10)}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="PROTOCOLO FAST início">
          <span className="brand-mark"><Zap size={22} fill="currentColor" /></span>
          <span><strong>PROTOCOLO<span> FAST</span></strong><small>LEITURA INTELIGENTE DE APR</small></span>
        </a>
        <div className="secure"><ShieldCheck size={15} /> PROCESSAMENTO LOCAL</div>
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
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={event => void handleFile(event.target.files?.[0])} />
        </div>
        {cameraError && <div className="notice error"><AlertCircle size={17}/>{cameraError}</div>}
        {cameraOpen && <div className="camera-panel">
          <div className="camera-head"><strong><Camera size={17}/> CÂMERA ATIVA</strong><button className="icon-button" onClick={closeCamera} aria-label="Fechar câmera"><X size={19}/></button></div>
          <div className="camera-view"><video ref={videoRef} autoPlay playsInline muted /><div className="scan-overlay"><div className="scan-window"><span>ALINHE A LINHA TAREFA AQUI</span></div></div></div>
          <p>Posicione a linha inteira que vem depois de TAREFA dentro da faixa central. O restante da foto será ignorado.</p>
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
        <div><ShieldCheck size={19}/><span><strong>Seus dados ficam neste dispositivo</strong><small>As imagens não são enviadas para um servidor.</small></span></div>{expanded ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
      </section>
      {expanded && <p className="privacy-detail">O reconhecimento de texto é feito no próprio navegador. O protocolo é salvo localmente neste aparelho. Para acessar os mesmos dados em outro dispositivo, será necessário exportar e importar uma planilha (sincronização em nuvem poderá ser adicionada em uma próxima etapa).</p>}
      <footer><span>PROTOCOLO FAST</span><span>CONTROLE INTELIGENTE DE APR • v1.0</span></footer>
    </main>
  )
}

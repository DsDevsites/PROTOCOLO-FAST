import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Camera, Check, Download, FileImage, FilePlus2, FileText, FolderOpen, ImagePlus, LoaderCircle, Merge, RotateCw, ScanLine, Split, Trash2, Upload, X } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'

type PageRecord = { id: string; name: string; blob: Blob; date: string; suggestedDate: string; dateStatus: 'pending' | 'confirmed' | 'unread'; createdAt: number; rotation: number; filter: 'color' | 'gray' | 'bw' }
type PdfRecord = { id: string; name: string; bytes: Uint8Array; pages: number }
const DB_NAME = 'nexo-operacional-scanner'
const STORE = 'pages'
const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'))
  })
}
async function savePage(page: PageRecord) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(page); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  db.close()
}
async function loadPages(): Promise<PageRecord[]> {
  const db = await openDb()
  const pages = await new Promise<PageRecord[]>((resolve, reject) => { const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result as PageRecord[]); request.onerror = () => reject(request.error) })
  db.close()
  return pages.sort((a,b) => a.createdAt-b.createdAt)
}
async function deletePage(id: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  db.close()
}
function dateISO(value: string): string | null {
  const match = value.match(/(^|\D)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(\D|$)/)
  if (!match) return null
  const day = Number(match[2]), month = Number(match[3]), rawYear = Number(match[4]), year = rawYear < 100 ? 2000 + rawYear : rawYear
  const date = new Date(year, month-1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month-1 || date.getDate() !== day) return null
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}
function formatDate(value: string) { if (!value) return 'Data não confirmada'; const [y,m,d]=value.split('-'); return `${d}/${m}/${y}` }
function fileFromBlob(blob: Blob, name: string) { return new File([blob], name, { type: 'application/pdf' }) }
function downloadBlob(blob: Blob, name: string) { const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),2000) }
async function imageBlobToJpeg(blob: Blob, rotation: number, filter: PageRecord['filter']): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob)
  const swap = rotation % 180 !== 0
  const canvas = document.createElement('canvas')
  canvas.width = swap ? bitmap.height : bitmap.width
  canvas.height = swap ? bitmap.width : bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Falha ao preparar a página.')
  ctx.translate(canvas.width/2, canvas.height/2); ctx.rotate(rotation*Math.PI/180)
  ctx.filter = filter === 'gray' ? 'grayscale(1)' : filter === 'bw' ? 'grayscale(1) contrast(2.1)' : 'none'
  ctx.drawImage(bitmap, -bitmap.width/2, -bitmap.height/2)
  bitmap.close()
  const result = await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Falha ao converter imagem.')),'image/jpeg',0.92))
  return new Uint8Array(await result.arrayBuffer())
}

export default function Scanner({ onBack }: { onBack: () => void }) {
  const [pages,setPages]=useState<PageRecord[]>([])
  const [thumbUrls,setThumbUrls]=useState<Record<string,string>>({})
  const [tab,setTab]=useState<'scan'|'library'|'merge'|'split'>('scan')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [camera,setCamera]=useState(false)
  const [pdfFiles,setPdfFiles]=useState<PdfRecord[]>([])
  const [splitFile,setSplitFile]=useState<PdfRecord|null>(null)
  const [range,setRange]=useState('1')
  const videoRef=useRef<HTMLVideoElement>(null)
  const streamRef=useRef<MediaStream|null>(null)
  const imageInput=useRef<HTMLInputElement>(null)
  const mergeInput=useRef<HTMLInputElement>(null)
  const splitInput=useRef<HTMLInputElement>(null)

  useEffect(()=>{ void loadPages().then(setPages).catch(()=>setError('Não foi possível carregar o arquivo local de digitalizações.')) },[])
  useEffect(()=>{const urls=Object.fromEntries(pages.map(page=>[page.id,URL.createObjectURL(page.blob)]));setThumbUrls(urls);return()=>Object.values(urls).forEach(URL.revokeObjectURL)},[pages])
  useEffect(()=>{
    if (!camera || !videoRef.current || !streamRef.current) return
    const video=videoRef.current; video.srcObject=streamRef.current; video.muted=true; video.playsInline=true
    void video.play().catch(()=>setError('O navegador não iniciou a câmera. Tente novamente ou importe uma foto.'))
    return ()=>{video.pause();video.srcObject=null}
  },[camera])
  useEffect(()=>()=>{streamRef.current?.getTracks().forEach(t=>t.stop())},[])

  const pending=pages.filter(p=>p.dateStatus!=='confirmed')
  const ordered=useMemo(()=>[...pages].sort((a,b)=>a.dateStatus==='confirmed'&&b.dateStatus==='confirmed'?a.date.localeCompare(b.date):a.dateStatus==='confirmed'?-1:b.dateStatus==='confirmed'?1:a.createdAt-b.createdAt),[pages])

  async function startCamera(){
    setError('')
    if(!navigator.mediaDevices?.getUserMedia){setError('Câmera indisponível neste navegador. Importe uma imagem.');return}
    try{streamRef.current=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});setCamera(true)}
    catch{setError('Não foi possível abrir a câmera. Verifique a permissão do navegador.')}
  }
  function stopCamera(){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setCamera(false)}
  async function addImageFiles(files: FileList|File[]){
    const list=Array.from(files).filter(f=>f.type.startsWith('image/'))
    if(!list.length){setError('Selecione arquivos de imagem válidos.');return}
    setBusy(true);setError('')
    try{
      for(const file of list){
        if(file.size>25*1024*1024){setError(`${file.name}: limite de 25 MB por imagem.`);continue}
        const page:PageRecord={id:makeId(),name:file.name||`Página ${pages.length+1}`,blob:file,date:'',suggestedDate:'',dateStatus:'pending',createdAt:Date.now()+pages.length,rotation:0,filter:'color'}
        await savePage(page);setPages(current=>[...current,page])
      }
      setMessage(`${list.length} imagem(ns) adicionada(s). Confirme as datas para organizar.`)
    }catch(e){setError(e instanceof Error?e.message:'Erro ao salvar as imagens.')}
    finally{setBusy(false)}
  }
  async function capture(){
    const video=videoRef.current;if(!video||!video.videoWidth)return
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight
    const ctx=canvas.getContext('2d');if(!ctx)return
    ctx.drawImage(video,0,0);const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/jpeg',0.94))
    if(blob){stopCamera();await addImageFiles([new File([blob],`scanner-${Date.now()}.jpg`,{type:'image/jpeg'})])}
  }
  async function suggestDate(page:PageRecord){
    setBusy(true);setMessage('Analisando a página para sugerir uma data…');setError('')
    try{
      const {createWorker}=await import('tesseract.js')
      const worker=await createWorker('por')
      const result=await worker.recognize(page.blob)
      await worker.terminate()
      const text=result.data.text
      const candidates=[...text.matchAll(/\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/g)].map(m=>m[0])
      const candidate=candidates.map(v=>({raw:v,iso:dateISO(v)})).find(v=>v.iso)
      const next={...page,suggestedDate:candidate?.iso??'',dateStatus:'pending' as const}
      await savePage(next);setPages(current=>current.map(p=>p.id===page.id?next:p))
      setMessage(candidate? `Sugestão encontrada: ${formatDate(candidate.iso!)}. Confira e confirme manualmente.` : 'DATA NÃO IDENTIFICADA — CONFIRMAÇÃO NECESSÁRIA. Digite a data manualmente.')
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível sugerir uma data.')}
    finally{setBusy(false)}
  }
  async function updatePage(page:PageRecord,patch:Partial<PageRecord>){
    const next={...page,...patch};await savePage(next);setPages(current=>current.map(p=>p.id===page.id?next:p))
  }
  async function removePage(page:PageRecord){
    if(!confirm(`Excluir definitivamente ${page.name} deste aparelho?`))return
    await deletePage(page.id);setPages(current=>current.filter(p=>p.id!==page.id))
  }
  async function makePdf(selected:PageRecord[],name:string){
    if(!selected.length){setError('Não há páginas selecionadas.');return}
    setBusy(true);setError('');setMessage('Montando PDF…')
    try{
      const pdf=await PDFDocument.create()
      for(const page of selected){
        const bytes=await imageBlobToJpeg(page.blob,page.rotation,page.filter)
        const image=await pdf.embedJpg(bytes)
        const a4w=595.28,a4h=841.89,scale=Math.min(a4w/image.width,a4h/image.height)
        const w=image.width*scale,h=image.height*scale
        const sheet=pdf.addPage([a4w,a4h]);sheet.drawImage(image,{x:(a4w-w)/2,y:(a4h-h)/2,width:w,height:h})
      }
      const bytes=await pdf.save();const blob=new Blob([bytes],{type:'application/pdf'});downloadBlob(blob,name)
      const file=fileFromBlob(blob,name)
      if(navigator.canShare?.({files:[file]})&&navigator.share){try{await navigator.share({files:[file],title:name})}catch{/* user cancelled */}}
      setMessage('PDF gerado. Você pode compartilhar pelo menu do aparelho.')
    }catch(e){setError(e instanceof Error?e.message:'Falha ao gerar PDF.')}
    finally{setBusy(false)}
  }
  async function readPdf(file:File):Promise<PdfRecord>{
    if(file.size>100*1024*1024)throw new Error('PDF acima de 100 MB.')
    const bytes=new Uint8Array(await file.arrayBuffer());const pdf=await PDFDocument.load(bytes)
    return {id:makeId(),name:file.name,bytes,pages:pdf.getPageCount()}
  }
  async function mergePdfs(){
    if(!pdfFiles.length){setError('Adicione pelo menos dois PDFs.');return}
    setBusy(true);setError('')
    try{const out=await PDFDocument.create();for(const record of pdfFiles){const src=await PDFDocument.load(record.bytes);const copied=await out.copyPages(src,src.getPageIndices());copied.forEach(p=>out.addPage(p))}
      const bytes=await out.save();downloadBlob(new Blob([bytes],{type:'application/pdf'}),`DOCUMENTOS-UNIDOS-${new Date().toISOString().slice(0,10)}.pdf`);setMessage('PDFs unidos com sucesso.')
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível unir os PDFs.')}
    finally{setBusy(false)}
  }
  async function splitPdf(){
    if(!splitFile){setError('Selecione um PDF para separar.');return}
    const parts=range.split(',').flatMap(part=>{const [a,b]=part.trim().split('-').map(Number);return Number.isFinite(b)?Array.from({length:Math.max(0,b-a+1)},(_,i)=>a+i):[a]})
    const indexes=[...new Set(parts.filter(n=>Number.isInteger(n)&&n>=1&&n<=splitFile.pages))].map(n=>n-1)
    if(!indexes.length){setError('Informe páginas válidas. Exemplo: 1, 3-5.');return}
    setBusy(true);setError('')
    try{const src=await PDFDocument.load(splitFile.bytes);const out=await PDFDocument.create();const copied=await out.copyPages(src,indexes);copied.forEach(p=>out.addPage(p));const bytes=await out.save();downloadBlob(new Blob([bytes],{type:'application/pdf'}),`PAGINAS-SELECIONADAS-${indexes[0]+1}-${indexes[indexes.length-1]+1}.pdf`);setMessage('Arquivo separado com sucesso. O original foi preservado.')}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível separar o PDF.')}finally{setBusy(false)}
  }
  function movePage(page:PageRecord,delta:number){
    const index=pages.findIndex(p=>p.id===page.id),target=index+delta;if(target<0||target>=pages.length)return
    const next=[...pages];[next[index],next[target]]=[next[target],next[index]]
    setPages(next);void Promise.all(next.map(savePage))
  }

  return <main className="app-shell scanner-app">
    <header className="topbar"><button className="back-button" onClick={onBack}><ArrowLeft size={16}/> VOLTAR À CENTRAL</button><div className="secure"><ScanLine size={15}/> NEXO SCANNER</div></header>
    <section className="hero scanner-hero"><div className="hero-copy"><div className="eyebrow"><span className="pulse"/> DIGITALIZAÇÃO E ARQUIVO</div><h1>Scanner de<br/><em>documentos.</em></h1><p>Digitalize o caderno de revezamento, revise as datas e organize seus PDFs em um só lugar.</p></div><div className="hero-stats"><div><span>Páginas salvas</span><strong>{pages.length.toString().padStart(2,'0')}</strong></div><div><span>Pendentes de data</span><strong>{pending.length.toString().padStart(2,'0')}</strong></div></div></section>
    <nav className="scanner-tabs">{([{id:'scan',label:'NOVA DIGITALIZAÇÃO',icon:Camera},{id:'library',label:'DOCUMENTOS',icon:FolderOpen},{id:'merge',label:'UNIR PDF',icon:Merge},{id:'split',label:'SEPARAR PDF',icon:Split}] as const).map(t=><button key={t.id} className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}><t.icon size={16}/>{t.label}</button>)}</nav>
    {error&&<div className="notice error">{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}
    {message&&<div className="notice success">{message}<button onClick={()=>setMessage('')}><X size={15}/></button></div>}
    {busy&&<div className="processing"><LoaderCircle className="spin"/><strong>Processando documento…</strong></div>}
    {tab==='scan'&&<section className="workspace"><div className="section-heading"><div><span className="step">01</span><div><h2>Adicionar páginas</h2><p>Use a câmera ou importe várias imagens.</p></div></div><span className="tag">ATÉ 25 MB / IMAGEM</span></div>
      <div className="scanner-actions"><button className="capture-card primary" onClick={()=>void startCamera()}><Camera/><strong>ABRIR CÂMERA</strong><small>Fotografar uma página</small></button><button className="capture-card" onClick={()=>imageInput.current?.click()}><ImagePlus/><strong>IMPORTAR IMAGENS</strong><small>Galeria ou arquivos • múltiplas páginas</small></button><input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={e=>{if(e.target.files)void addImageFiles(e.target.files);e.currentTarget.value=''}}/></div>
      {camera&&<div className="camera-panel"><div className="camera-head"><strong><Camera size={16}/> CÂMERA ATIVA</strong><button className="icon-button" onClick={stopCamera}><X/></button></div><video ref={videoRef} className="scanner-video" autoPlay playsInline muted/><p className="camera-tip">Mantenha a página inteira enquadrada, com boa iluminação e sem sombras.</p><button className="action-button full" onClick={()=>void capture()}><Camera size={17}/> CAPTURAR PÁGINA</button></div>}
      <div className="scanner-note"><FileText size={18}/><div><strong>Preservação do original</strong><p>As imagens ficam armazenadas localmente neste navegador. A data sugerida nunca é confirmada automaticamente.</p></div></div>
    </section>}
    {tab==='library'&&<section className="protocol"><div className="section-heading"><div><span className="step">02</span><div><h2>Documentos digitalizados</h2><p>Confirme as datas e organize em ordem cronológica.</p></div></div><span className="count-pill">{pages.length} PÁGINAS</span></div>
      {!ordered.length?<div className="empty-state"><span><FileImage/></span><strong>Nenhuma página digitalizada</strong><p>Comece adicionando imagens ou fotografando o caderno.</p></div>:<div className="scan-page-list">{ordered.map(page=><article className="scan-page-card" key={page.id}><div className="scan-thumb"><img src={thumbUrls[page.id] || ""} alt={page.name} style={{transform:"rotate("+page.rotation+"deg)",filter:page.filter==="gray"?"grayscale(1)":page.filter==="bw"?"grayscale(1) contrast(2.1)":"none"}}/></div><div className="scan-page-info"><strong>{page.name}</strong><label>DATA DO REGISTRO</label><input type="date" value={page.date||page.suggestedDate} onChange={e=>void updatePage(page,{date:e.target.value,dateStatus:'pending'})}/><div className="scan-status">{page.dateStatus==='confirmed'?'DATA CONFIRMADA':'CONFIRMAÇÃO NECESSÁRIA'}</div><label>TRATAMENTO DA IMAGEM</label><select className="scan-filter" value={page.filter} onChange={e=>void updatePage(page,{filter:e.target.value as PageRecord['filter']})}><option value="color">Colorido</option><option value="gray">Escala de cinza</option><option value="bw">Preto e branco</option></select><div className="scan-row-actions"><button className="secondary-button" disabled={busy} onClick={()=>void suggestDate(page)}>SUGERIR DATA (OCR)</button><button className="action-button" disabled={!page.date} onClick={()=>void updatePage(page,{dateStatus:'confirmed'})}><Check size={14}/> CONFIRMAR</button></div></div><div className="scan-tools"><button title="Girar" onClick={()=>void updatePage(page,{rotation:(page.rotation+90)%360})}><RotateCw size={15}/></button><button title="Mover para cima" onClick={()=>movePage(page,-1)}><ArrowUp size={15}/></button><button title="Mover para baixo" onClick={()=>movePage(page,1)}><ArrowDown size={15}/></button><button title="Baixar PDF desta página" onClick={()=>void makePdf([page],`REVEZAMENTO-${page.date||'SEM-DATA'}.pdf`)}><Download size={15}/></button><button title="Excluir" onClick={()=>void removePage(page)}><Trash2 size={15}/></button></div></article>)}</div>}
      {!!pages.length&&<div className="card-actions"><span>{pages.filter(p=>p.dateStatus==='confirmed').length} datas confirmadas</span><button className="action-button" disabled={busy} onClick={()=>void makePdf(ordered,`CADERNO-REVEZAMENTO-${new Date().toISOString().slice(0,10)}.pdf`)}><Download size={16}/> EXPORTAR TODAS EM PDF</button></div>}
    </section>}
    {tab==='merge'&&<section className="workspace"><div className="section-heading"><div><span className="step">03</span><div><h2>Unir documentos PDF</h2><p>Adicione arquivos e organize a ordem antes de juntar.</p></div></div></div><button className="action-button" onClick={()=>mergeInput.current?.click()}><FilePlus2 size={17}/> ADICIONAR PDFs</button><input ref={mergeInput} hidden type="file" accept="application/pdf,.pdf" multiple onChange={async e=>{if(e.target.files){try{const records=await Promise.all(Array.from(e.target.files).map(readPdf));setPdfFiles(v=>[...v,...records]);setError('')}catch(err){setError(err instanceof Error?err.message:'PDF inválido')}e.currentTarget.value=''}}}/><div className="pdf-list">{pdfFiles.map((f,i)=><div key={f.id}><FileText size={18}/><span>{f.name}<small>{f.pages} páginas</small></span><button onClick={()=>setPdfFiles(v=>v.filter(x=>x.id!==f.id))}><Trash2 size={15}/></button><button disabled={i===0} onClick={()=>setPdfFiles(v=>{const a=[...v];[a[i-1],a[i]]=[a[i],a[i-1]];return a})}><ArrowUp size={15}/></button><button disabled={i===pdfFiles.length-1} onClick={()=>setPdfFiles(v=>{const a=[...v];[a[i+1],a[i]]=[a[i],a[i+1]];return a})}><ArrowDown size={15}/></button></div>)}</div><button className="action-button full" disabled={pdfFiles.length<2||busy} onClick={()=>void mergePdfs()}><Merge size={17}/> UNIR PDFs</button></section>}
    {tab==='split'&&<section className="workspace"><div className="section-heading"><div><span className="step">04</span><div><h2>Separar PDF</h2><p>Extraia páginas específicas sem alterar o original.</p></div></div></div><button className="action-button" onClick={()=>splitInput.current?.click()}><Upload size={17}/> ESCOLHER PDF</button><input ref={splitInput} hidden type="file" accept="application/pdf,.pdf" onChange={async e=>{const file=e.target.files?.[0];if(file){try{setSplitFile(await readPdf(file));setError('')}catch(err){setError(err instanceof Error?err.message:'PDF inválido')}}e.currentTarget.value=''}}/>{splitFile&&<div className="split-panel"><strong>{splitFile.name}</strong><p>{splitFile.pages} páginas disponíveis.</p><label>Informe páginas e intervalos (ex.: 1, 3-5, 8)</label><input className="title-input" value={range} onChange={e=>setRange(e.target.value)}/><button className="action-button full" onClick={()=>void splitPdf()} disabled={busy}><Split size={16}/> GERAR PDF SEPARADO</button></div>}</section>}
    <footer><span>NEXO OPERACIONAL</span><span>SCANNER • ARQUIVOS LOCAIS</span></footer>
  </main>
}

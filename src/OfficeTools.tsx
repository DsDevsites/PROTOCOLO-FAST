import { useRef, useState } from 'react'
import { ArrowLeft, FileText, FileSpreadsheet, Presentation, ImagePlus, FileImage, Download, Upload, Printer, LoaderCircle } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist'
import './OfficeTools.css'

type SheetPreview = { name: string; rows: string[][] }

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function printHtml(html: string, title: string) {
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('Permita janelas pop-up para gerar a visualização de impressão.')
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title><style>
    body{font:14px Arial,sans-serif;color:#222;margin:28px;line-height:1.45}h1,h2,h3{break-after:avoid}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #aaa;padding:6px;text-align:left}img{max-width:100%}pre{white-space:pre-wrap;word-break:break-word}@media print{body{margin:15mm}}
  </style></head><body>${html}<script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`)
  popup.document.close()
}

export default function OfficeTools({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [sheets, setSheets] = useState<SheetPreview[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [docText, setDocText] = useState('')
  const [docLabel, setDocLabel] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file?: File) {
    if (!file) return
    setBusy(true); setStatus('Lendo arquivo…'); setSheets([]); setDocText('')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (file.type.startsWith('image/')) {
        const bytes = await file.arrayBuffer()
        const pdf = await PDFDocument.create()
        const image = ext === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
        const page = pdf.addPage([image.width, image.height])
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
        saveBlob(new Blob([await pdf.save()], { type: 'application/pdf' }), file.name.replace(/\.[^.]+$/, '') + '.pdf')
        setStatus('Imagem convertida em PDF.')
      } else if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') {
        const ExcelJS = (await import('exceljs')).default
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(await file.arrayBuffer())
        const preview = workbook.worksheets.map(sheet => {
          const rows: string[][] = []
          sheet.eachRow({ includeEmpty: false }, row => rows.push(row.values.slice(1).map(value => {
            if (value && typeof value === 'object' && 'text' in value) return String(value.text)
            if (value && typeof value === 'object' && 'result' in value) return String(value.result ?? '')
            return value == null ? '' : String(value)
          })))
          return { name: sheet.name, rows }
        })
        setSheets(preview); setActiveSheet(0); setDocLabel(file.name)
        setStatus('Planilha carregada. Escolha uma aba, baixe CSV ou use imprimir para salvar em PDF.')
      } else if (ext === 'docx') {
        const mammoth = await import('mammoth')
        const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
        setDocText(result.value); setDocLabel(file.name)
        setStatus('Documento Word convertido para visualização HTML. A exportação em PDF usa a impressão do navegador.')
      } else if (ext === 'pptx') {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(file)
        const slideFiles = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]))
        const slides: string[] = []
        for (let i=0;i<slideFiles.length;i++) {
          const xml = await zip.file(slideFiles[i])!.async('text')
          const parsed = new DOMParser().parseFromString(xml, 'application/xml')
          const texts = Array.from(parsed.getElementsByTagName('a:t')).map(node => node.textContent || '').filter(Boolean)
          slides.push(`<section class="slide"><h2>Slide ${i+1}</h2><p>${texts.map(escapeHtml).join('<br>')}</p></section>`)
        }
        if (!slides.length) throw new Error('Não encontrei slides legíveis neste arquivo.')
        setDocText(slides.join('')); setDocLabel(file.name)
        setStatus('Texto dos slides extraído. A visualização para PDF preserva o conteúdo textual, não o design original.')
      } else if (ext === 'pdf') {
        const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
        for (let index=1; index<=pdf.numPages; index++) {
          setStatus(`Convertendo página ${index} de ${pdf.numPages} em imagem…`)
          const page = await pdf.getPage(index)
          const viewport = page.getViewport({ scale: 1.6 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Não foi possível criar a imagem da página.')
          await page.render({ canvasContext: context, viewport }).promise
          const blob = await new Promise<Blob>((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Falha ao gerar PNG.')), 'image/png'))
          saveBlob(blob, `${file.name.replace(/\.pdf$/i,'')}-pagina-${String(index).padStart(3,'0')}.png`)
          canvas.width=0; canvas.height=0
        }
        setStatus(`${pdf.numPages} página(s) convertida(s) em PNG. Os arquivos foram baixados individualmente.`)
      } else {
        throw new Error('Formato não suportado. Use PDF, DOCX, XLSX, XLSM, PPTX, JPG ou PNG.')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível processar o arquivo.')
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  function exportCsv() {
    const sheet = sheets[activeSheet]
    if (!sheet) return
    const csv = sheet.rows.map(row => row.map(value => '"' + value.replace(/"/g, '""') + '"').join(';')).join('\r\n')
    saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), sheet.name + '.csv')
  }
  function printSheet() {
    const sheet = sheets[activeSheet]
    if (!sheet) return
    const table = '<table>' + sheet.rows.map((row,index) => '<tr>' + row.map(cell => index===0 ? '<th>'+escapeHtml(cell)+'</th>' : '<td>'+escapeHtml(cell)+'</td>').join('') + '</tr>').join('') + '</table>'
    printHtml('<h1>'+escapeHtml(sheet.name)+'</h1>'+table, sheet.name)
  }
  function printDocument() {
    if (!docText) return
    printHtml(docText, docLabel || 'Documento')
  }

  return <main className="app-shell office-shell">
    <header className="topbar"><button className="back-button" onClick={onBack}><ArrowLeft size={15}/> VOLTAR AO NEXO</button><div className="brand"><span className="brand-mark">N</span><span><strong>NEXO<span> OPERACIONAL</span></strong><small>CONVERSOR DE DOCUMENTOS</small></span></div><span className="secure">PROCESSAMENTO NO NAVEGADOR</span></header>
    <section className="pdf-heading"><div className="eyebrow"><span className="pulse"/> CENTRAL DE CONVERSÃO</div><h1>Seus arquivos.<br/><em>Em outro formato.</em></h1><p>Trabalhe com Word, Excel, PowerPoint, PDF e imagens em uma área independente.</p></section>
    <section className="office-upload">
      <div className="office-formats">
        <span><FileText/> WORD</span><span><FileSpreadsheet/> EXCEL</span><span><Presentation/> POWERPOINT</span><span><FileImage/> PDF / IMAGEM</span>
      </div>
      <input ref={fileRef} hidden type="file" accept=".pdf,.docx,.xlsx,.xlsm,.pptx,.jpg,.jpeg,.png" onChange={event=>void handleFile(event.target.files?.[0])}/>
      <button className="action-button" disabled={busy} onClick={()=>fileRef.current?.click()}>{busy?<LoaderCircle className="spin"/>:<Upload size={17}/>} SELECIONAR ARQUIVO</button>
      <p className="office-hint">Formatos: PDF, DOCX, XLSX, XLSM, PPTX, JPG e PNG.</p>
    </section>
    {status && <div className="notice success">{status}</div>}
    {sheets.length>0 && <section className="office-result">
      <div className="office-result-head"><div><strong>{docLabel}</strong><small>{sheets.length} aba(s) encontrada(s)</small></div><div className="office-actions"><button onClick={exportCsv}><Download size={15}/> BAIXAR CSV</button><button onClick={printSheet}><Printer size={15}/> IMPRIMIR / PDF</button></div></div>
      <div className="office-tabs">{sheets.map((sheet,index)=><button className={activeSheet===index?'active':''} key={sheet.name} onClick={()=>setActiveSheet(index)}>{sheet.name}</button>)}</div>
      <div className="office-table-wrap"><table><tbody>{sheets[activeSheet]?.rows.slice(0,250).map((row,index)=><tr key={index}>{row.slice(0,20).map((cell,col)=><td key={col}>{cell}</td>)}</tr>)}</tbody></table></div>
      <small className="office-hint">Prévia limitada às primeiras 250 linhas e 20 colunas. A planilha original não é alterada.</small>
    </section>}
    {docText && <section className="office-result">
      <div className="office-result-head"><div><strong>{docLabel}</strong><small>Pré-visualização do conteúdo extraído</small></div><button onClick={printDocument}><Printer size={15}/> IMPRIMIR / SALVAR PDF</button></div>
      <article className="office-document" dangerouslySetInnerHTML={{__html:docText}}/>
    </section>}
    <section className="office-notes"><strong>O que cada conversão faz</strong><ul>
      <li>JPG/PNG → PDF: cria um PDF com a imagem selecionada.</li>
      <li>PDF → PNG: baixa cada página como imagem separada.</li>
      <li>Excel: visualiza abas, exporta a aba ativa em CSV e permite imprimir/salvar em PDF.</li>
      <li>Word: extrai e apresenta o conteúdo DOCX para imprimir/salvar em PDF.</li>
      <li>PowerPoint: extrai o texto dos slides para imprimir/salvar em PDF; não reproduz o layout original.</li>
    </ul><p>Arquivos são processados localmente no navegador. A impressão em PDF depende da opção “Salvar como PDF” do navegador ou sistema operacional.</p></section>
    <footer><span>NEXO OPERACIONAL</span><span>CONVERSOR DE DOCUMENTOS • MÓDULO INDEPENDENTE</span></footer>
  </main>
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] || char))
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ClipboardPaste, FileImage, ImagePlus, Printer, Trash2, UploadCloud, X } from 'lucide-react'

type CardImage = { id: string; src: string; name: string }

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler a imagem.'))
    reader.onerror = () => reject(new Error('Falha ao abrir a imagem selecionada.'))
    reader.readAsDataURL(file)
  })
}

export default function CardPrint({ onBack }: { onBack: () => void }) {
  const [cards, setCards] = useState<CardImage[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const images = Array.from(files).filter(file => file.type.startsWith('image/'))
    if (!images.length) { setError('Selecione ou cole uma imagem PNG, JPG ou WEBP.'); return }
    const remaining = 120 - cards.length
    if (remaining <= 0) { setError('Limite de 120 carteirinhas por montagem atingido. Gere o PDF e inicie outra montagem.'); return }
    try {
      const accepted = images.slice(0, remaining)
      const loaded = await Promise.all(accepted.map(async file => ({ id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, src: await readImage(file), name: file.name || 'Carteirinha colada' })))
      setCards(current => [...current, ...loaded])
      setError(images.length > remaining ? 'Foram adicionadas somente as primeiras imagens que cabiam no limite desta montagem.' : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível adicionar as imagens.')
    }
  }, [cards.length])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (files.length) {
        event.preventDefault()
        void addFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const pages = Array.from({ length: Math.ceil(cards.length / 6) }, (_, index) => cards.slice(index * 6, index * 6 + 6))
  const removeCard = (id: string) => setCards(current => current.filter(card => card.id !== id))

  return (
    <main className="app-shell card-app">
      <header className="topbar">
        <button className="back-button" onClick={onBack}><ArrowLeft size={17}/> VOLTAR AOS SISTEMAS</button>
        <div className="secure"><FileImage size={15}/> MONTAGEM A4</div>
      </header>
      <section className="hero card-hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse"/> IMPRESSÃO ORGANIZADA</div>
          <h1>Carteirinhas.<br/><em>Prontas para imprimir.</em></h1>
          <p>Adicione os prints das carteirinhas. Organizamos automaticamente seis por folha A4, sem cortar nem editar o conteúdo das imagens.</p>
        </div>
        <div className="hero-stats"><div><span>Carteirinhas adicionadas</span><strong>{cards.length.toString().padStart(2, '0')}</strong></div><div><span>Folhas A4 necessárias</span><strong>{pages.length.toString().padStart(2, '0')}</strong></div></div>
      </section>

      <section className="workspace">
        <div className="section-heading"><div><span className="step">01</span><div><h2>Adicionar carteirinhas</h2><p>Envie imagens ou cole um print copiado.</p></div></div><span className="tag">ATÉ 6 POR FOLHA</span></div>
        <div className={`card-dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void addFiles(event.dataTransfer.files) }}>
          <span className="drop-icon"><UploadCloud size={27}/></span>
          <strong>Arraste as imagens para cá</strong>
          <small>Ou escolha da galeria / arquivos. Também pode usar Ctrl + V para colar um print copiado.</small>
          <div className="drop-actions">
            <button className="action-button" onClick={() => fileRef.current?.click()}><ImagePlus size={17}/> ESCOLHER IMAGENS</button>
            <span className="paste-hint"><ClipboardPaste size={15}/> CTRL + V / COLAR</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={event => { if (event.target.files) void addFiles(event.target.files); event.currentTarget.value = '' }}/>
        </div>
        {error && <div className="notice error">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
      </section>

      <section className="protocol">
        <div className="section-heading"><div><span className="step">02</span><div><h2>Prévia da montagem</h2><p>As imagens são encaixadas sem cortes e sem alterar o print original.</p></div></div><span className="count-pill">{cards.length} IMAGENS</span></div>
        {!cards.length ? <div className="empty-state"><span><FileImage size={30}/></span><strong>Nenhuma carteirinha adicionada</strong><p>Adicione os prints para montar as folhas A4.</p></div> :
          <>
            <div className="card-preview-grid">{cards.map((card, index) => <article className="card-preview" key={card.id}><div className="preview-image"><img src={card.src} alt={card.name}/></div><div className="preview-meta"><span>CARTEIRINHA {index + 1}</span><button onClick={() => removeCard(card.id)} aria-label="Remover carteirinha"><Trash2 size={15}/></button></div></article>)}</div>
            <div className="card-actions"><span>{pages.length} {pages.length === 1 ? 'folha A4' : 'folhas A4'} • {cards.length % 6 || (cards.length ? 6 : 0)} na última folha</span><div><button className="secondary-button" onClick={() => { if (window.confirm('Remover todas as imagens desta montagem?')) setCards([]) }}>LIMPAR TUDO</button><button className="action-button" onClick={() => window.print()}><Printer size={17}/> GERAR PDF / IMPRIMIR</button></div></div>
          </>
        }
      </section>

      <div className="print-document" aria-hidden="true">
        {pages.map((page, pageIndex) => <section className="print-page" key={pageIndex}>
          <div className="print-grid">{page.map(card => <div className="print-card" key={card.id}><img src={card.src} alt=""/></div>)}</div>
        </section>)}
      </div>
      <footer><span>CARTEIRINHAS</span><span>FOLHA A4 • 2 COLUNAS × 3 LINHAS</span></footer>
    </main>
  )
}

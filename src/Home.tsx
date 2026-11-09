import { ArrowRight, FileImage, FileText, ScanLine, ShieldCheck, Zap, Files } from 'lucide-react'

export default function Home({ onSelect }: { onSelect: (module: 'protocol' | 'cards' | 'scanner' | 'pdf' | 'office') => void }) {
  return <main className="app-shell home-shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="NEXO Operacional início"><span className="brand-mark"><Zap size={22} fill="currentColor"/></span><span><strong>NEXO<span> OPERACIONAL</span></strong><small>CENTRAL INTELIGENTE DE FERRAMENTAS</small></span></a>
      <div className="secure"><ShieldCheck size={15}/> AMBIENTE DE TRABALHO</div>
    </header>
    <section className="home-hero">
      <div className="eyebrow"><span className="pulse"/> CENTRAL DE FERRAMENTAS</div>
      <h1>NEXO<br/><em>Operacional.</em></h1>
      <p>Central inteligente de ferramentas operacionais. Escolha uma solução para organizar, digitalizar e processar seus documentos.</p>
    </section>
    <section className="module-grid">
      <button className="module-card module-fast" onClick={() => onSelect('protocol')}>
        <span className="module-icon"><Zap size={28}/></span><span className="module-kicker">01 / CONTROLE DE APR</span><strong>PROTOCOLO FAST</strong><p>Leia títulos de APR, agrupe atividades repetidas e gere seu protocolo consolidado.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span>
      </button>
      <button className="module-card module-cards" onClick={() => onSelect('cards')}>
        <span className="module-icon"><FileImage size={28}/></span><span className="module-kicker">02 / DOCUMENTOS</span><strong>CARTEIRINHAS</strong><p>Organize prints em folhas A4 com seis carteirinhas por página e gere um PDF pronto para impressão.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span>
      </button>
      <button className="module-card module-scanner" onClick={() => onSelect('scanner')}>
        <span className="module-icon"><ScanLine size={28}/></span><span className="module-kicker">03 / DIGITALIZAÇÃO</span><strong>SCANNER DE DOCUMENTOS</strong><p>Digitalize páginas do caderno de revezamento, revise datas, organize documentos e gerencie PDFs.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span>
      </button>
      <button className="module-card module-office" onClick={() => onSelect("office")}><span className="module-icon"><Files size={28}/></span><span className="module-kicker">05 / CONVERSÃO</span><strong>WORD • EXCEL • POWERPOINT</strong><p>Visualize planilhas, extraia conteúdo de documentos e converta imagens e PDFs.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span></button>
      <button className="module-card module-pdf" onClick={() => onSelect('pdf')}><span className="module-icon"><FileText size={28}/></span><span className="module-kicker">04 / DOCUMENTOS</span><strong>ORGANIZADOR DE PDF</strong><p>Una, organize, anote, assine e adicione elementos aos seus documentos PDF.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span></button>
    </section>
    <footer><span>NEXO OPERACIONAL</span><span>CINCO FERRAMENTAS • UM ÚNICO ENDEREÇO</span></footer>
  </main>
}

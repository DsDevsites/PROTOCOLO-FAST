import { ArrowRight, ClipboardList, FileImage, ShieldCheck, Zap } from 'lucide-react'

export default function Home({ onSelect }: { onSelect: (module: 'protocol' | 'cards') => void }) {
  return <main className="app-shell home-shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="PROTOCOLO FAST início"><span className="brand-mark"><Zap size={22} fill="currentColor"/></span><span><strong>PROTOCOLO<span> FAST</span></strong><small>FERRAMENTAS OPERACIONAIS</small></span></a>
      <div className="secure"><ShieldCheck size={15}/> AMBIENTE DE TRABALHO</div>
    </header>
    <section className="home-hero">
      <div className="eyebrow"><span className="pulse"/> CENTRAL DE FERRAMENTAS</div>
      <h1>O que vamos<br/><em>organizar hoje?</em></h1>
      <p>Escolha uma ferramenta para continuar. Cada sistema tem seu próprio espaço e suas funções independentes.</p>
    </section>
    <section className="module-grid">
      <button className="module-card module-fast" onClick={() => onSelect('protocol')}>
        <span className="module-icon"><Zap size={28}/></span><span className="module-kicker">01 / CONTROLE DE APR</span><strong>PROTOCOLO FAST</strong><p>Leia títulos de APR, agrupe atividades repetidas e gere seu protocolo consolidado.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span>
      </button>
      <button className="module-card module-cards" onClick={() => onSelect('cards')}>
        <span className="module-icon"><FileImage size={28}/></span><span className="module-kicker">02 / DOCUMENTOS</span><strong>CARTEIRINHAS</strong><p>Organize prints em folhas A4 com seis carteirinhas por página e gere um PDF pronto para impressão.</p><span className="module-link">ABRIR SISTEMA <ArrowRight size={17}/></span>
      </button>
    </section>
    <footer><span>PROTOCOLO FAST</span><span>DUAS FERRAMENTAS • UM ÚNICO ENDEREÇO</span></footer>
  </main>
}

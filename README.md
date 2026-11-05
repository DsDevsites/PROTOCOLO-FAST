# PROTOCOLO FAST

Aplicação web para fotografar títulos de APR, reconhecer texto em português no próprio navegador, consolidar títulos repetidos e exportar o protocolo em Excel.

## Tecnologias
- React + TypeScript + Vite
- Tesseract.js (OCR local no navegador)
- SheetJS (exportação .xlsx)
- Persistência local no navegador (sem backend nesta primeira versão)

## Executar localmente
```bash
npm install
npm run dev
```

## Publicar na Vercel
Importe este repositório na Vercel. Framework: Vite; Build command: `npm run build`; Output directory: `dist`. Não são necessárias variáveis de ambiente.

## Observação
O OCR pode interpretar caracteres incorretamente dependendo da foto. Cada título reconhecido fica editável e precisa ser confirmado antes de entrar na contagem. Os dados desta versão ficam no navegador/dispositivo utilizado; não há sincronização entre aparelhos.

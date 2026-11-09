export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Método não permitido.' })
  }

  try {
    const image = req.body?.image
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WEBP válida.' })
    }
    if (image.length > 4_000_000) {
      return res.status(413).json({ error: 'Imagem muito grande para análise. Tente uma foto mais leve.' })
    }

    const env = (globalThis as any).process?.env ?? {}
    const apiKey = env.AI_GATEWAY_API_KEY
    if (!apiKey) {
      return res.status(503).json({
        error: 'A IA ainda não está conectada. Falta cadastrar AI_GATEWAY_API_KEY nas variáveis de ambiente da Vercel.',
      })
    }

    const upstream = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash',
        temperature: 0.1,
        max_tokens: 350,
        messages: [
          {
            role: 'system',
            content: 'Você é um extrator especializado em formulários brasileiros de APR (Análise Preliminar de Risco). Sua única tarefa é localizar e transcrever o TÍTULO/NOME DA ATIVIDADE que está DIGITADO/IMPRESSO no documento. Não use nomes de colaboradores, datas, empresa, setor, local, assinaturas ou texto manuscrito como título. Procure primeiro campos identificados como TAREFA, NOME DA APR, TÍTULO DA APR, ATIVIDADE ou DESCRIÇÃO DA ATIVIDADE. Preserve as palavras e a ordem original; corrija apenas erros visuais óbvios de leitura, nunca invente palavras. Se não houver título legível, retorne title vazio. Responda SOMENTE JSON válido no formato {"title":"...","confidence":0.0,"reason":"..."}; confidence deve ser número entre 0 e 1.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Leia a imagem anexada e extraia somente o título digitado da APR. Examine com atenção o cabeçalho e os campos de identificação. Não confunda rótulos impressos com o valor preenchido.' },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    })

    const payload = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      const message = payload?.error?.message || payload?.message || 'O serviço de IA recusou a solicitação.'
      return res.status(upstream.status === 429 ? 429 : 502).json({ error: message })
    }

    const raw = payload?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((part: any) => part?.text || '').join('\n') : ''
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0]
    if (!jsonText) return res.status(502).json({ error: 'A IA não retornou um resultado estruturado. Tente novamente.' })

    const parsed = JSON.parse(jsonText)
    const title = typeof parsed.title === 'string' ? parsed.title.replace(/\s+/g, ' ').trim().slice(0, 180) : ''
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    return res.status(200).json({ title, confidence, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : '' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado ao analisar a APR.'
    return res.status(500).json({ error: message })
  }
}

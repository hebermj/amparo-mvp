/**
 * LLM Gateway — processa a mensagem do usuário chamando DeepSeek / Claude / OpenAI / OpenCode Zen.
 *
 * Prioridade da lista abaixo (fallback automático se um falhar).
 */

const PROVIDERS = [];

// ── DeepSeek ──────────────────────────────────────────────────────
if (process.env.DEEPSEEK_API_KEY) {
  PROVIDERS.push({
    name: 'deepseek',
    apiKey: process.env.DEEPSEEK_API_KEY,
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  });
}

// ── Claude (Anthropic) ────────────────────────────────────────────
if (process.env.CLAUDE_API_KEY) {
  PROVIDERS.push({
    name: 'claude',
    apiKey: process.env.CLAUDE_API_KEY,
    url: 'https://api.anthropic.com/v1/messages',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    anthropic: true,
  });
}

// ── OpenAI ────────────────────────────────────────────────────────
if (process.env.OPENAI_API_KEY) {
  PROVIDERS.push({
    name: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  });
}

// ── OpenCode Zen API (compatível com OpenAI) ─────────────────────
if (process.env.OPENCODE_ZEN_API_KEY) {
  PROVIDERS.push({
    name: 'opencode-zen',
    apiKey: process.env.OPENCODE_ZEN_API_KEY,
    url: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1/chat/completions',
    model: process.env.OPENCODE_ZEN_MODEL || 'deepseek-v4-flash-free',
  });
}

const SYSTEM_PROMPT = `Você é o Amparo, um assistente de compras amigável e paciente especializado em ajudar pessoas idosas a encontrar produtos online.

REGRAS:
- Seja educado, claro e use linguagem simples.
- Quando o usuário pedir um produto, sugira marcas, faixas de preço e onde encontrar.
- Se perguntar preços, dê estimativas realistas do mercado brasileiro (BRL).
- NUNCA peça dados de cartão de crédito, CPF completo ou senhas.
- Se o usuário estiver confuso, ofereça ajuda com passo a passo.
- Responda sempre em português brasileiro.
- Mantenha respostas curtas e diretas (máximo 3 parágrafos).
- Se não souber responder algo, sugira buscar na internet.`;

/**
 * Chama um provedor LLM e retorna a resposta.
 */
async function callProvider(provider, messages) {
  if (provider.anthropic) {
    // API da Anthropic (formato diferente)
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsgs = messages.filter((m) => m.role !== 'system');

    const body = {
      model: provider.model,
      system: systemMsg?.content || SYSTEM_PROMPT,
      messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 1024,
    };

    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Claude API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || '❌ Sem resposta da IA.';

  } else {
    // API compatível com OpenAI (DeepSeek, OpenAI, etc.)
    const body = {
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 1024,
      temperature: 0.7,
    };

    const res = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Se for rate limit (429), joga erro específico para retentar
      if (res.status === 429) {
        throw new Error(`RATE_LIMIT: ${provider.name} - ${errText}`);
      }
      throw new Error(`${provider.name} API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;

    // Se o conteúdo veio vazio, tenta novamente
    if (!content || content.trim() === '') {
      console.warn(`[${provider.name}] Resposta vazia, re-tentando...`);
      // Só retenta uma vez
      const retryRes = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        const retryContent = retryData.choices?.[0]?.message?.content;
        if (retryContent && retryContent.trim() !== '') {
          return retryContent;
        }
      }
    }

    return content || '❌ Sem resposta da IA.';
  }
}

/**
 * Processa a mensagem do usuário com a LLM.
 *
 * @param {string} userMessage - Texto enviado pelo usuário
 * @param {object} session - Sessão do chat { history: Array }
 * @param {number|string} chatId - ID do chat no Telegram
 * @returns {Promise<string>} Resposta para o usuário
 */
async function processWithLLM(userMessage, session, chatId) {
  // Se não tem nenhuma chave configurada, retorna resposta simulada
  if (PROVIDERS.length === 0) {
    return (
      `Olá! 😊\n\n` +
      `Para eu funcionar, preciso de uma chave de IA configurada.\n\n` +
      `Peça ao desenvolvedor para definir uma destas variáveis no Vercel:\n` +
      `- DEEPSEEK_API_KEY (recomendado)\n` +
      `- CLAUDE_API_KEY\n` +
      `- OPENAI_API_KEY\n\n` +
      `Enquanto isso, uma dica:\n` +
      `"${userMessage.substring(0, 100)}" voce pode encontrar no Buscape (buscape.com.br) ou Mercado Livre (mercadolivre.com.br).`
    );
  }

  // Constrói o histórico + mensagem atual
  const messages = [
    ...session.history.slice(-4).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // Tenta cada provedor em ordem, com fallback
  let lastError = null;
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    for (const provider of PROVIDERS) {
      try {
        const reply = await callProvider(provider, messages);

        // Atualiza histórico da sessão
        session.history.push({ role: 'user', content: userMessage });
        session.history.push({ role: 'assistant', content: reply });

        // Mantém só os últimos 6
        if (session.history.length > 6) {
          session.history = session.history.slice(-6);
        }

        return reply;
      } catch (err) {
        console.error(`[${provider.name} ERROR]`, err.message);
        lastError = err;
        // Tenta próximo provedor
      }
    }

    // Se chegou aqui, todos falharam nesta tentativa
    // Se foi rate limit, espera e tenta de novo
    if (attempts < maxAttempts && lastError?.message?.includes('RATE_LIMIT')) {
      console.warn(`[RETRY] Rate limit atingido, aguardando 2s e tentando novamente...`);
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      break; // Não vale a pena retentar se não foi rate limit
    }
  }

  // Todos falharam
  return (
    `❌ Desculpe, não consegui processar sua mensagem agora.\n\n` +
    `Erro: ${lastError?.message || 'Provedor indisponível'}\n\n` +
    `Tente novamente mais tarde!`
  );
}

module.exports = { processWithLLM };

# Amparo MVP v2

Assistente inteligente para compras online de pessoas idosas — via **WhatsApp** ou **Telegram**.

## Duas Versões

O Amparo pode funcionar com **WhatsApp** (API oficial Business) **ou Telegram** (bot gratuito). O pipeline interno (IA, busca, orquestração) é **100% compartilhado** — só muda a camada de entrada/saída.

| Canal | Custo | Conta Necessária | Ideal Para |
|-------|-------|------------------|------------|
| **WhatsApp** (Business API) | Pago por conversa | Conta Business verificada | Produção |
| **WhatsApp** (Baileys) | Grátis | Número pessoal | Testes/POC |
| **Telegram** (Bot) | **100% grátis** | Só o @BotFather | Testes/POC/Produção pequena |

---

## Arquitetura

```
                    ┌─────────────────────────────────────────────────────┐
                    │              PIPELINE INTERNO (compartilhado)        │
                    │                                                     │
  ┌──────────┐     ┌▼──────────┐     ┌──────────────┐     ┌─────────────┐ │
  │ WhatsApp  │────▶│           │     │              │     │             │ │
  │ (Gateway) │     │           │     │  LLM Gateway │────▶│  SearXNG    │ │
  ├──────────┤     │ RabbitMQ  │────▶│  (DeepSeek/  │     │  (busca     │ │
  │ Telegram  │────▶│  (4 filas │     │   Claude/    │     │   produtos) │ │
  │ (Polling) │     │   + DLQ)  │     │   OpenAI)    │     │             │ │
  └──────────┘     └▲──────────┘     └──────┬───────┘     └─────────────┘ │
                    │                       │                             │
                    │              ┌────────▼───────┐                     │
                    │              │  Worker-Sender  │                     │
                    │              │  (WhatsApp ou   │────▶ Mensagem final │
                    │              │   Telegram)     │                     │
                    │              └────────────────┘                     │
                    └─────────────────────────────────────────────────────┘
```

**Pipeline assíncrono** com workers independentes:

| Worker | Função | Tecnologia |
|--------|--------|------------|
| **gateway** | Recebe mensagens do WhatsApp ou Telegram | Express + amqplib |
| **worker-stt** | Transcreve áudio para texto | Whisper / Google STT |
| **worker-orchestrator** | Agente conversacional + LLM Gateway | Hermes Agent / DeepSeek / Claude |
| **worker-search** | Consulta lojas via meta-buscador | SearXNG |
| **worker-sender** | Envia mensagens de volta ao usuário | WhatsApp API **ou** Telegram Bot |

---

## Stack

- **Runtime:** Node.js 20 (workers independentes)
- **Message Queue:** RabbitMQ (4 filas + DLQ)
- **Banco:** PostgreSQL 16 + Redis 7
- **IA:** LLM Gateway com fallback DeepSeek → Claude → OpenAI
- **Busca:** SearXNG (auto-hospedado)
- **Observabilidade:** Prometheus + Loki + Tempo + Grafana

---

## Pré-requisitos

### Para Telegram (recomendado para testes)

1. Docker e Docker Compose (v3+)
2. Node.js 20+
3. **Apenas** um token de bot do [@BotFather](https://t.me/botfather) no Telegram — grátis, instantâneo, sem aprovação

### Para WhatsApp Business API (produção)

1. Docker e Docker Compose (v3+)
2. Node.js 20+
3. Conta WhatsApp Business API (com número verificado)
4. Acesso ao [Meta Business Platform](https://business.facebook.com)

### Para WhatsApp via Baileys (testes)

1. Docker e Docker Compose (v3+)
2. Node.js 20+
3. Um número de WhatsApp pessoal (escaneia QR code no terminal)

---

## Início Rápido (Telegram)

```bash
# 1. Crie um bot no Telegram via @BotFather e copie o token

# 2. Configure as variáveis
cp .env.example .env
# Edite .env: coloque TELEGRAM_BOT_TOKEN e ajuste CANAL=telegram

# 3. Inicie todos os serviços
make up

# 4. Converse com seu bot no Telegram
```

> O modo Telegram usa **polling** (sem precisar de URL pública). Ideal para testes locais.

## Início Rápido (WhatsApp Business)

```bash
# 1. Configure as variáveis de ambiente
cp .env.example .env
# Edite .env com: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID

# 2. Inicie todos os serviços
make up

# 3. Configure o webhook no Meta Business Platform
# POST https://seu-dominio.com/webhook/whatsapp

# 4. Verifique os logs
make logs
```

## Início Rápido (WhatsApp via Baileys)

```bash
# Alternativa grátis sem conta Business.
# O worker-sender usa Baileys (protocolo WhatsApp Web) em vez da API oficial.

# 1. Configure o canal
echo "CANAL=baileys" >> .env

# 2. Suba o worker-sender com Baileys
make up

# 3. Escaneie o QR code que aparece no terminal do worker-sender
```

---

## Serviços

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| Gateway | 3000 | Webhook WhatsApp ou API Telegram |
| PostgreSQL | 5432 | Banco de dados |
| Redis | 6379 | Cache + sessão |
| RabbitMQ | 5672 / 15672 | Message queue / Management UI |
| SearXNG | 8080 | Meta-buscador |
| Prometheus | 9090 | Métricas |
| Loki | 3100 | Logs centralizados |
| Tempo | 3200 | Tracing distribuído |
| Grafana | 3001 | Dashboards |

---

## Estrutura do Projeto

```
amparo-mvp/
├── gateway/               # API Gateway (webhook WhatsApp / API Telegram)
│   └── src/
│       ├── webhook/       # Router, validator, parser
│       └── queue/         # RabbitMQ producer
│
├── worker-stt/            # Transcrição de áudio
│   └── src/
│       ├── audio/         # Download + STT
│       └── queue/         # Consumer + producer
│
├── worker-orchestrator/   # Agente conversacional
│   └── src/
│       ├── agent/tools/   # Ferramentas (search, profile, etc.)
│       ├── llm/           # LLM Gateway + providers
│       ├── queue/         # Consumer + producer
│       └── prompts/       # System prompt + templates
│
├── worker-search/         # Consulta SearXNG
│   └── src/
│       ├── search/        # Client, ranker, comparator
│       └── queue/         # Consumer + producer
│
├── worker-sender/         # Envio (WhatsApp API / Baileys / Telegram)
│   └── src/
│       ├── sender/        # Text, buttons, image, link
│       └── queue/         # Consumer + DLQ handler
│
├── worker-telegram/       # [Opcional] Bot Telegram (polling)
│   └── src/
│       ├── bot/           # Handlers + middlewares
│       └── queue/         # Consumer + producer
│
├── database/migrations/   # SQL migrations (6 tabelas)
├── observability/         # Prometheus, Loki, Tempo, Grafana
├── searxng/               # Config do meta-buscador
├── rabbitmq/              # Definitions (filas + DLQs)
└── redis/                 # redis.conf
```

---

## Webhook / Polling

### WhatsApp (Business API)

Configure o webhook no Meta Business Platform para apontar para:

```
POST https://seu-dominio.com/webhook/whatsapp
```

**Verificação (GET):** O gateway responde automaticamente ao desafio `hub.challenge` quando o `hub.verify_token` coincide com o configurado.

### Telegram

**Modo polling** (padrão para testes — sem URL pública):
```bash
# O worker-telegram faz polling na API do Telegram a cada 1s.
# Basta ter o token do bot e internet.
```

**Modo webhook** (produção — precisa de URL pública com HTTPS):
```bash
# https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://seu-dominio.com/webhook/telegram
```

---

## Comparação: WhatsApp vs Telegram

| Aspecto | WhatsApp (Business) | Telegram (Bot) | WhatsApp (Baileys) |
|---------|---------------------|----------------|--------------------|
| Custo | Pago por conversa | **Grátis** | **Grátis** |
| Cadastro | Aprovação Meta (dias) | @BotFather (segundos) | QR code (segundos) |
| Mensagens ilimitadas | ❌ (limite por tier) | ✅ Sim | ✅ Sim |
| Imagens + Áudio | ✅ | ✅ | ✅ |
| Botões interativos | ✅ (buttons) | ✅ (InlineKeyboard) | ✅ (Baileys) |
| Risco de banimento | ❌ Nenhum | Nenhum | ⚠️ Médio |
| Ideal para | Produção | Testes / MVP | Testes / MVP |

---

## Testes

```bash
make test-unit    # Testes unitários de todos os workers
make test         # Testes completos
```

---

## LGPD

O sistema segue a Lei Geral de Proteção de Dados:
- Consentimento explícito obrigatório para armazenar dados
- Criptografia AES-256 para dados sensíveis
- Direito ao esquecimento (deleção lógica com `ativo = false`)
- Logs de auditoria para todas as ações
- Nenhum dado de cartão de crédito é processado ou armazenado

---

## Monitoramento

Dashboards disponíveis em http://localhost:3001 (admin/amparo123)

- **Grafana:** Visão consolidada de métricas, logs e tracing
- **Prometheus:** Métricas de latência, throughput e erros por worker
- **Loki:** Logs estruturados em JSON com busca full-text
- **Tempo:** Tracing distribuído por mensagem (entrada → resposta)

---

## Variáveis de Ambiente Relevantes

```env
# ── Canal ──────────────────────────────────────────────────
CANAL=telegram              # telegram | whatsapp | baileys

# ── Telegram (se CANAL=telegram) ────────────────────────────
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# ── WhatsApp Business (se CANAL=whatsapp) ───────────────────
WHATSAPP_TOKEN=EAATest...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_API_URL=https://graph.facebook.com
WHATSAPP_API_VERSION=v21.0

# ── LLM Gateway ─────────────────────────────────────────────
DEEPSEEK_API_KEY=sk-...
CLAUDE_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

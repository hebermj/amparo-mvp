-- =============================================
-- Amparo MVP v2 — Migration 005: sessoes_conversa
-- =============================================
CREATE TABLE IF NOT EXISTS sessoes_conversa (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    ativa           BOOLEAN DEFAULT TRUE,
    contexto        JSONB,
    historico       JSONB,
    ultima_interacao TIMESTAMP DEFAULT NOW(),
    criado_em       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes_conversa(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_ativa ON sessoes_conversa(ativa) WHERE ativa = true;

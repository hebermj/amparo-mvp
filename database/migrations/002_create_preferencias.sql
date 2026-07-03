-- =============================================
-- Amparo MVP v2 — Migration 002: preferencias
-- Dados criptografados do usuário (AES-256)
-- =============================================
CREATE TABLE IF NOT EXISTS preferencias (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    chave           VARCHAR(50) NOT NULL,   -- 'endereco'
    valor           TEXT NOT NULL,           -- Criptografado (AES-256)
    consentimento_id INTEGER,
    criado_em       TIMESTAMP DEFAULT NOW(),
    atualizado_em   TIMESTAMP DEFAULT NOW(),
    UNIQUE(usuario_id, chave)
);

CREATE INDEX IF NOT EXISTS idx_preferencias_usuario ON preferencias(usuario_id);

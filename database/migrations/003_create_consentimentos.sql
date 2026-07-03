-- =============================================
-- Amparo MVP v2 — Migration 003: consentimentos
-- Registro LGPD de todos os consentimentos
-- =============================================
CREATE TABLE IF NOT EXISTS consentimentos (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo            VARCHAR(50) NOT NULL,   -- 'armazenar_endereco'
    concedido       BOOLEAN NOT NULL,       -- true = concedido, false = revogado
    detalhes        JSONB,
    criado_em       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consentimentos_usuario ON consentimentos(usuario_id);

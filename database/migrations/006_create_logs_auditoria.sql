-- =============================================
-- Amparo MVP v2 — Migration 006: logs_auditoria
-- =============================================
CREATE TABLE IF NOT EXISTS logs_auditoria (
    id              BIGSERIAL PRIMARY KEY,
    usuario_id      INTEGER REFERENCES usuarios(id),
    acao            VARCHAR(100) NOT NULL,
    detalhes        JSONB,
    criado_em       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_data ON logs_auditoria(criado_em);

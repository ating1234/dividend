-- Cloudflare D1 (SQLite) Schema for Dividend Calculator Cache
CREATE TABLE IF NOT EXISTS dividend_cache (
    stock_id TEXT,
    years INTEGER,
    avg_dividend REAL NOT NULL,
    years_recorded INTEGER NOT NULL,
    last_updated TEXT NOT NULL,
    PRIMARY KEY (stock_id, years)
);

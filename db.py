import sqlite3
import os

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "portfolio.db")

def init_db():
    """初始化資料庫與資料表"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS portfolio (
            stock_id TEXT PRIMARY KEY,
            shares REAL NOT NULL
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS dividend_cache (
            stock_id TEXT,
            years INTEGER,
            avg_dividend REAL NOT NULL,
            years_recorded INTEGER NOT NULL,
            last_updated TEXT NOT NULL,
            PRIMARY KEY (stock_id, years)
        )
    """)
    conn.commit()
    conn.close()

def get_portfolio():
    """獲取所有持股"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT stock_id, shares FROM portfolio")
    rows = cursor.fetchall()
    conn.close()
    return [{"stock_id": row[0], "shares": row[1]} for row in rows]

def add_or_update_stock(stock_id: str, shares: float):
    """新增或更新持股，若股數為 0 則不進行新增，若已存在則累加/覆寫"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 檢查是否已存在
    cursor.execute("SELECT shares FROM portfolio WHERE stock_id = ?", (stock_id,))
    row = cursor.fetchone()
    
    if row:
        # 已存在，更新股數 (累加)
        new_shares = row[0] + shares
        if new_shares <= 0:
            cursor.execute("DELETE FROM portfolio WHERE stock_id = ?", (stock_id,))
        else:
            cursor.execute("UPDATE portfolio SET shares = ? WHERE stock_id = ?", (new_shares, stock_id))
    else:
        # 新增
        if shares > 0:
            cursor.execute("INSERT INTO portfolio (stock_id, shares) VALUES (?, ?)", (stock_id, shares))
            
    conn.commit()
    conn.close()

def delete_stock(stock_id: str):
    """刪除持股"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM portfolio WHERE stock_id = ?", (stock_id,))
    conn.commit()
    conn.close()

def get_cached_dividend(stock_id: str, years: int):
    """
    查詢快取的股利資料
    返回包含 avg_dividend, years_recorded, last_updated 的字典或 None
    """
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT avg_dividend, years_recorded, last_updated FROM dividend_cache WHERE stock_id = ? AND years = ?",
        (stock_id, years)
    )
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            "avg_dividend": row[0],
            "years_recorded": row[1],
            "last_updated": row[2]
        }
    return None

def set_cached_dividend(stock_id: str, years: int, avg_dividend: float, years_recorded: int):
    """
    寫入或更新股利快取
    """
    import datetime
    today_str = datetime.date.today().isoformat()
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO dividend_cache (stock_id, years, avg_dividend, years_recorded, last_updated)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(stock_id, years) DO UPDATE SET
            avg_dividend = excluded.avg_dividend,
            years_recorded = excluded.years_recorded,
            last_updated = excluded.last_updated
    """, (stock_id, years, avg_dividend, years_recorded, today_str))
    conn.commit()
    conn.close()

def clear_dividend_cache():
    """清空所有股利快取，強制重新下載"""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM dividend_cache")
    conn.commit()
    conn.close()

import datetime
import pandas as pd
import yfinance as yf
import db

def get_stock_dividend_data(stock_id: str, years: int = 5):
    """
    輸入台股代碼 (例如 '2330' 或 '0050')
    根據指定的年份 (years) 抓取平均年股利與即時股價 (優先讀取 30 天內的本機 SQLite 快取)
    
    返回字典格式的統計結果
    """
    stock_id_cleaned = stock_id.strip()
    
    # 1. 檢查本機 SQLite 快取是否有效 (30 天內)
    cache = db.get_cached_dividend(stock_id_cleaned, years)
    use_cache = False
    
    if cache:
        try:
            last_updated = datetime.date.fromisoformat(cache["last_updated"])
            days_passed = (datetime.date.today() - last_updated).days
            if days_passed < 30: # 30天內，直接使用快取
                use_cache = True
        except Exception:
            pass
            
    # 2. 獲取最新股價與股票名稱 (不論是否使用股利快取，最新股價都必須即時撈取，但此撈取速度極快)
    ticker_str = f"{stock_id_cleaned}.TW"
    try:
        ticker = yf.Ticker(ticker_str)
        
        # 1. 取得即時/最新收盤價
        todays_data = ticker.history(period="1d")
        if todays_data.empty:
            # 嘗試用 5d 來抓取，有時 1d 會因為非交易時段沒有資料
            todays_data = ticker.history(period="5d")
            
        # 如果依然是空的，嘗試第二種後綴 .TWO (櫃買中心上櫃股票/ETF)
        if todays_data.empty:
            ticker_str = f"{stock_id_cleaned}.TWO"
            ticker = yf.Ticker(ticker_str)
            todays_data = ticker.history(period="1d")
            if todays_data.empty:
                todays_data = ticker.history(period="5d")
            
        if todays_data.empty:
            return {
                "success": False,
                "msg": f"找不到代號 {stock_id} 的股價資料，請確認代碼是否正確"
            }
            
        current_price = todays_data["Close"].iloc[-1]
        
        # 2. 獲取股票名稱 (嘗試從 info 拿，拿不到就用 stock_id)
        stock_name = stock_id
        try:
            info = ticker.info
            stock_name = info.get("shortName", info.get("longName", stock_id))
        except Exception:
            pass
            
        # 3. 處理股利數據
        if use_cache:
            # 直接使用快取中的股利資料，免去最耗時的聯網下載歷史紀錄
            avg_dividend = cache["avg_dividend"]
            years_recorded = cache["years_recorded"]
            avg_yield = (avg_dividend / current_price) * 100 if current_price > 0 else 0.0
            
            return {
                "success": True,
                "stock_id": stock_id_cleaned,
                "stock_name": stock_name,
                "current_price": current_price,
                "avg_dividend": avg_dividend,
                "avg_yield": avg_yield,
                "years_recorded": years_recorded,
                "msg": "取得成功 (來自本機快取)"
            }
            
        # 4. 若無快取或快取已過期，則聯網完整抓取歷史配息紀錄
        dividends = ticker.dividends
        if dividends.empty:
            # 沒有配息歷史，快取平均股利為 0.0 元
            db.set_cached_dividend(stock_id_cleaned, years, 0.0, 0)
            return {
                "success": True,
                "stock_id": stock_id_cleaned,
                "stock_name": stock_name,
                "current_price": current_price,
                "avg_dividend": 0.0,
                "avg_yield": 0.0,
                "years_recorded": 0,
                "msg": "該股票無歷史配息紀錄"
            }
            
        # 4. 計算過去 N 年的完整配息
        # 為了公平計算，我們排除目前尚未過完的 2026 年
        current_year = datetime.datetime.now().year
        start_year = current_year - years
        end_year = current_year - 1
        
        # 過濾 N 年內的配息
        div_history = dividends[
            (dividends.index.year >= start_year)
            & (dividends.index.year <= end_year)
        ]
        
        # 處理新上市股票/ETF (例如 2024 年才配息)
        # 我們從該股票「最早有配息紀錄的年份」開始計算，或者從 start_year 開始
        first_div_year = dividends.index.year.min()
        effective_start_year = max(start_year, first_div_year)
        
        if div_history.empty:
            # 近 N 年都沒有配息，但歷史有，快取平均股利為 0.0 元
            db.set_cached_dividend(stock_id_cleaned, years, 0.0, years)
            return {
                "success": True,
                "stock_id": stock_id_cleaned,
                "stock_name": stock_name,
                "current_price": current_price,
                "avg_dividend": 0.0,
                "avg_yield": 0.0,
                "years_recorded": years,
                "msg": f"近 {years} 年無配息紀錄"
            }
            
        # 按年份進行加總，解決月配、季配的加總問題
        yearly_div = div_history.groupby(div_history.index.year).sum()
        
        # 為了避免缺漏年份（例如 2023 年有配，但 2024 年沒配， yearly_div 裡不會有 2024）
        # 我們使用 reindex 將 effective_start_year 到 end_year 之間的年份補齊，缺漏的填 0
        all_years = list(range(effective_start_year, end_year + 1))
        yearly_div = yearly_div.reindex(all_years, fill_value=0.0)
        
        avg_dividend = yearly_div.mean()
        years_recorded = len(all_years)
        
        # 寫入或更新本機 SQLite 快取
        db.set_cached_dividend(stock_id_cleaned, years, avg_dividend, years_recorded)
        
        # 5. 計算平均殖利率
        avg_yield = (avg_dividend / current_price) * 100 if current_price > 0 else 0.0
        
        return {
            "success": True,
            "stock_id": stock_id_cleaned,
            "stock_name": stock_name,
            "current_price": current_price,
            "avg_dividend": avg_dividend,
            "avg_yield": avg_yield,
            "years_recorded": years_recorded,
            "yearly_detail": yearly_div.to_dict(),
            "msg": "取得成功"
        }
        
    except Exception as e:
        return {
            "success": False,
            "msg": f"抓取資料時發生異常錯誤: {str(e)}"
        }

if __name__ == "__main__":
    # 本地測試
    db.init_db()
    print("測試台積電 (2330):")
    print(get_stock_dividend_data("2330", years=5))
    print("\n測試元大台灣50 (0050):")
    print(get_stock_dividend_data("0050", years=5))

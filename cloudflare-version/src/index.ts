export interface Env {
  DB: D1Database;
}

// CORS 跨域回應標頭設定
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // 處理 OPTIONS 預檢請求
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 路由 1: 獲取股利與股價
    if (url.pathname === "/api/dividend" && request.method === "GET") {
      return handleDividendRequest(url, env);
    }

    // 路由 2: 清除快取
    if (url.pathname === "/api/clear-cache" && request.method === "POST") {
      return handleClearCache(env);
    }

    // 404 未找到
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: corsHeaders,
    });
  }
};

// 處理股利與股價查詢
async function handleDividendRequest(url: URL, env: Env): Promise<Response> {
  const stockId = url.searchParams.get("stock_id");
  const yearsParam = url.searchParams.get("years");
  
  if (!stockId) {
    return new Response(JSON.stringify({ success: false, msg: "缺少股票代碼 stock_id 參數" }), {
      status: 400,
      headers: corsHeaders
    });
  }
  
  const stockIdClean = stockId.trim().toUpperCase();
  const years = yearsParam ? parseInt(yearsParam, 10) : 5;
  
  if (isNaN(years) || years <= 0) {
    return new Response(JSON.stringify({ success: false, msg: "年份參數錯誤" }), {
      status: 400,
      headers: corsHeaders
    });
  }

  try {
    // 1. 檢查本機 D1 快取 (30天內有效)
    const cacheRecord = await env.DB.prepare(
      "SELECT avg_dividend, years_recorded, last_updated FROM dividend_cache WHERE stock_id = ? AND years = ?"
    )
      .bind(stockIdClean, years)
      .first<{ avg_dividend: number; years_recorded: number; last_updated: string }>();

    let useCache = false;
    if (cacheRecord) {
      const lastUpdated = new Date(cacheRecord.last_updated);
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - lastUpdated.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 30) {
        useCache = true;
      }
    }

    // 2. 獲取即時股價 (不論快取與否，都發起超輕量的最新股價請求，只抓 5d 的資料)
    let suffix = "TW"; // 預設為上市後綴
    
    // 嘗試上市後綴 .TW
    let yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${stockIdClean}.TW?interval=1d&range=5d`;
    let response = await fetch(yahooUrl);
    let resultJson: any = await response.json();
    
    if (!resultJson.chart.result) {
      // 嘗試上櫃後綴 .TWO
      suffix = "TWO";
      yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${stockIdClean}.TWO?interval=1d&range=5d`;
      response = await fetch(yahooUrl);
      resultJson = await response.json();
    }

    if (!resultJson.chart.result) {
      return new Response(JSON.stringify({ success: false, msg: `找不到代號 ${stockIdClean} 的資料` }), {
        headers: corsHeaders
      });
    }

    const chartResult = resultJson.chart.result[0];
    const closes = chartResult.indicators.quote[0].close;
    // 取得最新收盤價 (過濾掉 null 值)
    const validCloses = closes.filter((c: any) => c !== null && c !== undefined);
    if (validCloses.length === 0) {
      return new Response(JSON.stringify({ success: false, msg: "無即時收盤價資料" }), {
        headers: corsHeaders
      });
    }
    const currentPrice = validCloses[validCloses.length - 1];
    
    // 嘗試獲取股票簡稱
    const stockName = chartResult.meta.symbol.split(".")[0];

    // 3. 處理股利資料
    if (useCache && cacheRecord) {
      const avgDividend = cacheRecord.avg_dividend;
      const yearsRecorded = cacheRecord.years_recorded;
      const avgYield = (avgDividend / currentPrice) * 100;
      
      return new Response(
        JSON.stringify({
          success: true,
          stock_id: stockIdClean,
          stock_name: stockName,
          current_price: currentPrice,
          avg_dividend: avgDividend,
          avg_yield: avgYield,
          years_recorded: yearsRecorded,
          msg: "取得成功 (來自邊緣 D1 快取)"
        }),
        { headers: corsHeaders }
      );
    }

    // 4. 若無快取或快取過期，撈取歷史配息 (抓 5 年的配息紀錄)
    // 為了支持 1, 2, 3, 5 年平均，我們直接撈取 5 年 (5y) 範圍，在代碼中進行對應年份過濾
    const divUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${stockIdClean}.${suffix}?interval=1d&range=5y&events=div`;
    const divResponse = await fetch(divUrl);
    const divResultJson: any = await divResponse.json();
    
    if (!divResultJson.chart.result) {
      return new Response(JSON.stringify({ success: false, msg: "抓取歷史配息資料失敗" }), {
        headers: corsHeaders
      });
    }

    const divChartResult = divResultJson.chart.result[0];
    const dividends = divChartResult.events?.dividends;
    
    if (!dividends || Object.keys(dividends).length === 0) {
      // 該股票無歷史配息紀錄，寫入快取 0
      await writeToD1(env, stockIdClean, years, 0.0, 0);
      return new Response(
        JSON.stringify({
          success: true,
          stock_id: stockIdClean,
          stock_name: stockName,
          current_price: currentPrice,
          avg_dividend: 0.0,
          avg_yield: 0.0,
          years_recorded: 0,
          msg: "該股票無歷史配息紀錄"
        }),
        { headers: corsHeaders }
      );
    }

    // 5. 計算動態平均股利
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - years;
    const endYear = currentYear - 1;
    
    // 初始化年份配息加總
    const yearlyMap = new Map<number, number>();
    let minYear = 9999;
    
    for (const key in dividends) {
      const div = dividends[key];
      const divDate = new Date(div.date * 1000);
      const divYear = divDate.getFullYear();
      
      if (divYear >= startYear && divYear <= endYear) {
        const currentAmount = yearlyMap.get(divYear) || 0;
        yearlyMap.set(divYear, currentAmount + div.amount);
      }
      
      const absoluteDivYear = divDate.getFullYear();
      if (absoluteDivYear < minYear) {
        minYear = absoluteDivYear;
      }
    }

    const effectiveStartYear = Math.max(startYear, minYear);
    
    if (yearlyMap.size === 0) {
      // 區間內無配息，寫入快取
      await writeToD1(env, stockIdClean, years, 0.0, years);
      return new Response(
        JSON.stringify({
          success: true,
          stock_id: stockIdClean,
          stock_name: stockName,
          current_price: currentPrice,
          avg_dividend: 0.0,
          avg_yield: 0.0,
          years_recorded: years,
          msg: `近 ${years} 年無配息紀錄`
        }),
        { headers: corsHeaders }
      );
    }

    // 補足缺失年份並求平均值
    let sumDividend = 0;
    const yearsRange = endYear - effectiveStartYear + 1;
    
    for (let y = effectiveStartYear; y <= endYear; y++) {
      sumDividend += yearlyMap.get(y) || 0.0;
    }
    
    const avgDividend = sumDividend / yearsRange;
    const avgYield = (avgDividend / currentPrice) * 100;
    
    // 寫入 D1 快取
    await writeToD1(env, stockIdClean, years, avgDividend, yearsRange);

    return new Response(
      JSON.stringify({
        success: true,
        stock_id: stockIdClean,
        stock_name: stockName,
        current_price: currentPrice,
        avg_dividend: avgDividend,
        avg_yield: avgYield,
        years_recorded: yearsRange,
        msg: "取得成功"
      }),
      { headers: corsHeaders }
    );

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, msg: `API 異常: ${error.message}` }), {
      headers: corsHeaders
    });
  }
}

// 寫入 D1 快取的輔助函數
async function writeToD1(env: Env, stockId: string, years: number, avgDividend: number, yearsRecorded: number) {
  const todayStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  await env.DB.prepare(`
    INSERT INTO dividend_cache (stock_id, years, avg_dividend, years_recorded, last_updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(stock_id, years) DO UPDATE SET
      avg_dividend = excluded.avg_dividend,
      years_recorded = excluded.years_recorded,
      last_updated = excluded.last_updated
  `)
    .bind(stockId, years, avgDividend, yearsRecorded, todayStr)
    .run();
}

// 清除快取
async function handleClearCache(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("DELETE FROM dividend_cache").run();
    return new Response(JSON.stringify({ success: true, msg: "D1 快取已成功清空" }), {
      headers: corsHeaders
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, msg: `清除快取失敗: ${error.message}` }), {
      headers: corsHeaders
    });
  }
}

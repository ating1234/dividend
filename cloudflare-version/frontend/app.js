// 1. API 網址設定 (開發環境為 localhost:8787，生產環境使用相對路徑)
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8787'
    : '';

// 2. 初始化 LocalStorage 持股清單
if (!localStorage.getItem('portfolio')) {
    const defaultPortfolio = [
        { stock_id: '0050', shares: 5000 },
        { stock_id: '2330', shares: 2000 },
        { stock_id: '00878', shares: 10000 }
    ];
    localStorage.setItem('portfolio', JSON.stringify(defaultPortfolio));
}

// 3. 圖表變數宣告 (用於銷毀重繪)
let progressChart = null;
let assetChart = null;
let dividendChart = null;

// 4. 初始化事件監聽
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    
    // 綁定輸入框與選單變更
    document.getElementById('monthlyTarget').addEventListener('input', () => {
        updateTargetLabels();
        updateUI();
    });
    document.getElementById('selectedYears').addEventListener('change', () => {
        // 更新表格表頭上的年份標示
        const years = document.getElementById('selectedYears').value;
        document.querySelectorAll('.years-label').forEach(el => el.textContent = years);
        updateUI();
    });
    
    // 綁定新增、刪除及清除快取按鈕
    document.getElementById('addStockBtn').addEventListener('click', handleAddStock);
    document.getElementById('deleteStockBtn').addEventListener('click', handleDeleteStock);
    document.getElementById('clearCacheBtn').addEventListener('click', handleClearCache);
    
    // 初始化目標金額標示
    updateTargetLabels();
    
    // 第一次載入 UI
    updateUI();
});

// 更新年度目標標示
function updateTargetLabels() {
    const monthlyTarget = parseFloat(document.getElementById('monthlyTarget').value) || 0;
    const annualTarget = monthlyTarget * 12;
    document.getElementById('annualTargetLabel').textContent = annualTarget.toLocaleString();
}

// 初始化 App 狀態與年份標籤
function initApp() {
    const years = document.getElementById('selectedYears').value;
    document.querySelectorAll('.years-label').forEach(el => el.textContent = years);
}

// 核心：撈取資料與更新 UI 介面
async function updateUI() {
    const portfolio = JSON.parse(localStorage.getItem('portfolio')) || [];
    const selectedYears = parseInt(document.getElementById('selectedYears').value, 10);
    const monthlyTarget = parseFloat(document.getElementById('monthlyTarget').value) || 0;
    const annualTarget = monthlyTarget * 12;

    const tableBody = document.getElementById('portfolioTableBody');
    const deleteSelect = document.getElementById('deleteStockSelect');
    
    tableBody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-slate-400">正在聯網撈取最新股價與歷史配息資料...</td></tr>`;
    deleteSelect.innerHTML = '';

    if (portfolio.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-slate-400">目前您的投資組合為空，請在左側新增股票標的。</td></tr>`;
        resetStats();
        return;
    }

    const portfolioData = [];
    
    // 逐一聯網發起 Worker API 請求
    for (const item of portfolio) {
        try {
            const res = await fetch(`${API_BASE}/api/dividend?stock_id=${item.stock_id}&years=${selectedYears}`);
            const data = await res.json();
            
            if (data.success) {
                portfolioData.push({
                    stock_id: data.stock_id,
                    stock_name: data.stock_name,
                    current_price: data.current_price,
                    avg_dividend: data.avg_dividend,
                    avg_yield: data.avg_yield,
                    shares: item.shares,
                    market_value: item.shares * data.current_price,
                    annual_dividend: item.shares * data.avg_dividend,
                    years_recorded: data.years_recorded
                });
            } else {
                console.error(`撈取 ${item.stock_id} 失敗: ${data.msg}`);
            }
        } catch (err) {
            console.error(`請求 ${item.stock_id} 異常:`, err);
        }
    }

    if (portfolioData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-red-500">所有標的資料載入失敗，請確認網路連線或代碼是否正確。</td></tr>`;
        resetStats();
        return;
    }

    // 渲染「目前投資組合」表格
    tableBody.innerHTML = '';
    portfolioData.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-100 hover:bg-slate-50 transition-colors text-slate-700';
        tr.innerHTML = `
            <td class="py-3 font-semibold">${item.stock_id}</td>
            <td class="py-3">${item.stock_name}</td>
            <td class="py-3">${item.current_price.toFixed(2)}</td>
            <td class="py-3">${item.avg_dividend.toFixed(2)}</td>
            <td class="py-3">${item.avg_yield.toFixed(2)}%</td>
            <td class="py-3">${item.shares.toLocaleString()}</td>
            <td class="py-3">${Math.round(item.market_value).toLocaleString()}</td>
            <td class="py-3 font-bold">${Math.round(item.annual_dividend).toLocaleString()}</td>
            <td class="py-3 text-slate-400">${item.years_recorded}</td>
        `;
        tableBody.appendChild(tr);

        // 渲染刪除下拉選單
        const option = document.createElement('option');
        option.value = item.stock_id;
        option.textContent = `${item.stock_id} ${item.stock_name}`;
        deleteSelect.appendChild(option);
    });

    // 統計核心指標
    const totalMarketValue = portfolioData.reduce((sum, item) => sum + item.market_value, 0);
    const totalAnnualDividend = portfolioData.reduce((sum, item) => sum + item.annual_dividend, 0);
    const weightedAverageYield = totalMarketValue > 0 ? (totalAnnualDividend / totalMarketValue * 100) : 0;
    const monthlyAverageDividend = totalAnnualDividend / 12;
    const progressPct = Math.min(100.0, (totalAnnualDividend / annualTarget * 100));
    const dividendShortfall = Math.max(0.0, annualTarget - totalAnnualDividend);

    // 更新指標卡片 UI
    document.getElementById('totalMarketValue').textContent = `$${Math.round(totalMarketValue).toLocaleString()}`;
    document.getElementById('totalAnnualDividend').textContent = `$${Math.round(totalAnnualDividend).toLocaleString()}`;
    document.getElementById('monthlyAverageDividend').textContent = `$${Math.round(monthlyAverageDividend).toLocaleString()}`;
    document.getElementById('weightedAverageYield').textContent = `${weightedAverageYield.toFixed(2)}%`;

    // 繪製目標達成率進度條 (RadialBar)
    renderProgressChart(progressPct);

    // 渲染「尚缺股數與加碼試算」
    renderShortfallSection(dividendShortfall, portfolioData, monthlyTarget, monthlyAverageDividend, selectedYears);

    // 繪製圓餅圖占比分析
    renderRatioCharts(portfolioData);
}

// 重置核心指標資料
function resetStats() {
    document.getElementById('totalMarketValue').textContent = '$0';
    document.getElementById('totalAnnualDividend').textContent = '$0';
    document.getElementById('monthlyAverageDividend').textContent = '$0';
    document.getElementById('weightedAverageYield').textContent = '0.00%';
    renderProgressChart(0);
    document.getElementById('shortfallSection').style.display = 'none';
    if (assetChart) assetChart.destroy();
    if (dividendChart) dividendChart.destroy();
}

// 繪製目標達成率 RadialBar
function renderProgressChart(progressPct) {
    const options = {
        chart: {
            type: 'radialBar',
            height: 250,
            sparkline: { enabled: true }
        },
        series: [parseFloat(progressPct.toFixed(1))],
        colors: ['#FF8B3D'],
        plotOptions: {
            radialBar: {
                startAngle: -90,
                endAngle: 90,
                track: {
                    background: '#E2E8F0',
                    strokeWidth: '97%',
                    margin: 5,
                    dropShadow: { enabled: false }
                },
                dataLabels: {
                    name: {
                        show: true,
                        color: '#64748B',
                        fontSize: '16px',
                        offsetY: -10
                    },
                    value: {
                        show: true,
                        color: '#1E293B',
                        fontSize: '30px',
                        fontWeight: 'bold',
                        offsetY: -5,
                        formatter: function (val) {
                            return val + "%";
                        }
                    }
                }
            }
        },
        labels: ['達成率']
    };

    if (progressChart) progressChart.destroy();
    progressChart = new ApexCharts(document.querySelector("#progressChart"), options);
    progressChart.render();
}

// 渲染加碼與缺口試算
function renderShortfallSection(shortfall, portfolioData, monthlyTarget, monthlyAverageDividend, selectedYears) {
    const section = document.getElementById('shortfallSection');
    const alertBox = document.getElementById('shortfallAlert');
    const tableBody = document.getElementById('shortfallTableBody');

    if (shortfall <= 0) {
        section.style.display = 'block';
        alertBox.className = 'p-4 mb-4 rounded-lg bg-green-100 text-green-800 font-bold';
        alertBox.innerHTML = '🎉 恭喜！您的預估年股利已達成設定的每月股利目標！';
        tableBody.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-green-600 font-semibold">目標已達成，不需額外加碼！</td></tr>';
        return;
    }

    section.style.display = 'block';
    alertBox.className = 'p-4 mb-4 rounded-lg bg-orange-100 text-orange-800';
    const monthlyShort = monthlyTarget - monthlyAverageDividend;
    alertBox.innerHTML = `目前年度股利尚缺 <strong>${Math.round(shortfall).toLocaleString()}</strong> 元（相當於每月還差 <strong>${Math.round(monthlyShort).toLocaleString()}</strong> 元）。若您要透過<strong>單一股票</strong>來補足全部缺口，各自需要加碼的數量與資金如下：`;

    tableBody.innerHTML = '';
    portfolioData.forEach(item => {
        if (item.avg_dividend > 0) {
            const sharesNeeded = shortfall / item.avg_dividend;
            const fundsNeeded = sharesNeeded * item.current_price;
            
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-100 text-slate-700';
            tr.innerHTML = `
                <td class="py-3 font-semibold">${item.stock_id}</td>
                <td class="py-3">${item.stock_name}</td>
                <td class="py-3">${item.current_price.toFixed(2)}</td>
                <td class="py-3">${item.avg_dividend.toFixed(2)}</td>
                <td class="py-3 font-bold">${Math.round(sharesNeeded).toLocaleString()} 股</td>
                <td class="py-3">${(sharesNeeded / 1000).toFixed(2)} 張</td>
                <td class="py-3 font-bold text-blue-900">${Math.round(fundsNeeded).toLocaleString()} 元</td>
            `;
            tableBody.appendChild(tr);
        }
    });
}

// 繪製持股與股利雙圓餅圖 (Donut)
function renderRatioCharts(portfolioData) {
    const labels = portfolioData.map(item => `${item.stock_id} ${item.stock_name}`);
    const assetValues = portfolioData.map(item => Math.round(item.market_value));
    const dividendValues = portfolioData.map(item => Math.round(item.annual_dividend));

    // 1. 資產占比甜甜圈圖
    const assetOptions = {
        chart: { type: 'donut', height: 320 },
        series: assetValues,
        labels: labels,
        legend: { position: 'bottom', labels: { colors: '#1E293B' } },
        dataLabels: { enabled: true, style: { colors: ['#FFFFFF'] } },
        title: { text: '資產市值占比', style: { color: '#1E293B', fontSize: '16px', fontWeight: 'bold' } }
    };

    if (assetChart) assetChart.destroy();
    assetChart = new ApexCharts(document.querySelector("#assetRatioChart"), assetOptions);
    assetChart.render();

    // 2. 股利來源占比甜甜圈圖
    const dividendOptions = {
        chart: { type: 'donut', height: 320 },
        series: dividendValues,
        labels: labels,
        legend: { position: 'bottom', labels: { colors: '#1E293B' } },
        dataLabels: { enabled: true, style: { colors: ['#FFFFFF'] } },
        title: { text: '預估年股利來源占比', style: { color: '#1E293B', fontSize: '16px', fontWeight: 'bold' } }
    };

    if (dividendChart) dividendChart.destroy();
    dividendChart = new ApexCharts(document.querySelector("#dividendRatioChart"), dividendOptions);
    dividendChart.render();
}

// 處理新增股票標的
function handleAddStock() {
    const stockId = document.getElementById('newStockId').value.trim();
    const shares = parseFloat(document.getElementById('newShares').value) || 0;

    if (!stockId) {
        alert('請輸入有效的股票/ETF 代碼');
        return;
    }
    if (shares <= 0) {
        alert('持股股數必須大於 0');
        return;
    }

    const portfolio = JSON.parse(localStorage.getItem('portfolio')) || [];
    const exists = portfolio.find(item => item.stock_id.toUpperCase() === stockId.toUpperCase());

    if (exists) {
        exists.shares += shares;
    } else {
        portfolio.push({ stock_id: stockId.toUpperCase(), shares: shares });
    }

    localStorage.setItem('portfolio', JSON.stringify(portfolio));
    
    // 清空輸入欄位
    document.getElementById('newStockId').value = '';
    document.getElementById('newShares').value = '';

    updateUI();
}

// 處理刪除股票標的
function handleDeleteStock() {
    const deleteStockId = document.getElementById('deleteStockSelect').value;
    if (!deleteStockId) return;

    let portfolio = JSON.parse(localStorage.getItem('portfolio')) || [];
    portfolio = portfolio.filter(item => item.stock_id !== deleteStockId);
    
    localStorage.setItem('portfolio', JSON.stringify(portfolio));
    updateUI();
}

// 處理強制清除邊緣 D1 快取並重新加載
async function handleClearCache() {
    const btn = document.getElementById('clearCacheBtn');
    btn.disabled = true;
    btn.innerHTML = `🔄 正在清空邊緣快取...`;

    try {
        const res = await fetch(`${API_BASE}/api/clear-cache`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert('Cloudflare D1 快取已清除，正在重新撈取最新除權息資料！');
            updateUI();
        } else {
            alert(`清除快取失敗: ${data.msg}`);
        }
    } catch (err) {
        alert('連線邊緣伺服器時發生錯誤，請確認 Worker 是否已啟動。');
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `🔄 強制更新最新股利資料`;
    }
}

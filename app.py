import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from calculator import get_stock_dividend_data
import db

# 1. 網頁配置與標題
st.set_page_config(
    page_title="台股股利缺口計算機",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 套用精美的自訂 CSS 樣式 (極致美學：深色玻璃微漸層風格)
st.markdown("""
<style>
    /* 全域字體 */
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+TC:wght@300;400;700&display=swap');
    html, body, [class*="css"] {
        font-family: 'Outfit', 'Noto Sans TC', sans-serif;
    }
    
    /* 漸層標題與卡片 */
    .main-title {
        font-size: 2.8rem;
        font-weight: 700;
        background: linear-gradient(135deg, #FF6B6B 0%, #FFD93D 50%, #4D96FF 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.5rem;
    }
    .subtitle {
        color: #475569;
        font-size: 1.1rem;
        margin-bottom: 2rem;
    }
    .metric-card {
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 16px;
        padding: 1.5rem;
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.05);
        margin-bottom: 1rem;
    }
    .metric-title {
        color: #64748B;
        font-size: 0.9rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .metric-value {
        font-size: 2.2rem;
        font-weight: 700;
        color: #1E3A8A;
        margin-top: 0.5rem;
    }
</style>
""", unsafe_allow_html=True)

# 初始化資料庫
db.init_db()

# 初始化持股清單 (從 SQLite 讀取，若為空則寫入預設範例)
portfolio_list = db.get_portfolio()
if not portfolio_list:
    # 預設範例資料，方便使用者初次體驗，並寫入資料庫
    default_portfolio = [
        {"stock_id": "0050", "shares": 5000},
        {"stock_id": "2330", "shares": 2000},
        {"stock_id": "00878", "shares": 10000}
    ]
    for item in default_portfolio:
        db.add_or_update_stock(item["stock_id"], item["shares"])
    portfolio_list = db.get_portfolio()

# 2. 側邊欄設定
with st.sidebar:
    st.markdown("## ⚙️ 財務規劃設定")
    
    # 股利目標設定
    monthly_target = st.number_input(
        "每月期望股利目標 (元)",
        min_value=1000,
        max_value=10000000,
        value=30000,
        step=5000,
        help="輸入您希望每個月能穩定領到的平均股利金額"
    )
    
    annual_target = monthly_target * 12
    st.markdown(f"**年度總股利目標：** `{annual_target:,.0f}` 元")
    
    st.markdown("---")
    
    # 平均股利計算年數選擇
    selected_years = st.selectbox(
        "平均股利計算年數",
        [1, 2, 3, 5],
        index=3,
        help="選擇要用過去幾年的配息紀錄來計算平均股利"
    )
    
    # 強制重刷股利按鈕
    if st.button("🔄 強制更新最新股利資料", use_container_width=True):
        db.clear_dividend_cache()
        st.success("已清除本機快取，正在重新下載最新股利資料...")
        st.rerun()
    
    st.markdown("---")
    st.markdown("### ➕ 新增持股標的")
    new_stock_id = st.text_input("股票/ETF 代碼", placeholder="例如: 2330 或 00878")
    new_shares = st.number_input("目前持有股數", min_value=0, value=0, step=1000)
    
    if st.button("新增至投資組合", use_container_width=True):
        if new_stock_id:
            db.add_or_update_stock(new_stock_id.strip(), new_shares)
            st.success(f"已更新 {new_stock_id} 股數：{new_shares:,.0f} 股")
            st.rerun()
        else:
            st.error("請輸入有效的股票代碼")

# 3. 主要內容區域
st.markdown("<h1 class='main-title'>📊 台股股利目標與缺口計算機</h1>", unsafe_allow_html=True)
st.markdown("<p class='subtitle'>以過去平均配息資料為核心，精準分析您的財務自由進度與缺口</p>", unsafe_allow_html=True)

# 顯示目前的持股清單並允許編輯與刪除
st.markdown("### 💼 目前投資組合")
if not portfolio_list:
    st.info("目前您的投資組合為空，請在左側欄位新增股票代碼與持有股數。")
else:
    # 抓取所有股票的 yfinance 資料
    portfolio_data = []
    with st.spinner("正在聯網撈取最新股利與股價資料..."):
        for item in portfolio_list:
            res = get_stock_dividend_data(item["stock_id"], years=selected_years)
            if res["success"]:
                portfolio_data.append({
                    "代碼": res["stock_id"],
                    "名稱": res["stock_name"],
                    "目前股價": res["current_price"],
                    f"{selected_years}年平均股利": res["avg_dividend"],
                    f"{selected_years}年平均殖利率(%)": res["avg_yield"],
                    "持有股數": item["shares"],
                    "市值": item["shares"] * res["current_price"],
                    "預估年股利": item["shares"] * res["avg_dividend"],
                    "有效年數": res["years_recorded"]
                })
            else:
                st.warning(f"標的 {item['stock_id']} 資料載入失敗: {res['msg']}")

    if portfolio_data:
        df = pd.DataFrame(portfolio_data)
        
        # 使用更精緻的格式呈現 DataFrame
        st.dataframe(
            df.style.format({
                "目前股價": "{:,.2f}",
                f"{selected_years}年平均股利": "{:,.2f}",
                f"{selected_years}年平均殖利率(%)": "{:,.2f}%",
                "持有股數": "{:,.0f}",
                "市值": "{:,.0f}",
                "預估年股利": "{:,.0f}"
            }),
            use_container_width=True,
            hide_index=True
        )
        
        # 提供刪除股票的功能 (置於精簡排版 columns 中，避免單獨 selectbox 占滿整行)
        col_del_select, col_del_btn = st.columns([3, 1])
        with col_del_select:
            delete_stock = st.selectbox("選擇要刪除的股票", [item["stock_id"] for item in portfolio_list], index=0, label_visibility="collapsed")
        with col_del_btn:
            if st.button("刪除所選股票", use_container_width=True):
                db.delete_stock(delete_stock)
                st.success(f"已從組合中刪除 {delete_stock}")
                st.rerun()

# 4. 統計核心指標
if 'df' in locals() and not df.empty:
    total_market_value = df["市值"].sum()
    total_annual_dividend = df["預估年股利"].sum()
    avg_yield = (total_annual_dividend / total_market_value * 100) if total_market_value > 0 else 0
    dividend_shortfall = max(0.0, annual_target - total_annual_dividend)
    monthly_avg_dividend = total_annual_dividend / 12
    progress_pct = min(100.0, (total_annual_dividend / annual_target * 100))
    
    # 顯示核心數據卡片
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-title">目前資產總市值</div>
            <div class="metric-value">${total_market_value:,.0f}</div>
        </div>
        """, unsafe_allow_html=True)
    with col2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-title">年預估股利收入</div>
            <div class="metric-value">${total_annual_dividend:,.0f}</div>
        </div>
        """, unsafe_allow_html=True)
    with col3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-title">月平均股利</div>
            <div class="metric-value">${monthly_avg_dividend:,.0f}</div>
        </div>
        """, unsafe_allow_html=True)
    with col4:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-title">加權平均殖利率</div>
            <div class="metric-value">{avg_yield:.2f}%</div>
        </div>
        """, unsafe_allow_html=True)
        
    # 進度儀表板
    st.markdown("### 🎯 股利目標進度條")
    
    # 使用 plotly 做一個漂亮的 Gauge / Progress Bar
    fig_progress = go.Figure(go.Indicator(
        mode = "gauge+number",
        value = progress_pct,
        domain = {'x': [0, 1], 'y': [0, 1]},
        title = {'text': "目標達成率 (%)", 'font': {'size': 20, 'color': "#1E293B"}},
        number = {'suffix': "%", 'font': {'color': "#FF8B3D", 'size': 50}},
        gauge = {
            'axis': {
                'range': [0, 100], 
                'tickwidth': 1, 
                'tickcolor': "#1E293B",
                'tickfont': {'color': "#1E293B", 'size': 14}
            },
            'bar': {'color': "#4D96FF"},
            'bgcolor': "rgba(0, 0, 0, 0.05)",
            'borderwidth': 2,
            'bordercolor': "rgba(0, 0, 0, 0.1)",
            'steps': [
                {'range': [0, 50], 'color': 'rgba(255, 107, 107, 0.1)'},
                {'range': [50, 80], 'color': 'rgba(255, 217, 61, 0.1)'},
                {'range': [80, 100], 'color': 'rgba(77, 150, 255, 0.1)'}
            ],
        }
    ))
    fig_progress.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        height=280,
        margin=dict(l=20, r=20, t=50, b=20),
    )
    st.plotly_chart(fig_progress, use_container_width=True)

    # 缺口計算與加碼建議
    st.markdown("---")
    st.markdown("### 🔍 尚缺股數與加碼試算")
    if dividend_shortfall <= 0:
        st.success("🎉 恭喜！您的預估年股利已達成設定的每月股利目標！")
    else:
        st.warning(f"目前年度股利尚缺 **{dividend_shortfall:,.0f}** 元（相當於每月還差 **{monthly_target - monthly_avg_dividend:,.0f}** 元）。")
        st.markdown("若您要透過**單一股票**來補足全部缺口，各自需要加碼的數量與資金如下：")
        
        shortfall_data = []
        for index, row in df.iterrows():
            if row[f"{selected_years}年平均股利"] > 0:
                shares_needed = dividend_shortfall / row[f"{selected_years}年平均股利"]
                funds_needed = shares_needed * row["目前股價"]
                shortfall_data.append({
                    "標的代碼": row["代碼"],
                    "標的名稱": row["名稱"],
                    "目前股價": row["目前股價"],
                    f"{selected_years}年平均股利": row[f"{selected_years}年平均股利"],
                    "加碼尚缺股數": shares_needed,
                    "加碼尚缺張數": shares_needed / 1000,
                    "加碼所需資金(元)": funds_needed
                })
        
        if shortfall_data:
            df_sf = pd.DataFrame(shortfall_data)
            st.dataframe(
                df_sf.style.format({
                    "目前股價": "{:,.2f}",
                    f"{selected_years}年平均股利": "{:,.2f}",
                    "加碼尚缺股數": "{:,.0f}",
                    "加碼尚缺張數": "{:,.2f}",
                    "加碼所需資金(元)": "{:,.0f}"
                }),
                use_container_width=True,
                hide_index=True
            )

    # 視覺化圖表：持股占比與股利來源占比
    st.markdown("---")
    st.markdown("### 📊 投資組合占比分析")
    col_chart1, col_chart2 = st.columns(2)
    
    with col_chart1:
        fig_pie_value = px.pie(
            df, 
            values='市值', 
            names='名稱', 
            title='資產市值占比',
            hole=0.4,
            color_discrete_sequence=px.colors.qualitative.Pastel
        )
        fig_pie_value.update_traces(
            textposition='inside',
            textinfo='percent+label',
            textfont=dict(size=14, color='#FFFFFF')
        )
        fig_pie_value.update_layout(
            paper_bgcolor='rgba(0,0,0,0)',
            legend_font_color="#1E293B",
            title_font_color="#1E293B",
            title_font=dict(size=20),
            margin=dict(t=50, b=20, l=20, r=20)
        )
        st.plotly_chart(fig_pie_value, use_container_width=True)
        
    with col_chart2:
        fig_pie_div = px.pie(
            df, 
            values='預估年股利', 
            names='名稱', 
            title='預估年股利來源占比',
            hole=0.4,
            color_discrete_sequence=px.colors.qualitative.Safe
        )
        fig_pie_div.update_traces(
            textposition='inside',
            textinfo='percent+label',
            textfont=dict(size=14, color='#FFFFFF')
        )
        fig_pie_div.update_layout(
            paper_bgcolor='rgba(0,0,0,0)',
            legend_font_color="#1E293B",
            title_font_color="#1E293B",
            title_font=dict(size=20),
            margin=dict(t=50, b=20, l=20, r=20)
        )
        st.plotly_chart(fig_pie_div, use_container_width=True)

else:
    st.info("請在左側邊欄輸入股票資料，並點選「新增至投資組合」開始試算。")

# 5. 頁尾資訊與 Bug 回報
st.markdown("---")
st.markdown(
    '<p style="text-align: center; color: #64748B; font-size: 0.9rem;">'
    '系統破防了？👉 <a href="https://bug-center.pages.dev/login" target="_blank" style="color: #4D96FF; text-decoration: none; font-weight: bold;">回報 Bug</a>'
    '</p>',
    unsafe_allow_html=True
)


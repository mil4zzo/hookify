import pandas as pd
import streamlit as st

### INICIA INTERFACE ###
st.title('📊 Dashboard')
st.write('See the summary of your loaded ADs.')
st.divider()

st.query_params.clear()

if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):
    ads_data = st.session_state['ads_data']
    
    # Metrics
    metrics_ads_count = len(ads_data)
    metrics_adsets_count = ads_data['adset_id'].nunique()
    metrics_total_spend = f"R$ {ads_data['spend'].sum():,.2f}"
    #metrics_avg_ctr = ads_data['ctr'].mean()
    metrics_impressions = ads_data['impressions'].sum()
    #metrics_plays = ads_data['video_play_action'].sum()
    #metrics_thruplays = ads_data['video_play_action'].sum()
    metrics_clicks = ads_data['clicks'].sum()
    metrics_inline_link_clicks = ads_data['inline_link_clicks'].sum()
    metrics_reach = ads_data['reach'].sum()
    #metrics_frequency = ads_data['frequency'].mean()
    #metrics_cpm = ads_data['cpm'].mean()

    col1, col2, col3 = st.columns(3, gap="small")

    with col1:
        with st.container(height=None, border=True):
            st.metric(label="Total ADs", value=metrics_ads_count)
            st.metric(label="Total Adsets", value=metrics_adsets_count)
            st.metric(label="Total Spend", value=metrics_total_spend)

    with col2:
        with st.container(height=None, border=True):
            st.header("Adsets")

    with col3:
        with st.container(height=None, border=True):
            st.header("Total Spend")

    st.dataframe(ads_data)
else:
    st.warning('⬅️ First, load ADs in the sidebar.')

    col1, col2, col3, col4 = st.columns(4, gap="small")

    with col1:
        with st.container(height=None, border=True):
            st.metric(label="Total Spend", value='R$ 2,000,000.00')
            col1a, col1b = st.columns(2, gap="small")
            with col1a:
                st.metric(label="ADs", value=402)
            with col1b:
                st.metric(label="Adsets", value=182)
    with col2:
        with st.container(height=None, border=True):
            st.metric(label="CPR", value='R$ 7,77')
            st.metric(label="CTR", value='1.20%')
            st.metric(label="CPM", value='R$ 19,22')
    with col3:
        with st.container(height=None, border=True):
            st.metric(label="Impressions", value='109,209')
            st.metric(label="Reach", value='99,321')
            st.metric(label="Frequency", value='2.30')
    with col4:
        with st.container(height=None, border=True):
            st.metric(label="Clicks", value='18,022')
            st.metric(label="Inline Clicks", value='13,628')
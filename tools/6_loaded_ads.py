import json
import pandas as pd
import streamlit as st

from libs.session_manager import get_session_access_token, get_session_ads_data

# Initialize session state for access_token if not already initialized
api_key = get_session_access_token()

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('🗂️ Loaded ADs:')
    st.write('See the raw data for your loaded ADs.')

st.divider()

df_ads_data = get_session_ads_data()
if df_ads_data is not None:
    
    with st.expander('All existing columns'):
        st.write(df_ads_data.columns)
    with st.expander('All loaded ADs'):
        st.dataframe(df_ads_data)
    if 'raw_data' in st.session_state:
        with st.expander('RAW data'):
            st.dataframe(st.session_state['raw_data'])
    with st.expander('JSON sample'):
        json_string = json.dumps((df_ads_data.head(5).fillna('')).to_dict(orient='records'), ensure_ascii=False, default=str)
        st.write(json_string)
elif df_ads_data == []:
    st.warning('🙅‍♂️ No ADs found with these filters.')
else:
    st.warning('⬅️ First, load ADs in the sidebar.')
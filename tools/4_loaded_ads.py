import json
import pandas as pd
import streamlit as st

# Initialize session state for access_token if not already initialized
if 'access_token' not in st.session_state:
    st.session_state['access_token'] = None

# Set api_key from session state
api_key = st.session_state['access_token']

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('🗂️ Loaded ADs:')
    st.write('See the raw data for your loaded ADs.')

st.divider()


if 'ads_data' in st.session_state:
    ads_data = st.session_state['ads_data']
    if isinstance(ads_data, pd.DataFrame):
        with st.expander('All existing columns'):
            st.write(ads_data.columns)
        with st.expander('All loaded ads'):
            st.dataframe(ads_data)
        with st.expander('JSON sample'):
            json_string = json.dumps((ads_data.head(5).fillna('')).to_dict(orient='records'), ensure_ascii=False, default=str)
            st.write(json_string)
    else:
        st.warning('🙅‍♂️ No ADs found with these filters.')
else:
    st.warning('⬅️ First, load ADs in the sidebar.')
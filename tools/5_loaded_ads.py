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
        with st.expander('All loaded ADs'):
            st.dataframe(ads_data)
<<<<<<< HEAD
        if 'raw_data' in st.session_state:
            with st.expander('RAW data'):
                st.dataframe(st.session_state['raw_data'])
=======
        with st.expander('RAW data'):
            st.dataframe(st.session_state['raw_data'])
>>>>>>> 5da38fc41aa7bde96a2a9dda6ef5c566f7eaea98
        with st.expander('JSON sample'):
            json_string = json.dumps((ads_data.head(5).fillna('')).to_dict(orient='records'), ensure_ascii=False, default=str)
            st.write(json_string)
    else:
        st.warning('🙅‍♂️ No ADs found with these filters.')
else:
    st.warning('⬅️ First, load ADs in the sidebar.')
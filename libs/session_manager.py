import pandas as pd
import streamlit as st

def get_or_init(key: str, default: any = None): # type: ignore
    """ Retorna o valor salvo em st.session_state[key] ou o valor default, se ele ainda não existir."""
    if key not in st.session_state:
        st.session_state[key] = default
    return st.session_state[key]

def get_session_ads_data():
    """ Busca 'ads_data' no st.session_state...?\n
        ✅ Tipo 'pd.Dataframe'\n
        ✅ Tem pelo menos 1 linha 
    """
    if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame) and len(st.session_state['ads_data']) > 0:
        return st.session_state['ads_data'].copy()
    else:
        return None
    
def has_session_ads_data():
    return 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame) and len(st.session_state['ads_data']) > 0

def get_session_access_token():
    """ Busca 'access_token' no st.session_state (default = None)
    """
    return get_or_init("access_token")

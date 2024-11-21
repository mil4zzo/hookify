import streamlit as st
from datetime import date
from libs.graph_api import GraphAPI
from libs.dataformatter import format_ads_data, getInitials
#from streamlit_extras.mandatory_date_range import date_range_picker

def render(api_key=None):

    st.logo('res/img/logo-hookify-alpha.png')
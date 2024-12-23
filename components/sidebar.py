import pandas as pd
import streamlit as st
from datetime import date
from libs.graph_api import GraphAPI
from libs.dataformatter import format_ads_data, getInitials
#from streamlit_extras.mandatory_date_range import date_range_picker

def render(api_key=None):
    st.logo('res/img/logo-hookify-alpha.png')

    if 'filter_values' in st.session_state:
        filter_values = st.session_state["filter_values"]
        with st.sidebar:
            df_filter_options = pd.DataFrame(columns=['Filter', 'Selected'])
            st.subheader('🔎 Active filters')
            if filter_values['cost_column'] and filter_values['cost_column'] != '':
                df_filter_options.loc[len(df_filter_options)] = ['Goal', filter_values['cost_column'].split(".")[-1]]

            if filter_values['min_impressions'] > 0:
                df_filter_options.loc[len(df_filter_options)] = ['Impressions', "> " + str(filter_values['min_impressions']) if filter_values['min_impressions'] > 0 else filter_values['min_impressions']]

            if filter_values['min_spend'] > 0:
                df_filter_options.loc[len(df_filter_options)] = ['Spend', "> " + str(filter_values['min_spend']) if filter_values['min_spend'] > 0 else filter_values['min_spend']]

            if filter_values['filters_campaign'] and filter_values['filters_campaign'] != []:
                df_filter_options.loc[len(df_filter_options)] = ['Campaigns', filter_values['filters_campaign']]

            if filter_values['filters_adset'] and filter_values['filters_adset'] != []:
                df_filter_options.loc[len(df_filter_options)] = ['Adsets', filter_values['filters_adset']]

            if filter_values['filters_adname'] and filter_values['filters_adname'] != []:
                df_filter_options.loc[len(df_filter_options)] = ['ADs', filter_values['filters_adname']]

            st.dataframe(df_filter_options, hide_index=True, use_container_width=True)
import pandas as pd
import streamlit as st
from ast import literal_eval
from streamlit_extras.tags import tagger_component

def render(api_key=None):
    st.logo('res/img/logo-hookify-alpha.png')

    if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):
        with st.sidebar:
            with st.expander('🗂️ Loaded ADs'):
                with st.container(border=True):
                    if 'act_selected' in st.session_state:
                        selected_act_id = st.session_state['act_selected']
                        cols_act = st.columns([1,3])
                        with cols_act[0]:
                            st.caption('Account:')
                        with cols_act[1]:
                            st.markdown(f"{selected_act_id}")
                    
                    if 'time_range' in st.session_state:
                        time_range = literal_eval(st.session_state['time_range'])
                        cols_time_range = st.columns([1,3])
                        with cols_time_range[0]:
                            st.caption('Date:')
                        with cols_time_range[1]:
                            st.markdown(f"{pd.to_datetime(time_range["since"]).strftime('%d/%m/%Y') + " to " + pd.to_datetime(time_range["until"]).strftime('%d/%m/%Y')}")

                    if 'filters' in st.session_state:
                        filters = st.session_state['filters']
                        cols_filters = st.columns([1,3])
                        with cols_filters[0]:
                            st.caption('Filters:')
                        with cols_filters[1]:
                            st.markdown(f"{' | '.join(f'{str(filter['field'].split('.')[0]).capitalize()} *:gray[{str(filter['operator']).lower()}]* **{filter['value']}**' for filter in filters)}")

    if 'filter_values' in st.session_state:
        filter_values = st.session_state["filter_values"]
        with st.sidebar:
            with st.expander('🔎 Active filters'):
                df_filter_options = pd.DataFrame(columns=['Filter', 'Selected'])
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
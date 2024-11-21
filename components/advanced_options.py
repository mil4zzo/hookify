from re import S
from altair import value
import streamlit as st

class AdvancedOptions:
    def __init__(self):
        self.df_ads_data = st.session_state['ads_original_data'].copy()
        if 'cost_column' not in st.session_state:
            cost_columns = [col for col in st.session_state.ads_data.columns if 'cost_per_' in col]
            st.session_state.cost_column = cost_columns[0]
        if 'min_plays' not in st.session_state:
            st.session_state.min_plays = 10
        if 'min_spend' not in st.session_state:
            st.session_state.min_spend = 25
        if 'filters_campaign' not in st.session_state:
            st.session_state.filters_campaign = []
        if 'filters_adset' not in st.session_state:
            st.session_state.filters_adset = []
        if 'filters_adname' not in st.session_state:
            st.session_state.filters_adname = []
        if 'apply_filters' not in st.session_state:
            st.session_state.apply_filters = False

    def build(self):
        # ADVANCED OPTIONS UI
        with st.expander('Avanced options', expanded=False):
            with st.form("options", border=False):
                with st.container(border=True):
                    controls = st.columns([1,2], gap='large')
                    with controls[0]:
                        st.subheader('Settings')
                        select_conversion = st.empty()
                        thresholds = st.empty()
                    with controls[1]:
                        st.subheader('Filters')
                        filters = st.empty()

                    # EVENT COST COLUMNS
                    cost_columns = [col for col in self.df_ads_data.columns if 'cost_per_' in col]

                    # EVENT COST SELECTOR
                    with select_conversion.container():
                        cols = st.columns([1,2])
                        with cols[0]:
                            st.write('Conversion event')
                        with cols[1]:
                            cost_column = st.selectbox('Conversion event:', cost_columns, 
                                                    format_func=lambda x: (x.split(".")[-1]), 
                                                    label_visibility='collapsed',
                                                    key='cost_column')

                    # FILTERS
                    with filters.container():
                        campaign_list = list(st.session_state['ads_original_data']['campaign_name'].unique())
                        adset_list = list(st.session_state['ads_original_data']['adset_name'].unique())
                        ad_list = list(st.session_state['ads_original_data']['ad_name'].unique())
                        # FILTERS > CAMPAIGN
                        cols = st.columns([1,6], gap='small')
                        with cols[0]:
                            st.write('Campaign')
                        with cols[1]:
                            filter_campaigns = st.multiselect('Select campaign:', campaign_list, 
                                                        label_visibility='collapsed',
                                                        key='filters_campaign')
                        # FILTERS > ADSET
                        cols = st.columns([1,6], gap='small')
                        with cols[0]:
                            st.write('Adset')
                        with cols[1]:
                            filter_adsets = st.multiselect('Select adset:', adset_list, 
                                                    label_visibility='collapsed',
                                                    key='filters_adset')
                        # FILTERS > ADs
                        cols = st.columns([1,6], gap='small')
                        with cols[0]:
                            st.write('Ad name')
                        with cols[1]:
                            filter_ads = st.multiselect('Select ad:', ad_list, 
                                                label_visibility='collapsed',
                                                key='filters_adname')

                    # THRESHOLDS
                    with thresholds.container():
                        cols = st.columns([1,2], gap='small')
                        with cols[0]:
                            st.write('Minimum Plays')
                        with cols[1]:
                            filter_min_plays = st.number_input("Minimum Plays", 
                                                        min_value=0, max_value=200,  
                                                        step=5, 
                                                        label_visibility='collapsed',
                                                        key='min_plays')
                        cols = st.columns([1,2], gap='small')
                        with cols[0]:
                            st.write('Minimum Spend')
                        with cols[1]:
                            filter_min_spend = st.number_input("Minimum Spend", 
                                                        min_value=0, max_value=2000, 
                                                        step=10, 
                                                        label_visibility='collapsed',
                                                        key='min_spend')
                            
                st.form_submit_button('Apply filters', type='primary', use_container_width=True, on_click=self.set_apply_filters, kwargs={'filter_campaigns':filter_campaigns, 'filter_adsets':filter_adsets, 'filter_ads':filter_ads, 'filter_min_plays':filter_min_plays, 'filter_min_spend':filter_min_spend, 'cost_column': cost_column})

    def set_apply_filters(self, filter_campaigns, filter_adsets, filter_ads, filter_min_plays, filter_min_spend, cost_column):
        st.session_state.apply_filters = True
        # st.session_state.filters_campaign = filter_campaigns
        # st.session_state.filters_adset = filter_adsets
        # st.session_state.filters_adname = filter_ads
        # st.session_state.min_plays = filter_min_plays
        # st.session_state.min_spend = filter_min_spend
        # st.session_state.cost_column = cost_column

    def apply_filters(self):
        df_ads_data = self.df_ads_data.copy()

        print('apply_filter')
        # Apply filters here
        if st.session_state.filters_campaign:
            df_ads_data = df_ads_data[df_ads_data['campaign_name'].isin(st.session_state.filters_campaign)]
        if st.session_state.filters_adset:
            df_ads_data = df_ads_data[df_ads_data['adset_name'].isin(st.session_state.filters_adset)]
        if st.session_state.filters_adname:
            df_ads_data = df_ads_data[df_ads_data['ad_name'].isin(st.session_state.filters_adname)]
        if st.session_state.min_plays:
            df_ads_data = df_ads_data[df_ads_data['total_plays'] >= st.session_state.min_plays]
        if st.session_state.min_spend:
            df_ads_data = df_ads_data[df_ads_data['spend'] >= st.session_state.min_spend]
        if st.session_state.cost_column:
            cost_column = st.session_state.cost_column
            event_name = cost_column.split('.')[-1]
            conversions_columns = [col for col in df_ads_data.columns if 'conversions' in col]
            results_column = next((col for col in conversions_columns if event_name in col), None)
    
        # Reset the apply_filters flag
        st.session_state.apply_filters = False

        print(f'cost_column: {cost_column}')
        print(f'results_column: {results_column}')

        return {
            'cost_column': cost_column,
            'results_column': results_column,
            'df_ads_data': df_ads_data
        }
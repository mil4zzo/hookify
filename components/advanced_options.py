import streamlit as st

class AdvancedOptions:
    def __init__(self):        
        # Initialize session state with default values if not exists
        self.initialize_session_state()

    def initialize_session_state(self):
        # Initialize filter values with a different key prefix
        if 'filter_values' not in st.session_state:
            cost_columns = [col for col in st.session_state["ads_original_data"].columns if 'cost_per_' in col]
            filter_values = {
                'cost_column': cost_columns[0] if cost_columns else None,
                'min_impressions': 1,
                'min_spend': 1,
                'filters_campaign': [],
                'filters_adset': [],
                'filters_adname': [],
            }
            st.session_state.filter_values = filter_values
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
                    cost_columns = [col for col in st.session_state["ads_original_data"].columns if 'cost_per_' in col]

                    # EVENT COST SELECTOR
                    with select_conversion.container():
                        cols = st.columns([1,2])
                        with cols[0]:
                            st.write('Conversion event')
                        with cols[1]:
                            cost_column = st.selectbox('Conversion event:', cost_columns, 
                                                    format_func=lambda x: (x.split(".")[-1]), 
                                                    label_visibility='collapsed',
                                                    index=cost_columns.index(st.session_state.filter_values['cost_column']) if 'filter_values' in st.session_state and st.session_state.filter_values['cost_column'] in cost_columns else 0,
                                                    key='temp_cost_column')

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
                                                    default=st.session_state.filter_values['filters_campaign'] if 'filter_values' in st.session_state and st.session_state.filter_values['filters_campaign'] != [] else [],
                                                    key='temp_filters_campaign')
                        # FILTERS > ADSET
                        cols = st.columns([1,6], gap='small')
                        with cols[0]:
                            st.write('Adset')
                        with cols[1]:
                            filter_adsets = st.multiselect('Select adset:', adset_list, 
                                                    label_visibility='collapsed',
                                                    default=st.session_state.filter_values['filters_adset'] if 'filter_values' in st.session_state and st.session_state.filter_values['filters_adset'] != [] else [],
                                                    key='temp_filters_adset')
                        # FILTERS > ADs
                        cols = st.columns([1,6], gap='small')
                        with cols[0]:
                            st.write('Ad name')
                        with cols[1]:
                            filter_ads = st.multiselect('Select ad:', ad_list, 
                                                label_visibility='collapsed',
                                                default=st.session_state.filter_values['filters_adname'] if 'filter_values' in st.session_state and st.session_state.filter_values['filters_adname'] != [] else [],
                                                key='temp_filters_adname')

                    # THRESHOLDS
                    with thresholds.container():
                        cols = st.columns([1,2], gap='small')
                        with cols[0]:
                            st.write('Min. Impressions')
                        with cols[1]:
                            filter_min_impressions = st.number_input("Minimum Impressions", 
                                                        min_value=0,
                                                        step=500,
                                                        label_visibility='collapsed',
                                                        value=st.session_state.filter_values['min_impressions'] if 'filter_values' in st.session_state else 3000,
                                                        key='temp_min_impressions')
                        cols = st.columns([1,2], gap='small')
                        with cols[0]:
                            st.write('Min. Spend')
                        with cols[1]:
                            filter_min_spend = st.number_input("Minimum Spend", 
                                                        min_value=0, max_value=2000, 
                                                        step=5, 
                                                        label_visibility='collapsed',
                                                        value=st.session_state.filter_values['min_spend'] if 'filter_values' in st.session_state else 0,
                                                        key='temp_min_spend')
                            
                submitted = st.form_submit_button('Apply filters', type='primary', use_container_width=True)

                if submitted:
                    # Update our persistent filter values
                    st.session_state["filter_values"] = {
                        'cost_column': cost_column,
                        'filters_campaign': filter_campaigns,
                        'filters_adset': filter_adsets,
                        'filters_adname': filter_ads,
                        'min_impressions': filter_min_impressions,
                        'min_spend': filter_min_spend   
                    }
                    st.session_state.apply_filters = True

    def apply_filters(self, df_ads_data):
        try:
            cost_column = None
            results_column = None

            # Use the persistent filter values
            filters = st.session_state["filter_values"] if "filter_values" in st.session_state else None

            # Apply filters here
            if filters:
                if filters['filters_campaign'] and filters['filters_campaign'] != []:
                    df_ads_data = df_ads_data[df_ads_data['campaign_name'].isin(filters['filters_campaign'])]
                if filters['filters_adset'] and filters['filters_adset'] != []:
                    df_ads_data = df_ads_data[df_ads_data['adset_name'].isin(filters['filters_adset'])]
                if filters['filters_adname'] and filters['filters_adname'] != []:
                    df_ads_data = df_ads_data[df_ads_data['ad_name'].isin(filters['filters_adname'])]
                # if filters['min_plays']:
                #     df_ads_data = df_ads_data[df_ads_data['total_plays'] >= filters['min_plays']]
                if filters['min_impressions']:
                    df_ads_data = df_ads_data[df_ads_data['impressions'] >= filters['min_impressions']]
                if filters['min_spend']:
                    df_ads_data = df_ads_data[df_ads_data['spend'] >= filters['min_spend']]
                if filters['cost_column']:
                    cost_column = filters['cost_column']
                    event_name = cost_column.split('.')[-1]
                    conversions_columns = [col for col in df_ads_data.columns if 'conversions' in col]
                    results_column = next((col for col in conversions_columns if event_name in col), None)
            
                # Reset the apply_filters flag
                st.session_state.apply_filters = False

            return {
                'cost_column': cost_column,
                'results_column': results_column,
                'df_ads_data': df_ads_data
            }
        except Exception as e:
            st.error(f"Error applying filters: {str(e)}")
            return None
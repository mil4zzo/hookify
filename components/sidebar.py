import streamlit as st
from datetime import date
from libs.graph_api import GraphAPI
from libs.dataformatter import format_ads_data

def render(api_key):

    st.logo('res/img/logo-hookify-alpha.png')
    
    filters = []

    def create_account_selector(accounts_list):
        """Get the selected label from the sidebar."""
        labels = list(accounts_list.keys())
        account_selector = st.selectbox('Select your Ad Account:', labels, placeholder='Select an account...', key='account_selector')
        return account_selector

    def get_time_range():
        """Get the time range from the sidebar input."""
        start_date = st.date_input('🢖 Start Date', key='start_date')
        end_date = st.date_input('🢖 End Date', key='end_date')
        if start_date and end_date and isinstance(start_date, date) and isinstance(end_date, date):
            return "{'since':'" + start_date.strftime('%Y-%m-%d') + "','until':'" + end_date.strftime('%Y-%m-%d') + "'}"

    def construct_filter(field, operator, value):
        """Construct a filter dictionary."""
        return {'field': field, 'operator': operator, 'value': value}

    @st.cache_data(show_spinner=False)
    def cached_get_ads(api_key, act_id, time_range, filters):
        """Cache the ads retrieval."""
        graph_api = GraphAPI(api_key)
        return graph_api.get_ads(act_id, time_range, filters)

    accounts_data = st.session_state['accounts_data']
    accounts_list = {info['label']: info['act_id'] for info in accounts_data} # type: ignore

    with st.sidebar:
        selected_account = create_account_selector(accounts_list)

        with st.expander("Time range"):
            time_range = get_time_range()

        def create_filters():
            """Create filters from sidebar input."""
            filter_options = {
                'Campaign Name': 'campaign.name',
                'Adset Name': 'adset.name',
                'Ad Name': 'ad.name',
            }
            operator_options = [
                'EQUAL', 'NOT_EQUAL', 'CONTAIN', 'NOT_CONTAIN',
                'STARTS_WITH', 'ENDS_WITH'
            ]
            for filter_name, filter_field in filter_options.items():
                with st.expander(filter_name):
                    operator = st.selectbox(f'Operator', operator_options, key=f'operator_{filter_name}', label_visibility='collapsed')
                    value = st.text_input(f'Value', key=f'value_{filter_name}')
                    if value:
                        filters.append(construct_filter(filter_field, operator, value))
        create_filters()

        if st.button('Get ADs!', type='primary', use_container_width=True):
            selected_act_id = accounts_list[selected_account]
            st.session_state['act_selected'] = selected_act_id
            with st.spinner('Loading your ADs, please wait...'):
                ads_data_response = cached_get_ads(api_key, selected_act_id, time_range, filters)
                if ads_data_response:
                    ads_data = format_ads_data(ads_data_response)
                    st.session_state['ads_data'] = ads_data
                    st.session_state['ads_original_data'] = ads_data
                elif ads_data_response == []:
                    st.session_state['ads_data'] = []
                    st.error(f'⛔ No ADs found with these filters.')
                else:
                    st.error(f'😵‍💫 Failed to fetch data from Meta API: {ads_data_response}')

        if 'ads_data' in st.session_state and len(st.session_state['ads_data']) > 0:
            st.info(f'✅ {len(st.session_state['ads_data'])} ads ready and loaded.')
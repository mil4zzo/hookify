import streamlit as st
from datetime import date
from libs.graph_api import GraphAPI
from libs.dataformatter import format_ads_data, getInitials
from streamlit_extras.mandatory_date_range import date_range_picker

# Initialize ACCESS TOKEN (api_key)
if "access_token" not in st.session_state:
    st.session_state["access_token"] = None
api_key = st.session_state["access_token"]

filters = []

def create_account_selector(adaccounts_list):
    """Get the selected label from the sidebar."""
    labels = list(adaccounts_list.keys())
    account_selector = st.selectbox('Select your Ad Account:', labels, placeholder='Select an account...', key='account_selector')
    return account_selector

def get_time_range():
    """Get the time range from the sidebar input."""
    start_date, end_date = date_range_picker('Select a date range', default_start=date(year=2024, month=12, day=16), default_end= date.today())
    # start_date = st.date_input('🢖 Start Date', key='start_date')
    # end_date = st.date_input('🢖 End Date', key='end_date')
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

if api_key and 'account_info' in st.session_state and 'adaccounts' in st.session_state:
    adaccounts = st.session_state['adaccounts']
    adaccounts_list = {info['label']: info['act_id'] for info in adaccounts} # type: ignore
    account_info = st.session_state['account_info']

    # DATA DO USUÁRIO (perfil do facebook)
    st.markdown(f"""
        <div style="display: flex; flex-direction: row; align-items: center; gap: 1em; margin-bottom: 1.5rem">
            <div style="width: 2.5em; height: 2.5em">
                <img src="{account_info['picture']['data']['url']}" style="width: 100%; height: 100%; border-radius: 4px">
            </div>
            <div style="display: flex; flex-direction: column; gap: 0.25em;">
                <span style="font-weight: bold; line-height: 1em">{account_info['name']}</span>
                <span style="opacity: 0.67;font-size: 0.8em; line-height: 1em">{account_info['email']}</span>
            </div>
        </div>
    """, unsafe_allow_html=True)

    # AD ACCOUNT SELECTOR
    selected_adaccount = create_account_selector(adaccounts_list)

    # TIME RANGE
    with st.expander("Time range"):
        time_range = get_time_range()

    # FILTERS
    def create_filters():
        """Create filters from sidebar input."""
        filter_options = {
            'Campaign Name': 'campaign.name',
            'Adset Name': 'adset.name',
            'Ad Name': 'ad.name',
        }
        operator_options = [
            'CONTAIN', 'EQUAL', 'NOT_EQUAL', 'NOT_CONTAIN',
            'STARTS_WITH', 'ENDS_WITH'
        ]
        for filter_name, filter_field in filter_options.items():
            with st.expander(filter_name):
                operator = st.selectbox(f'Operator', operator_options, key=f'operator_{filter_name}', label_visibility='collapsed')
                value = st.text_input(f'Value', key=f'value_{filter_name}')
                if value:
                    filters.append(construct_filter(filter_field, operator, value))
    create_filters()

    # CTA - GET ADs!
    if st.button('Get ADs!', type='primary', use_container_width=True):
        selected_act_id = adaccounts_list[selected_adaccount]
        st.session_state['act_selected'] = selected_adaccount
        st.session_state['time_range'] = time_range
        st.session_state['filters'] = filters
        with st.spinner('Loading your ADs, please wait...'):
            ads_data = cached_get_ads(api_key, selected_act_id, time_range, filters)
            if ads_data:
                st.session_state['raw_data'] = ads_data
                ads_data = format_ads_data(ads_data)
                st.session_state['ads_data'] = ads_data
                st.session_state['ads_original_data'] = ads_data
                st.rerun()
            elif ads_data == []:
                st.session_state['ads_data'] = []
                st.error(f'⛔ No ADs found with these filters.')
            else:
                st.error(f'😵‍💫 Failed to fetch data from Meta API: {ads_data}')

    if 'ads_data' in st.session_state and len(st.session_state['ads_data']) > 0:
        st.info(f"✅ {len(st.session_state['ads_data'])} ads ready and loaded.")
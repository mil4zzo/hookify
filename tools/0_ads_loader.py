from ast import literal_eval
from datetime import datetime, timedelta
from time import sleep
import pandas as pd
import streamlit as st
from datetime import date
from components.elements import bt_delete
from libs.graph_api import GraphAPI
from libs.dataformatter import add_ads_pack, format_ads_data, getInitials, remove_ads_pack, split_date_range
from streamlit_extras.mandatory_date_range import date_range_picker

from libs.session_manager import get_session_access_token, get_session_ads_data

# Initialize ACCESS TOKEN (api_key)
api_key = get_session_access_token()

if 'loaded_ads' not in st.session_state:
    st.session_state['loaded_ads'] = []

filters = []

def create_account_selector(adaccounts_list):
    """Get the selected label from the sidebar."""
    labels = list(adaccounts_list.keys())
    account_selector = st.selectbox('Select your Ad Account:', labels, placeholder='Select an account...', key='account_selector')
    return account_selector

def get_time_range():
    """Get the time range from the sidebar input."""
    start_date, end_date = date_range_picker('Select a date range', default_start=date(year=2024, month=12, day=29), default_end= date.today())
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


# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('📔 ADs Loader')
    st.write('Load your AD Packs and combine them.')

st.divider()

if api_key and 'account_info' in st.session_state and 'adaccounts' in st.session_state:
    
    adaccounts = st.session_state['adaccounts']
    adaccounts_list = {info['label']: info['act_id'] for info in adaccounts} # type: ignore
    account_info = st.session_state['account_info']

    # DATA DO USUÁRIO (perfil do facebook)
    with cols[1]:
        st.subheader('Connected as:')
        container_profile = st.markdown(f"""
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

    @st.dialog(title='Load ADs')
    def open_dialog():

        # AD ACCOUNT SELECTOR
        selected_adaccount = create_account_selector(adaccounts_list)

        # TIME RANGE
        with st.expander("Time range"):
            time_range = get_time_range()
            st.write(time_range)

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
                    filter_built = construct_filter(filter_field, operator, value)
                    if value and len(value) > 0 and filter_built not in filters:
                        filters.append(filter_built)
        create_filters()

        # CTA - GET ADs!
        if st.button('Get ADs!', type='primary', use_container_width=True):
            selected_act_id = adaccounts_list[selected_adaccount]
            with st.spinner('Loading your ADs, please wait...'):
                st.write('selected_act_id', selected_act_id)
                st.write('time_range', time_range)
                st.write('filters', filters)
                ads_data = cached_get_ads(api_key, selected_act_id, time_range, filters)
                if len(ads_data) > 0:
                    unique_id = f"{selected_adaccount}&{selected_act_id}&{time_range}&{filters}"
                    add_ads_pack(unique_id, ads_data)
                    st.info(f"✅ {len(ads_data)} ads ready and loaded.")
                    sleep(3)
                    st.rerun()
                elif ads_data == []:
                    st.session_state['ads_data'] = []
                    st.error(f'⛔ No ADs found with these filters.')
                else:
                    st.error(f'😵‍💫 Failed to fetch data from Meta API: {ads_data}')

    # Calculate number of rows needed
    num_items = len(st.session_state['loaded_ads'])
    num_rows = (num_items + 3) // 4  # Ceiling division to get number of rows needed

    cols_menu = st.columns([3, 1])
    with cols_menu[0]:
        st.caption(f"Total Packs loaded: {num_items}")
    with cols_menu[1]:
        if st.button("Load Pack", key=f"btn_load_pack", type="primary", use_container_width=True):
            open_dialog()

    if num_items == 0:
        grid_cols = st.columns(4)
        with grid_cols[0]:
            with st.container(border=True):
                st.markdown("#### Load your first Pack")
                st.caption("Click the button below to load your first ADs Pack and unlock all features:")
                if st.button("Load Pack", type="primary", use_container_width=True):
                    open_dialog()
    else:
        # Create grid row by row
        for row in range(num_rows):
            grid_cols = st.columns(4)
            
            # Handle items in this row
            for col in range(4):
                item_index = row * 4 + col
                
                # Check if we still have items to display
                if item_index < num_items:
                    with grid_cols[col]:
                        with st.container(border=True, key=("bt_delete_" + f"{item_index}")):
                            cols_header = st.columns([4, 1])
                            with cols_header[0]:
                                st.markdown(f'#### Pack {item_index + 1}')
                            with cols_header[1]:
                                button = bt_delete(item_index, remove_ads_pack)

                            unique_id = st.session_state['loaded_ads'][item_index]
                            info = unique_id.split('&')
                            df_pack_ads = st.session_state[f"{unique_id}_ads_data"]

                            # COUNTS
                            st.dataframe(
                                pd.DataFrame([{
                                "Campaigns": len(set(df_pack_ads["campaign_id"])), 
                                "Adsets": len(set(df_pack_ads["adset_id"])), 
                                "ADs": len(set(df_pack_ads["ad_id"]))
                            }]), hide_index=True, use_container_width=True )

                            #st.caption(F"{info[0]} ({info[1]})")

                            # ACCOUNT
                            cols_act = st.columns([1,3])
                            with cols_act[0]:
                                st.caption("Account:")
                            with cols_act[1]:
                                st.markdown(f"{info[0]} :gray[({info[1]})]")

                            # TIME RANGE
                            item_time_range = literal_eval(info[2])
                            cols_time_range = st.columns([1,3])
                            with cols_time_range[0]:
                                st.caption("Date:")
                            with cols_time_range[1]:
                                st.markdown(pd.to_datetime(item_time_range["since"]).strftime("%d/%m/%Y") + " *:gray[→]* " + pd.to_datetime(item_time_range["until"]).strftime("%d/%m/%Y"))

                            # FILTERS
                            item_filters = literal_eval(info[3])
                            cols_filters = st.columns([1,3])
                            with cols_filters[0]:
                                st.caption("Filters:")
                            with cols_filters[1]:
                                if item_filters != []:
                                    st.markdown("<br>".join(f'{str(filter["field"].split(".")[0]).capitalize()} *:gray[{str(filter["operator"]).lower()}]* **{filter["value"]}**' for filter in item_filters), unsafe_allow_html=True)
                                else:
                                    st.caption("None")

                            # SPENT
                            extra_data = st.columns([1,3])
                            with extra_data[0]:
                                st.caption("Total spent:")
                            with extra_data[1]:
                                    st.markdown("$ " + "{:,.2f}".format(df_pack_ads["spend"].sum()))
                            
import streamlit as st
import pandas as pd
from graph_api import GraphAPI

# Initial Setup
api_key = "EAAOZAnAruPk8BOzIV7mehW8qLQ8rgjw1Oab2X7htTTBLzSlUOmWf3TBAO9PuQsbPCwLR7lddjjmQZCVQxHv6ZBjJpzfx8VNA0D4VXUpDQY5QB7ipat9zGSzYcIPB9sEaTV8XNfGOZB2C7AobuSt3jMZCzUGJ3x8Qk3BNOuYrd8lKlAmh8RdvZBwK4aNrndsWTpLTckjClZAnZCbDMXHoZCwZDZD"
filters = []
time_range = None

# Load and Cache ADs
@st.cache_data
def cached_get_ads(act_id, time_range, filters):
    """
    This function retrieves ads using the provided API key, time range, and filters.
    
    Parameters:
    - api_key (str): The API key used to access the GraphAPI.
    - time_range (str): The time range for which the ads are retrieved.
    - filters (list): List of filters applied to the ads.
    
    Returns:
    - list: A list of ads retrieved based on the provided parameters.
    """
    graph_api = GraphAPI(api_key)
    return graph_api.get_ads(act_id, time_range, filters)

@st.cache_data
def cached_get_adaccounts():
    graph_api = GraphAPI(api_key)
    data = graph_api.get_adaccounts()
    ad_accounts_info = [
        {"name": account["name"],
        "business_name": account.get("business", {}).get("name", "Personal"),
        "label": account.get("business", {}).get("name", "Personal") + " > " + account["name"],
        "act_id": account["id"]} for account in data
    ]
    return ad_accounts_info

# Filters
def construct_filter(field, operator, value):
    return "{'field': '"+ field + "', 'operator': '" + operator + "', 'value': '" + value + "'}"
filter_options = {
    "Campaign Name": "campaign.name",
    "Adset Name": "adset.name",
    "Ad Name": "ad.name",
    #"Impressions": "impressions",
    #"Spend": "spend",
}
operator_options = [
    "EQUAL", "NOT_EQUAL", "GREATER_THAN", "GREATER_THAN_OR_EQUAL", "LESS_THAN", 
    "LESS_THAN_OR_EQUAL", "IN_RANGE", "NOT_IN_RANGE", "CONTAIN", "NOT_CONTAIN", 
    "IN", "NOT_IN", "STARTS_WITH", "ENDS_WITH", "ANY", "ALL", "AFTER", "BEFORE", 
    "ON_OR_AFTER", "ON_OR_BEFORE", "NONE", "TOP"
]

# Sidebar
st.sidebar.header("Create Filters")

# FILTERS
for filter_name, filter_field in filter_options.items():
    with st.sidebar.expander(filter_name):
        operator = st.selectbox(f"Operator", operator_options, key=f"operator_{filter_name}")
        value = st.text_input(f"Value", key=f"value_{filter_name}")
        if value:
            filters.append(construct_filter(filter_field, operator, value))

# TIME RANGE
with st.sidebar.expander("Time Range"):
    start_date = st.date_input("Start Date", key="start_date")
    end_date = st.date_input("End Date", key="end_date")
    if start_date and end_date:
        time_range = "{'since':'" + start_date.strftime('%Y-%m-%d') + "','until':'" + end_date.strftime('%Y-%m-%d') + "'}"

# APP
st.title('Hello Dash')

data_adaccounts = cached_get_adaccounts()

if data_adaccounts:
    # Create a dictionary mapping labels to act_id
    labels_to_act_id = {info["label"]: info["act_id"] for info in data_adaccounts}
    # Create a list of labels for the selectbox
    labels = list(labels_to_act_id.keys())
    selected_label = st.selectbox("Selecione sua Conta de Anúncios:",
                          labels,
                          placeholder="Seleciona uma conta...",
)
    
# FETCH ADs DATA
if st.sidebar.button("Fetch Ads Data"):
    if api_key:
        selected_act_id = labels_to_act_id[selected_label]
        ads_data = cached_get_ads(selected_act_id, time_range, filters)
        if ads_data:
            st.dataframe(ads_data)
        else:
            st.error(f"Failed to fetch data from Meta API: {ads_data}")
    else:
        st.error("API Key is required")
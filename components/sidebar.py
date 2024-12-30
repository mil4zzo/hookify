import pandas as pd
import streamlit as st
from ast import literal_eval

def render():
    st.logo('res/img/logo-hookify-alpha.png')

    if "ads_data" in st.session_state and isinstance(st.session_state["ads_data"], pd.DataFrame):
        with st.sidebar:
            with st.expander("🗂️ Loaded ADs"):

                num_items = len(st.session_state['loaded_ads'])
                
                for item_index in range(num_items):
                    
                    # Check if we still have items to display
                    if item_index < num_items:
                        with st.container(border=True):
                            cols_header = st.columns([4, 1])
                            with cols_header[0]:
                                st.markdown(f'#### Pack {item_index + 1}')

                            unique_id = st.session_state['loaded_ads'][item_index]
                            info = unique_id.split('&')
                            df_pack_ads = st.session_state[f"{unique_id}_ads_data"]

                            # COUNTS
                            st.dataframe(
                                pd.DataFrame([{
                                "Campaigns": df_pack_ads["campaign_name"].nunique(), 
                                "Adsets": df_pack_ads["adset_name"].nunique(), 
                                "ADs": len(df_pack_ads)
                            }]), hide_index=True, use_container_width=True )

                            st.caption(F"{info[0]} ({info[1]})")

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
                                    st.markdown("\n".join(f'{str(filter["field"].split(".")[0]).capitalize()} *:gray[{str(filter["operator"]).lower()}]* **{filter["value"]}**' for filter in item_filters))
                                else:
                                    st.caption("None")

    if "filter_values" in st.session_state:
        filter_values = st.session_state["filter_values"]
        with st.sidebar:
            with st.expander("🔎 Active filters"):
                df_filter_options = pd.DataFrame(columns=["Filter", "Selected"])
                if filter_values["cost_column"] and filter_values["cost_column"] != "":
                    df_filter_options.loc[len(df_filter_options)] = ["Goal", filter_values["cost_column"].split(".")[-1]]

                if filter_values["min_impressions"] > 0:
                    df_filter_options.loc[len(df_filter_options)] = ["Impressions", "> " + str(filter_values["min_impressions"]) if filter_values["min_impressions"] > 0 else filter_values["min_impressions"]]

                if filter_values["min_spend"] > 0:
                    df_filter_options.loc[len(df_filter_options)] = ["Spend", "> " + str(filter_values["min_spend"]) if filter_values["min_spend"] > 0 else filter_values["min_spend"]]

                if filter_values["filters_campaign"] and filter_values["filters_campaign"] != []:
                    df_filter_options.loc[len(df_filter_options)] = ["Campaigns", filter_values["filters_campaign"]]

                if filter_values["filters_adset"] and filter_values["filters_adset"] != []:
                    df_filter_options.loc[len(df_filter_options)] = ["Adsets", filter_values["filters_adset"]]

                if filter_values["filters_adname"] and filter_values["filters_adname"] != []:
                    df_filter_options.loc[len(df_filter_options)] = ["ADs", filter_values["filters_adname"]]

                st.dataframe(df_filter_options, hide_index=True, use_container_width=True)
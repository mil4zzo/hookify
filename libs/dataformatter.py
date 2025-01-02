from enum import unique
import streamlit as st
import pandas as pd
import numpy as np

from libs.session_manager import get_session_ads_data

def add_ads_pack(unique_id, pack):
    ## FORMATA NO PADRÃO UNIVERSAL
    ads_data = format_ads_data(pack)
    ## MARCA O PACK COM O UNIQUE_ID
    ads_data["from_pack"] = unique_id

    ## REGISTRA PACK INDIVIDUAL
    if "loaded_ads" not in st.session_state:
        st.session_state["loaded_ads"] = []
    st.session_state["loaded_ads"].append(unique_id)
    ## SALVA DATAFRAME DO PACK
    st.session_state[f"{unique_id}_ads_data"] = ads_data.copy()

    if not get_session_ads_data():
        dfmerged_ads_data = pd.concat([st.session_state["ads_data"], ads_data], ignore_index=True, join="outer")
        st.session_state["ads_data"] = dfmerged_ads_data
        st.session_state["ads_original_data"] = dfmerged_ads_data
    else:
        st.session_state["ads_data"] = ads_data
        st.session_state["ads_original_data"] = ads_data

def remove_ads_pack(item_index):
    ## PROCURA PACK INDIVIDUAL
    if "loaded_ads" in st.session_state:
        unique_id = st.session_state["loaded_ads"][item_index]
        st.session_state['loaded_ads'].remove(unique_id)
        ads_original_data = st.session_state["ads_original_data"]
        ads_data = ads_original_data[ads_original_data["from_pack"] != unique_id]
        ads_data = ads_data.reset_index(drop=True)
        st.session_state["ads_data"] = ads_data.copy()
        st.session_state["ads_original_data"] = ads_data.copy()


# Função para transformar "object lists" em colunas
def expand_conversions(row, columns):
    for column in columns:
        if isinstance(row[column], list):
            for conversion in row[column]:
                column_name = (f"""{column}.{conversion["action_type"]}""")
                row[column_name] = pd.to_numeric(conversion["value"], errors="coerce")
        elif isinstance(row[column], dict):
            for key, value in row[column].items():
                column_name = f"{column}.{key}"
                row[column_name] = pd.to_numeric(value, errors="coerce") if isinstance(value, (int, float)) else value
    return row

def format_ads_data(json_data):
    df = pd.DataFrame(json_data)
    # STRINGS
    df["ad_name"] = df["ad_name"].astype(str)
    df["adset_name"] = df["adset_name"].astype(str)
    df["campaign_name"] = df["campaign_name"].astype(str)
    df["ad_id"] = df["ad_id"].astype(str)
    df["adset_id"] = df["adset_id"].astype(str)
    df["campaign_id"] = df["campaign_id"].astype(str)
    
    # INTEGERS
    df["clicks"] = pd.to_numeric(df["clicks"], errors="coerce", downcast="integer").fillna(0)
    df["impressions"] = pd.to_numeric(df["impressions"], errors="coerce", downcast="integer").fillna(0)
    df["inline_link_clicks"] = pd.to_numeric(df["inline_link_clicks"], errors="coerce", downcast="integer").fillna(0)
    df["reach"] = pd.to_numeric(df["reach"], errors="coerce", downcast="integer").fillna(0)

    # FLOATS
    df["cpm"] = pd.to_numeric(df["cpm"], errors="coerce", downcast="float").fillna(0)
    df["ctr"] = pd.to_numeric(df["ctr"], errors="coerce", downcast="float").fillna(0)
    df["frequency"] = pd.to_numeric(df["frequency"], errors="coerce", downcast="float").fillna(0)
    df["spend"] = pd.to_numeric(df["spend"], errors="coerce", downcast="float").fillna(0)

    # PLAY CURVE ACTIONS
    play_curve_actions = df['video_play_curve_actions'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else [0] * 22)
    play_curve_actions_column_names = [f'retention_at_{i}' for i in range(15)] + \
                ['retention_at_15to20', 'retention_at_20to25', 'retention_at_25to30', 
                    'retention_at_30to40', 'retention_at_40to50', 'retention_at_50to60', 
                    'retention_over_60']
    df_play_curve_actions = pd.DataFrame(play_curve_actions.tolist(), columns=play_curve_actions_column_names)
    df_play_curve_actions = df_play_curve_actions.apply(lambda x: pd.to_numeric(x, downcast='integer', errors='coerce'))
    df['video_play_curve_actions'] = df_play_curve_actions.values.tolist()

    # PLAY ACTIONS
    df_play_actions = pd.DataFrame(df['video_play_actions'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else 0))
    df_play_actions.rename(columns={'video_play_actions': 'total_plays'}, inplace=True)
    df_play_actions['total_plays'] = pd.to_numeric(df_play_actions['total_plays'], errors='coerce', downcast='integer').fillna(0)

    # 50% PLAY ACTIONS
    df_p50_watched = pd.DataFrame(df['video_p50_watched_actions'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else 0))
    df_p50_watched.rename(columns={'video_p50_watched_actions': 'video_watched_p50'}, inplace=True)
    df_p50_watched['video_watched_p50'] = pd.to_numeric(df_p50_watched['video_watched_p50'], errors='coerce', downcast='integer').fillna(0)
    
    # THRUPLAY ACTIONS
    df_thruplay_actions = pd.DataFrame(df['video_thruplay_watched_actions'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else 0))
    df_thruplay_actions.rename(columns={'video_thruplay_watched_actions': 'total_thruplays'}, inplace=True)
    df_thruplay_actions['total_thruplays'] = pd.to_numeric(df_thruplay_actions['total_thruplays'], errors='coerce', downcast='integer').fillna(0)

    # WEBSITE CTR
    df_website_ctr = pd.DataFrame(df['website_ctr'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else 0.0))
    df_website_ctr['website_ctr'] = pd.to_numeric(df_website_ctr['website_ctr'], errors='coerce', downcast='float').fillna(0)

    ######################## CONCATENA NOVAS COLUNAS ########################
    df = df.drop(columns=['video_play_actions', 'video_thruplay_watched_actions', 'website_ctr', 'video_p50_watched_actions'])
    df = pd.concat([df, df_play_curve_actions, df_play_actions, df_p50_watched, df_thruplay_actions, df_website_ctr], axis=1)

    ######################## EXPLODE COLUNAS DE ARRAY ########################
    df = df.apply(lambda row: expand_conversions(row, ['actions', 'conversions', 'cost_per_conversion', 'creative']), axis=1)
    df = df.drop(columns=['actions', 'conversions', 'cost_per_conversion', 'creative'])

    ######################## COLUNAS CALCULADAS ########################
    # CONNECT RATE
    df['connect_rate'] = df.apply(lambda row: row['actions.landing_page_view'] / row['inline_link_clicks'] if row['inline_link_clicks'] != 0 else pd.NA, axis=1)
    df['connect_rate'] = pd.to_numeric(df['connect_rate'], errors='coerce', downcast='float')
    # PROFILE CTR
    df['profile_ctr'] = df['ctr'] - df['website_ctr']
    # COST PER CONVERSION
    df['cost_per_conversion.purchase'] = df['spend'] / df['actions.purchase'] if 'actions.purchase' in df.columns else np.nan
    df['cost_per_conversion.initiate_checkout'] = df['spend'] / df['actions.initiate_checkout'] if 'actions.initiate_checkout' in df.columns else np.nan
    df['conversions.purchase'] = df['actions.purchase'] if 'actions.purchase' in df.columns else np.nan
    df['conversions.initiate_checkout'] = df['actions.initiate_checkout'] if 'actions.initiate_checkout' in df.columns else np.nan
    # RETENTION
    df['video_watched_p50'] = df['video_watched_p50'] / df['total_plays'] * 100

    ######################## FILL NaNs ############################
    columns_to_fill = [col for col in df.columns if not col.startswith('cost_per_') and not col.startswith('connect_rate')]
    df[columns_to_fill] = df[columns_to_fill].fillna(0)

    return df.copy()

def create_agg_rules(df):
    all_columns = df.columns
    aggs = {}

    type_first = ['ad_name', 'account_id', 'creative.actor_id', 'creative.thumbnail_url', 'creative.video_id', 'creative.body', 'creative.call_to_action_type', 'creative.instagram_permalink_url', 'creative.object_type', 'creative.status', 'creative.title']
    type_sum = ['clicks', 'impressions', 'inline_link_clicks', 'reach', 'spend', 'total_plays', 'total_thruplays']
    type_unique_list = ['ad_id', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name']
    type_agg_unique_list = [ 'adcreatives_videos_ids', 'adcreatives_videos_thumbs' ]

    for col in all_columns:
        if col.startswith('actions.') or col.startswith('conversions.'):
            aggs[col] = 'sum'
        elif col.startswith('cost_per_'):
            conv_col = 'conversions.' + col[len('cost_per_conversion.'):]
            if conv_col in all_columns:
                aggs[col] = lambda x, conv_col=conv_col: (
                    (df.loc[x.index, 'spend'].sum() / df.loc[x.index, conv_col].sum()) if df.loc[x.index, 'spend'].sum() != 0 and df.loc[x.index, conv_col].sum() != 0 else 0
                )
            else:
                print(f"Warning: No corresponding conversions column found for {col}. This column will be excluded from the aggregation.")
        elif col.startswith('retention_') or col == 'video_watched_p50':
            aggs[col] = lambda x: np.average(x, weights=df.loc[x.index, 'total_plays']) if df.loc[x.index, 'total_plays'].sum() != 0 else 0
        elif col == 'video_play_curve_actions':
            aggs[col] = lambda x: np.average(x.tolist(), axis=0, weights=df.loc[x.index, 'total_plays']) if df.loc[x.index, 'total_plays'].sum() != 0 else 0
        elif col == 'ctr':
            aggs[col] = lambda x: df.loc[x.index, 'clicks'].sum() / df.loc[x.index, 'impressions'].sum() * 100
        elif col == 'cpm':
            aggs[col] = lambda x: df.loc[x.index, 'spend'].sum() * 1000 / df.loc[x.index, 'impressions'].sum()
        elif col == 'frequency':
            aggs[col] = lambda x: df.loc[x.index, 'impressions'].sum() / df.loc[x.index, 'reach'].sum()
        elif col == 'website_ctr':
            aggs[col] = lambda x: df.loc[x.index, 'inline_link_clicks'].sum() / df.loc[x.index, 'impressions'].sum() * 100
        elif col == 'profile_ctr':
            aggs[col] = lambda x: (df.loc[x.index, 'clicks'].sum() - df.loc[x.index, 'inline_link_clicks'].sum()) / df.loc[x.index, 'impressions'].sum() * 100
        elif col == 'connect_rate':
            aggs[col] = lambda x: df.loc[x.index, 'actions.landing_page_view'].sum() / df.loc[x.index, 'inline_link_clicks'].sum() * 100 # PROBLEMÁTICA
        elif col in type_first:
            aggs[col] = 'first'
        elif col in type_sum:
            aggs[col] = 'sum'
        elif col in type_unique_list:
            aggs[col] = lambda x: list(set(x))
        elif col in type_agg_unique_list:
            aggs[col] = lambda x: list(set([item for sublist in x for item in sublist]))

    return aggs

def aggregate_dataframe(df, group_by):
    agg_rules = create_agg_rules(df)

    # Check if the group_by column exists
    if group_by not in df.columns:
        raise KeyError(f"The column '{group_by}' does not exist in the DataFrame.")
    
    # Group by the specified column(s)
    df_grouped = df.groupby(group_by).agg(agg_rules)
    
    # Reset index without dropping the group_by column
    df_grouped = df_grouped.reset_index(drop=True)
    
    # If group_by column exists both as index and as a regular column, drop the regular column
    if group_by in df_grouped.columns and df_grouped.index.name == group_by:
        df_grouped = df_grouped.drop(columns=[group_by])
    
    return df_grouped

def abbreviate_number(number, decimals=0):
    if number >= 1_000_000_000:
        return f"{number / 1_000_000_000:.{decimals if decimals > 0 else 2}f}B"
    elif number >= 1_000_000:
        return f"{number / 1_000_000:.{decimals if decimals > 0 else 2}f}M"
    elif number >= 10_000:
        return f"{number / 1_000:.{decimals if decimals > 0 else 2}f}K"
    else:
        return f"{number:.{decimals}f}"

def capitalize(s):
    if not s:
        return s  # Return the original string if it's empty or None
    return s[0].upper() + s[1:]

def getInitials(s):
    name_parts = s.split(" ")
    if len(name_parts) > 1:
        initials = name_parts[0][0] + name_parts[1][0]
    else:
        initials = name_parts[0][0]
    return initials
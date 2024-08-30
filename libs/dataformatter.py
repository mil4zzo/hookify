import streamlit as st
import pandas as pd
import numpy as np

# Função para transformar 'object lists' em colunas
def expand_conversions(row, columns):
    for column in columns:
        if isinstance(row[column], list):
            for conversion in row[column]:
                column_name = f"{column}.{conversion['action_type']}"
                row[column_name] = pd.to_numeric(conversion['value'], errors='coerce')
        elif isinstance(row[column], dict):
            for key, value in row[column].items():
                column_name = f"{column}.{key}"
                row[column_name] = pd.to_numeric(value, errors='coerce') if isinstance(value, (int, float)) else value
    return row

def format_ads_data(json_data):
    df = pd.DataFrame(json_data)
    # STRINGS
    df['ad_name'] = df['ad_name'].astype(str)
    df['adset_name'] = df['adset_name'].astype(str)
    df['campaign_name'] = df['campaign_name'].astype(str)
    df['ad_id'] = df['ad_id'].astype(str)
    df['adset_id'] = df['adset_id'].astype(str)
    df['campaign_id'] = df['campaign_id'].astype(str)
    
    # INTEGERS
    df['clicks'] = pd.to_numeric(df['clicks'], errors='coerce', downcast='integer').fillna(0)
    df['impressions'] = pd.to_numeric(df['impressions'], errors='coerce', downcast='integer').fillna(0)
    df['inline_link_clicks'] = pd.to_numeric(df['inline_link_clicks'], errors='coerce', downcast='integer').fillna(0)
    df['reach'] = pd.to_numeric(df['reach'], errors='coerce', downcast='integer').fillna(0)

    # FLOATS
    df['cpm'] = pd.to_numeric(df['cpm'], errors='coerce', downcast='float').fillna(0)
    df['ctr'] = pd.to_numeric(df['ctr'], errors='coerce', downcast='float').fillna(0)
    df['frequency'] = pd.to_numeric(df['frequency'], errors='coerce', downcast='float').fillna(0)
    df['spend'] = pd.to_numeric(df['spend'], errors='coerce', downcast='float').fillna(0)

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

    # THRUPLAY ACTIONS
    df_thruplay_actions = pd.DataFrame(df['video_thruplay_watched_actions'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else 0))
    df_thruplay_actions.rename(columns={'video_thruplay_watched_actions': 'total_thruplays'}, inplace=True)
    df_thruplay_actions['total_thruplays'] = pd.to_numeric(df_thruplay_actions['total_thruplays'], errors='coerce', downcast='integer').fillna(0)

    # WEBSITE CTR
    df_website_ctr = pd.DataFrame(df['website_ctr'].apply(lambda x: x[0]['value'] if isinstance(x, list) and len(x) > 0 and isinstance(x[0], dict) and 'value' in x[0] else 0.0))
    df_website_ctr['website_ctr'] = pd.to_numeric(df_website_ctr['website_ctr'], errors='coerce', downcast='float').fillna(0)

    ######################## CONCATENA NOVAS COLUNAS ########################
    df = df.drop(columns=['video_play_actions', 'video_thruplay_watched_actions', 'website_ctr'])
    df = pd.concat([df, df_play_curve_actions, df_play_actions, df_thruplay_actions, df_website_ctr], axis=1)

    ######################## EXPLODE COLUNAS DE ARRAY ########################
    df = df.apply(lambda row: expand_conversions(row, ['actions', 'conversions', 'cost_per_conversion', 'creative']), axis=1)
    df = df.drop(columns=['actions', 'conversions', 'cost_per_conversion', 'creative'])

    ######################## COLUNAS CALCULADAS ########################
    # CONNECT RATE
    df['connect_rate'] = df.apply(lambda row: row['actions.landing_page_view'] / row['inline_link_clicks'] if row['inline_link_clicks'] != 0 else pd.NA, axis=1)
    df['connect_rate'] = pd.to_numeric(df['connect_rate'], errors='coerce', downcast='float')
    # PROFILE CTR
    df['profile_ctr'] = df['ctr'] - df['website_ctr']
    # CONVERSÃO DA PÁGINA
    df['page_conversion'] = df.apply(lambda row: row['actions.landing_page_view'] / row['inline_link_clicks'] if row['inline_link_clicks'] != 0 else pd.NA, axis=1)
    df['page_conversion'] = pd.to_numeric(df['connect_rate'], errors='coerce', downcast='float')

    ######################## FILL NaNs ############################
    columns_to_fill = [col for col in df.columns if not col.startswith('cost_per_') and not col.startswith('connect_rate')]
    df[columns_to_fill] = df[columns_to_fill].fillna(0)

    return df.copy()

def create_agg_rules(df):
    all_columns = df.columns
    aggs = {}

    type_first = ['ad_name', 'account_id', 'creative.thumbnail_url', 'creative.video_id', 'creative.body', 'creative.call_to_action_type', 'creative.instagram_permalink_url', 'creative.object_type', 'creative.status', 'creative.title']
    type_sum = ['clicks', 'impressions', 'inline_link_clicks', 'reach', 'spend', 'total_plays', 'total_thruplays']
    type_unique_list = ['ad_id', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name']
    #type_mean = ['cpm']

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
        elif col.startswith('retention_'):
            aggs[col] = lambda x: np.average(x, weights=df.loc[x.index, 'total_plays'])
        elif col == 'video_play_curve_actions':
            aggs[col] = lambda x: np.average(x.tolist(), axis=0, weights=df.loc[x.index, 'total_plays'])
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
        elif col in type_first:
            aggs[col] = 'first'
        elif col in type_sum:
            aggs[col] = 'sum'
        elif col in type_unique_list:
            aggs[col] = lambda x: list(set(x))

    return aggs

### COLUMNS CONFIG ###
# RANKING
colcfg_ranking = {
    "ad_name": st.column_config.TextColumn(
        "Ad Name",
        width="medium",
        help="The ad_name value",
        max_chars=50,
    ),
    "retention_at_3": st.column_config.NumberColumn(
        "Hook retention",
        help="The retention in percentage at second 3",
        min_value=0,
        max_value=100,
        format='%d%%',
    ),
    "spend": st.column_config.NumberColumn(
        "Spend",
        help="Total amount spend",
        format='$ %.2f',
    ),
    "total_plays": st.column_config.NumberColumn(
        "Plays",
        width="small",
        help="Total plays",
        format='%d',
    ),
    "total_thruplays": st.column_config.NumberColumn(
        "Thruplays",
        width="small",
        help="Total thruplays",
        format='%d',
    ),
    "ctr": st.column_config.NumberColumn(
        "CTR",
        width="small",
        help="Click through rate",
        format='%.2f%%',
    ),
    "video_play_curve_actions": st.column_config.AreaChartColumn(
        "Retention graph",
        width="medium",
        help="Retention in percent",
        y_min=0,
        y_max=100
        ),
}

colorder_ranking2 = [
    'ad_name',
    'retention_at_3',
    'spend',
    'ctr',
    'video_play_curve_actions',
    'total_plays',
    'total_thruplays',
]

colcfg_ranking2 = {
    "ad_name": st.column_config.TextColumn(
        "Ad Name",
        width="medium",
        help="The ad_name value",
        max_chars=50,
    ),
    "retention_at_3": st.column_config.NumberColumn(
        "Hook retention",
        help="The retention in percentage at second 3",
        min_value=0,
        max_value=100,
        format='%d%%',
    ),
    "ctr": st.column_config.NumberColumn(
        "CTR",
        width="small",
        help="Click through rate",
        format='%.2f%%',
    ),
    "spend": st.column_config.NumberColumn(
        "Total spend",
        help="Total amount spend",
        format='$ %.2f',
    ),
    "video_play_curve_actions": st.column_config.AreaChartColumn(
        "Retention graph",
        width="medium",
        help="Retention in percent",
        y_min=0,
        y_max=100
    ),
    "total_plays": st.column_config.NumberColumn(
        "Plays",
        width="small",
        help="Total plays",
        format='%d',
    ),
    "total_thruplays": st.column_config.NumberColumn(
        "Thruplays",
        width="small",
        help="Total thruplays",
        format='%d',
    )
}
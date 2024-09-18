import pandas as pd
import streamlit as st
import altair as alt
from libs.dataformatter import abbreviate_number, aggregate_dataframe
from styles.styler import COLORS

### INICIA INTERFACE ###
st.title('📊 Dashboard')
st.write('See the summary of your loaded ADs.')
st.divider()

st.query_params.clear()

def build_retention_chart(video_play_curve_actions):
    play_curve_metrics = pd.DataFrame(video_play_curve_actions).reset_index()
    play_curve_metrics.columns = ['index', 'value']
    play_curve_chart = alt.Chart(play_curve_metrics).mark_area( # type: ignore
        interpolate='basis', # type: ignore
        line=True, # type: ignore
        point=True, # type: ignore
        color=alt.Gradient( # type: ignore
            gradient='linear', 
            stops=[alt.GradientStop(color='#172654', offset=0), # type: ignore
                alt.GradientStop(color='#61a7f9', offset=1)], # type: ignore
            x1=1,
            x2=1,
            y1=1,
            y2=0
        )
    ).encode(
        x=alt.X('index', title='Retention per second (%)'), # type: ignore
        y=alt.Y('value', title=None), # type: ignore
    ).configure(
        background = COLORS['BLACK_500']
    )
    return st.altair_chart(play_curve_chart, use_container_width=True, theme=None)

if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):
    df_ads_data = st.session_state['ads_data'].copy()

    # Filter columns containing 'cost_per_'
    cost_columns = [col for col in df_ads_data.columns if 'cost_per_' in col]
    conversions_columns = [col for col in df_ads_data.columns if 'conversions' in col]

    with st.expander('Advanced options', expanded=False):
        with st.form("options", border=False):
            with st.container(border=True):
                controls = st.columns([1,2], gap='large')
                with controls[0]:
                    st.subheader('Settings')
                    if cost_columns:
                        cols = st.columns([1,2])
                        with cols[0]:
                            st.write('Conversion event')
                        with cols[1]:
                            cost_column = st.selectbox('Conversion event:', cost_columns, format_func=lambda x: x.split(".")[-1], label_visibility='collapsed')
                            event_name = cost_column.split('.')[-1] if cost_column else None
                            results_column = [col for col in conversions_columns if event_name in col][0]
                    thresholds = st.empty()
                with controls[1]:
                    st.subheader('Filters')
                    filters = st.empty()
                    
                st.form_submit_button('Apply filters', type='primary', use_container_width=True)

    # FILTERS
    with filters.container():
        campaign_list = list(st.session_state['ads_data']['campaign_name'].unique())
        adset_list = list(st.session_state['ads_data']['adset_name'].unique())
        ad_list = list(st.session_state['ads_data']['ad_name'].unique())
        cols = st.columns([1,6], gap='small')
        with cols[0]:
            st.write('Campaign')
        with cols[1]:
            select_campaign = st.multiselect('Select campaign:', campaign_list, label_visibility='collapsed')
        cols = st.columns([1,6], gap='small')
        with cols[0]:
            st.write('Adset')
        with cols[1]:
            select_adset = st.multiselect('Select adset:', adset_list, label_visibility='collapsed')
        cols = st.columns([1,6], gap='small')
        with cols[0]:
            st.write('Ad name')
        with cols[1]:
            select_ad = st.multiselect('Select ad:', ad_list, label_visibility='collapsed')

        def match_filter(campaign_name, column_name):
            if column_name == 'campaign':
                select_filter = select_campaign
            elif column_name == 'adset':
                select_filter = select_adset
            elif column_name == 'ad':
                select_filter = select_ad

            if isinstance(campaign_name, list) and select_filter:
                return any(campaign in campaign_name for campaign in select_filter)
            elif isinstance(campaign_name, str) and select_filter:
                return campaign_name in select_filter

        if select_campaign:
            df_ads_data = df_ads_data[df_ads_data['campaign_name'].apply(lambda x: match_filter(x, 'campaign'))]
        if select_adset:
            df_ads_data = df_ads_data[df_ads_data['adset_name'].apply(lambda x: match_filter(x, 'adset'))]
        if select_ad:
            df_ads_data = df_ads_data[df_ads_data['ad_name'].apply(lambda x: match_filter(x, 'ad'))]

    df_ads_data['unify'] = 1
    agg_df = aggregate_dataframe(df_ads_data, group_by='unify')
    summarized_row = agg_df.iloc[0]

    cols = st.columns([3,4,3], gap='small')

    with cols[0]:
        # HOOK GAUGE
        with st.container(border=True):
            st.subheader('🪝 Hook')
            st.metric('Retention at 3s', f'{round(summarized_row['retention_at_3'])}%')
            plays = st.columns(2)
            with plays[0]:
                st.metric('Plays', abbreviate_number(summarized_row['total_plays']))
            with plays[1]:
                st.metric('Thruplays', abbreviate_number(summarized_row['total_thruplays']))

        # BUDGET
        with st.container(border=True):
            st.subheader('💵 Budget')
            budget = st.columns(2)
            with budget[0]:
                st.metric('CPL', f'$ {abbreviate_number(summarized_row[cost_column], decimals=2)}')
                st.metric('Results', f'{abbreviate_number(summarized_row[results_column])}')
            with budget[1]:
                st.metric('Spend', f'$ {abbreviate_number(summarized_row['spend'], decimals=2)}')
                st.metric('CPM', f'$ {abbreviate_number(summarized_row['cpm'], decimals=2)}')
    with cols[1]:
        # RETENTION GRAPH
        with st.container(border=True):
            st.subheader('👁️ Retention Graph')
            build_retention_chart(summarized_row['video_play_curve_actions'])

            # AUDIENCE
            with st.container(border=False):
                st.subheader('👤 Audience')
                audience = st.columns(3)
                with audience[0]:
                    st.metric('Impressions', abbreviate_number(summarized_row['impressions']))
                with audience[1]:
                    st.metric('Reach', abbreviate_number(summarized_row['reach']))
                with audience[2]:
                    st.metric('Frequency', f'{summarized_row['frequency']:.2f}')

    with cols[2]:
        # CLICKS
        with st.container(border=True):
            st.subheader('👆 Clicks')
            # FIRST ROW - GENERAL
            ctrs = st.columns(2)
            with ctrs[0]:
                st.metric('CTR', f'{summarized_row['ctr']:.2f}%')
            with ctrs[1]:
                st.metric('Clicks', abbreviate_number(summarized_row['clicks']))

            # SECOND ROW - WEBSITE CTR
            with st.container(border=True):
                ctrs_website = st.columns([1,2])
                with ctrs_website[0]:
                    st.subheader(f'{summarized_row['website_ctr']:.2f}%')
                with ctrs_website[1]:
                    st.write('Website CTR')
                    st.caption(f'{abbreviate_number(summarized_row['inline_link_clicks'])} clicks')

            # THIRD ROW - PROFILE CTR
            with st.container(border=True):
                ctrs_website = st.columns([1,2])
                with ctrs_website[0]:
                    st.subheader(f'{summarized_row['profile_ctr']:.2f}%')
                with ctrs_website[1]:
                    st.write('Profile CTR')
                    st.caption(f'{abbreviate_number(summarized_row['clicks'] - summarized_row['inline_link_clicks'])} clicks')

        # LANDING PAGE
        with st.container(border=True):
            st.subheader('🎯 Landing page')
            # CONNECT RATE
            connect_rate = st.columns([3,5,2])
            with connect_rate[0]:
                st.write('Connect rate')
            with connect_rate[1]:
                st.progress(summarized_row['connect_rate']/100)
            with connect_rate[2]:
                st.write(f'{summarized_row['connect_rate']:.0f}%')
            # CONVERSION RATE
            page_conversion = st.columns([3,5,2])
            with page_conversion[0]:
                st.write('Conversion rate')
            with page_conversion[1]:
                st.progress(summarized_row[results_column] / summarized_row['actions.landing_page_view'] if summarized_row['actions.landing_page_view'] > summarized_row[results_column] else 100)
            with page_conversion[2]:
                st.write(f'{summarized_row[results_column] / summarized_row['actions.landing_page_view'] * 100:.2f}%')

        # LOADED ADs
        with st.container(border=True):
            st.subheader('🗂️ Loaded ADs')
            loaded = st.columns(3)
            with loaded[0]:
                st.metric('ADs', len(set(summarized_row['ad_id'])))
            with loaded[1]:
                st.metric('Adsets', len(set(summarized_row['adset_id'])))
            with loaded[2]:
                st.metric('Campaigns', len(set(summarized_row['campaign_id'])))

else:
    st.warning('⬅️ First, load ADs in the sidebar.')
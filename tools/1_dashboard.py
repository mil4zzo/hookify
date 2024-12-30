import pandas as pd
import streamlit as st
import altair as alt
from components.advanced_options import AdvancedOptions
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

<<<<<<< HEAD
if 'ads_original_data' in st.session_state and isinstance(st.session_state['ads_original_data'], pd.DataFrame) and len(st.session_state['ads_data']) > 0:
=======
if 'ads_original_data' in st.session_state and isinstance(st.session_state['ads_original_data'], pd.DataFrame):
>>>>>>> 5da38fc41aa7bde96a2a9dda6ef5c566f7eaea98

    # PREPARA DATASET
    df_ads_data = st.session_state['ads_original_data'].copy()
    advanced_options = AdvancedOptions()
    advanced_options.build()
    options = advanced_options.apply_filters(df_ads_data)
    if options is None:
        st.error('Erro ao aplicar filtro.')
    else:
        cost_column = options['cost_column']
        results_column = options['results_column']
        df_ads_data = options['df_ads_data']

        df_ads_data['unify'] = 1
        agg_df = aggregate_dataframe(df_ads_data, group_by='unify')
        summarized_row = agg_df.iloc[0]

        cols = st.columns([3,4,3], gap='small')

        with cols[0]:
            # HOOK GAUGE
            with st.container(border=True):
                st.subheader('🪝 Hook')
                st.metric('Retention at 3s', f'{round(summarized_row["retention_at_3"])}%')
                plays = st.columns(2)
                with plays[0]:
                    st.metric('Plays', abbreviate_number(summarized_row["total_plays"]))
                with plays[1]:
                    st.metric('Thruplays', abbreviate_number(summarized_row["total_thruplays"]))

            # BUDGET
            with st.container(border=True):
                st.subheader('💵 Budget')
                budget = st.columns(2)
                with budget[0]:
                    st.metric('CPL', f'$ {abbreviate_number(summarized_row[cost_column], decimals=2)}')
                    st.metric('Results', f'{abbreviate_number(summarized_row[results_column])}')
                with budget[1]:
                    st.metric('Spend', f'$ {abbreviate_number(summarized_row["spend"], decimals=2)}')
                    st.metric('CPM', f'$ {abbreviate_number(summarized_row["cpm"], decimals=2)}')
        with cols[1]:
            # RETENTION GRAPH
            with st.container(border=True):
                st.subheader('👁️ Retention Graph')
                build_retention_chart(summarized_row["video_play_curve_actions"])

                # AUDIENCE
                with st.container(border=False):
                    st.subheader('👤 Audience')
                    audience = st.columns(3)
                    with audience[0]:
                        st.metric('Impressions', abbreviate_number(summarized_row["impressions"]))
                    with audience[1]:
                        st.metric('Reach', abbreviate_number(summarized_row["reach"]))
                    with audience[2]:
                        st.metric('Frequency', f'{summarized_row["frequency"]:.2f}')

        with cols[2]:
            # CLICKS
            with st.container(border=True):
                st.subheader('👆 Clicks')
                # FIRST ROW - GENERAL
                ctrs = st.columns(2)
                with ctrs[0]:
                    st.metric('CTR', f'{summarized_row["ctr"]:.2f}%')
                with ctrs[1]:
                    st.metric('Clicks', abbreviate_number(summarized_row["clicks"]))

                # SECOND ROW - WEBSITE CTR
                with st.container(border=True):
                    ctrs_website = st.columns([1,2])
                    with ctrs_website[0]:
                        st.subheader(f'{summarized_row["website_ctr"]:.2f}%')
                    with ctrs_website[1]:
                        st.write('Website CTR')
                        st.caption(f'{abbreviate_number(summarized_row["inline_link_clicks"])} clicks')

                # THIRD ROW - PROFILE CTR
                with st.container(border=True):
                    ctrs_website = st.columns([1,2])
                    with ctrs_website[0]:
                        st.subheader(f'{summarized_row["profile_ctr"]:.2f}%')
                    with ctrs_website[1]:
                        st.write('Profile CTR')
                        st.caption(f'{abbreviate_number(summarized_row["clicks"] - summarized_row["inline_link_clicks"])} clicks')

            # LANDING PAGE
            with st.container(border=True):
                st.subheader('🎯 Landing page')
                # CONNECT RATE
                connect_rate = st.columns([3,5,2])
                with connect_rate[0]:
                    st.write('Connect rate')
                with connect_rate[1]:
                    st.progress(summarized_row["connect_rate"]/100)
                with connect_rate[2]:
                    st.write(f'{summarized_row["connect_rate"]:.0f}%')
                # CONVERSION RATE
                page_conversion = st.columns([3,5,2])
                with page_conversion[0]:
                    st.write('Conversion rate')
                with page_conversion[1]:
                    st.progress(summarized_row[results_column] / summarized_row["actions.landing_page_view"] if summarized_row["actions.landing_page_view"] > summarized_row[results_column] else 100)
                with page_conversion[2]:
                    st.write(f'{summarized_row[results_column] / summarized_row["actions.landing_page_view"] * 100:.2f}%')

            # LOADED ADs
            with st.container(border=True):
                st.subheader('🗂️ Loaded ADs')
                loaded = st.columns(3)
                with loaded[0]:
                    st.metric('ADs', len(set(summarized_row["ad_id"])))
                with loaded[1]:
                    st.metric('Adsets', len(set(summarized_row["adset_id"])))
                with loaded[2]:
                    st.metric('Campaigns', len(set(summarized_row["campaign_id"])))

else:
    st.warning('⬅️ First, load ADs in the sidebar.')
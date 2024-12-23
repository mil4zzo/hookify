import numpy as np
import pandas as pd
import altair as alt
import streamlit as st
from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, JsCode
from components.advanced_options import AdvancedOptions
from libs.graph_api import GraphAPI
from libs.dataformatter import aggregate_dataframe, create_agg_rules
from styles.styler import AGGRID_THEME, COLORS
from components.components import component_adinfo, component_adinfo_byad

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('⭐ Rankings')
    st.write('Comprehensive ad performance view.')
with cols[1]:
    with st.container(border=True):
        group_by_ad = st.toggle("Group ADs by name", value=True)

st.divider()

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

# SE JÁ TEM DADOS DE ANÚNCIOS
if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):

    # INICIALIZA API KEY E GRAPH API
    api_key = st.session_state["access_token"]
    graph_api = GraphAPI(api_key)

    # BUSCA VIDEO SOURCE URL
    @st.cache_data(show_spinner=False)
    def get_cached_video_source_url(video_id, actor_id):
        response = graph_api.get_video_source_url(video_id, actor_id)
        return response

    # DIALOG PREVIEW VIDEO
    @st.experimental_dialog("AD preview")
    def show_video_dialog(selected_row):
        st.subheader(selected_row['ad_name'])
        with st.spinner('Loading video, please wait...'):
            if 'creative.video_id' in selected_row:
                video_id = selected_row['creative.video_id']
                actor_id = selected_row['creative.actor_id']
                video_source_url = get_cached_video_source_url(video_id, actor_id)
                if video_source_url is not None:
                    st.markdown(
                        f"""<iframe
                            width='100%'
                            height='auto'
                            style='border:none;border-radius:6px;overflow:hidden;aspect-ratio:9/16'
                            src='{video_source_url}'
                            allow='clipboard-write; encrypted-media; picture-in-picture; web-share'
                            allowfullscreen='true'
                            frameborder='0'
                            scrolling='no'>
                        </iframe>"""
                    ,unsafe_allow_html=True)
                else:
                    st.error('Falha ao carregar o vídeo')
            elif 'adcreatives_videos_ids':
                video_id = selected_row['adcreatives_videos_ids']
                actor_id = selected_row['creative.actor_id']
                for video in video_id:
                    video_source_url = get_cached_video_source_url(video, actor_id)
                    if video_source_url is not None:
                        st.markdown(
                            f"""<iframe
                                width='100%'
                                height='auto'
                                style='border:none;border-radius:6px;overflow:hidden;aspect-ratio:9/16'
                                src='{video_source_url}'
                                allow='clipboard-write; encrypted-media; picture-in-picture; web-share'
                                allowfullscreen='true'
                                frameborder='0'
                                scrolling='no'>
                            </iframe>"""
                        ,unsafe_allow_html=True)
                    else:
                        st.error('Falha ao carregar o vídeo')

    # SORT AGGRID
    def resort_by(df, column_name):
        df_sorted = df.sort_values(by=column_name, ascending=True if 'cost_per_' in column_name else False).copy().reset_index(drop=True)
        df_sorted['#'] = range(1, len(df_sorted) + 1)
        st.session_state['ranking_sorting'] = column_name
        return df_sorted

    # CRIA AGGRID
    def create_aggrid(cost_column, results_column):
        builder = GridOptionsBuilder.from_dataframe(df_ads_data[interest_columns])
        builder.configure_selection(selection_mode='single')
        builder.configure_grid_options(
            headerHeight=50,
            rowHeight=50,
            suppressCellSelection=True,
        )
        builder.configure_default_column(
            editable=False,
            sortable=True,
            filter=True,
            resizable=True,
            suppressMenu=True)
        builder.configure_column('#', pinned='left', minWidth=50, maxWidth=50)
        builder.configure_column(
            'ad_name',
            header_name='Ad Info',
            cellRenderer=JsCode(component_adinfo_byad) if group_by_ad else JsCode(component_adinfo),
            cellRendererParams={
                'ad_name': 'ad_name',
                'adset_name': 'adset_name',
                'thumbnail_url': 'thumbnail_url',
            },
            valueGetter='{"ad_name": data.ad_name, "adset_name": data.adset_name, "thumbnail_url": data["creative.thumbnail_url"] ? data["creative.thumbnail_url"] : "https://cdns.iconmonstr.com/wp-content/releases/preview/7.8.0/240/iconmonstr-quote-right-filled.png"}',
            minWidth=125, width=150
        )
        builder.configure_column('retention_at_3', header_name='Hook (3s)', valueFormatter='Math.round(x) + "%"')
        builder.configure_column('video_watched_p50', header_name='Corpo (50%)', valueFormatter='Math.round(x) + "%"')
        builder.configure_column(cost_column, header_name='CPR', valueFormatter='`$ ${x.toFixed(2)}`')
        builder.configure_column(results_column, header_name='Results')
        builder.configure_column('page_conversion', header_name='Page %', valueFormatter='`${x.toFixed(1)}%`')
        builder.configure_column('spend', header_name='Spend', valueFormatter='`$ ${x.toFixed(2)}`')
        builder.configure_column('total_plays', header_name='Plays')
        builder.configure_column('ctr', header_name='CTR', valueFormatter='`${x.toFixed(2)}%`')
        builder.configure_column('video_play_curve_actions', 
                        header_name='Retention',
                        cellRenderer='agSparklineCellRenderer',
                        cellRendererParams={
                            'sparklineOptions': {
                                'type': 'area',
                                'fills': [{
                                    'type': 'gradient',
                                    'color': '#91cc75',
                                    'gradient': {
                                        'colors': ['#ffffff', '#000000'],
                                        'stops': [0, 1]
                                    }
                                }],
                                'stroke': '#5470c6',
                                'highlightStyle': {
                                    'fill': 'orange',
                                },
                                'axis': {
                                    'stroke': '#ffffff00',
                                },
                                'padding': {
                                    'top': 5,
                                    'bottom': 5,
                                },
                            },
                        },
                        minWidth=120
                    )
        for col in df_ads_data.columns:
            if col not in interest_columns:
                builder.configure_column(col, hide=True)
        grid_options = builder.build()
        return AgGrid(
            data=df_ads_data,
            custom_css=AGGRID_THEME,
            gridOptions=grid_options,
            update_mode=GridUpdateMode.MODEL_CHANGED,
            fit_columns_on_grid_load=True,
            allow_unsafe_jscode=True
        )

    # PREPARA DATASET
    advanced_options = AdvancedOptions()
    advanced_options.build()

    df_ads_data = st.session_state['ads_original_data'].copy()

    options = advanced_options.apply_filters(df_ads_data)
    if options is None:
        st.error('Erro ao aplicar filtro.')
    else:
        cost_column = options['cost_column']
        results_column = options['results_column']
        df_ads_data = options['df_ads_data'].copy()

        # CRIA AGRUPAMENTO POR NOME DO ANÚNCIO (ad_name)
        df_grouped = aggregate_dataframe(df_ads_data, group_by='ad_name')
        if group_by_ad:
            df_ads_data = df_grouped

        # CALCULA CONVERSAO DA PÁGINA
        df_ads_data['page_conversion'] = np.divide(df_ads_data[results_column], df_ads_data["actions.landing_page_view"], out=np.zeros_like(df_ads_data[results_column]), where=df_ads_data["actions.landing_page_view"]!=0) * 100

        interest_columns = [
            '#',
            'ad_name',
            'retention_at_3',
            'video_watched_p50',
            'spend',
            cost_column,
            results_column,
            'ctr',
            'page_conversion',
            'total_plays',
            'video_play_curve_actions'
        ]

        # AVERAGE METRICS
        avg_retention_at_3 = df_grouped['retention_at_3'].mean()
        avg_ctr = df_grouped['ctr'].mean()
        avg_spend = df_grouped['spend'].mean()
        avg_cost = df_grouped[df_grouped[cost_column] > 0][cost_column].mean()
        # TOTAL METRICS
        total_plays = df_ads_data['total_plays'].sum()
        total_thruplays = df_ads_data['total_thruplays'].sum()

        ### INICIA INTERFACE ###
        col1, col2 = st.columns([5, 4], gap='medium')

        ## TABS AND AGGRID
        with col1:
            # SORTING TABS
            sorting_columns = {
                'Top Hooks': 'retention_at_3',
                'Top CTRs': 'ctr',
                'Top Spend': 'spend',
                'Top CPR': cost_column
            }
            # TABS MENU (SELECT TOP RANKING)
            sorting_option = st.radio(
                "Sort by:",
                list(sorting_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
            )
            # SORT INIT
            if sorting_option is not None:
                selected_column = sorting_columns[sorting_option]
            df_ads_data = resort_by(df_ads_data, selected_column)

            # SETUP AGGRID
            grid_response = create_aggrid(cost_column, results_column)

            # INIT SELECTED ROW
            selected_row_data = None
            if not df_ads_data.empty:
                selected_row_data = df_ads_data.head(1).to_dict(orient='records')[0]
            if grid_response and 'selected_rows' in grid_response and grid_response.selected_rows is not None:
                selected_row_data = grid_response.selected_rows.iloc[0]
                selected_row_data['#'] = grid_response.selected_rows.iloc[0].index

        ## DETAILED INFO
        with col2:
            with st.container(border=True):
                if selected_row_data is not None:
                    ## MAIN INFO
                    cols = st.columns([5,2])
                    with cols[0]:
                        st.markdown(
                                f"""
                                <div style='display: flex; flex-direction: row; align-items: center; justify-content: start; margin-bottom: 1.5rem'>
                                    <img
                                        width='64px'
                                        height='64px'
                                        style='border-radius:100%'
                                        src='{selected_row_data['creative.thumbnail_url']}'>
                                    </img>
                                    <span style='margin-left: 1rem; margin-right: 2rem; font-size: 1.5rem; line-height: 1.4rem; color: white; font-weight: 700; font-family: "Source Sans Pro", sans-serif;'>{selected_row_data['ad_name']}</span>
                                </div>
                                """, unsafe_allow_html=True)
                    with cols[1]:
                        if st.button('Watch videoㅤ▶', type='primary', use_container_width=True):
                            show_video_dialog(selected_row_data)

                    ## MAIN METRICS
                    col2a, col2b, col2c = st.columns(3)
                    with col2a:
                        st.metric(':sparkle: Hook retention', value=f"{int(round(selected_row_data['retention_at_3']))}%", delta=f"{int(round(((selected_row_data['retention_at_3']/avg_retention_at_3)-1)*100))}%")
                    with col2b:
                        st.metric(':eight_pointed_black_star: CTR', value=f"{selected_row_data['ctr']:.2f}%", delta=f"{int(round(((selected_row_data['ctr']/avg_ctr)-1)*100))}%")
                    with col2c:
                        if cost_column is not None:
                            st.metric(f':black_circle_for_record: {cost_column.split(".")[-1]}', value=f"$ {selected_row_data[cost_column]:.2f}", delta=f"${abs(selected_row_data[cost_column]-avg_cost):.2f}" if selected_row_data[cost_column]-avg_cost > 0 else f"-${abs(selected_row_data[cost_column]-avg_cost):.2f}", delta_color='inverse')
                        else:
                            st.metric(':black_circle_for_record: Plays', value=selected_row_data['total_plays'], delta='0')

                    ## GRÁFICO RETENÇÃO
                    build_retention_chart(selected_row_data['video_play_curve_actions'])

                    ## MAIS DETALHES
                    with st.expander('More info'):
                        
                        with st.container(border=False):
                            st.write('➡️ Spendings')
                            money = st.columns(2)
                            with money[0]:
                                st.metric(label="Total spend", value=f"$ {selected_row_data['spend']:.2f}")
                            with money[1]:
                                st.metric(label="CPM", value=f"$ {selected_row_data['cpm']:.2f}")
                        
                        with st.container(border=False):
                            st.write('➡️ Audience')
                            audience = st.columns(3)
                            with audience[0]:
                                st.metric(label="Impressions", value=selected_row_data['impressions'])
                            with audience[1]:
                                st.metric(label="Reach", value=selected_row_data['reach'])
                            with audience[2]:
                                st.metric(label="Frequency", value=f"{selected_row_data['frequency']:.2f}")

                        with st.container(border=False):
                            st.write('➡️ Views')
                            views = st.columns(2)
                            with views[0]:
                                st.metric(label="Plays", value=selected_row_data['total_plays'])
                            with views[1]:
                                st.metric(label="Thruplays", value=selected_row_data["total_thruplays"])

                        with st.container(border=False):
                            st.write('➡️ Clicks')
                            clicks = st.columns(3)
                            with clicks[0]:
                                st.metric(label="Total clicks", value=selected_row_data['clicks'], delta='TOTAL CLICKS')
                            with clicks[1]:
                                st.metric(label="Profile CTR", value=f"{selected_row_data['profile_ctr']:.2f}%", delta=f"{selected_row_data['clicks']-selected_row_data['inline_link_clicks']:.0f} clicks", delta_color='off')
                            with clicks[2]:
                                st.metric(label="Website CTR", value=f"{selected_row_data['website_ctr']:.2f}%", delta=f"{selected_row_data['inline_link_clicks']:.0f} clicks", delta_color='off')

                        # CAMPAIGN NAME
                        campaign_name_c1, campaign_name_c2 = st.columns([2, 3])
                        with campaign_name_c1:
                            st.write('CAMPAIGN')
                        with campaign_name_c2:
                            st.write(f"{selected_row_data['campaign_name']}")

                        # ADSET NAME
                        adset_namec1, adset_namec2 = st.columns([2, 3])
                        with adset_namec1:
                            st.write('ADSET')
                        with adset_namec2:
                            st.write(f"{selected_row_data['adset_name']}")
else:
    st.warning('⬅️ First, load ADs in the sidebar.')

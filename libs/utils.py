from functools import wraps
import time
import pandas as pd
import streamlit as st
import altair as alt
from libs.graph_api import get_cached_video_source_url
from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, JsCode
from components.components import component_adinfo, component_adinfo_byad
from styles.styler import AGGRID_THEME, COLORS

# SORT AGGRID
def resort_by(df, column_name):
    df_sorted = df.sort_values(by=column_name, ascending=True if 'cost_per_' in column_name else False).copy().reset_index(drop=True)
    df_sorted['#'] = range(1, len(df_sorted) + 1)
    st.session_state['ranking_sorting'] = column_name
    return df_sorted

def get_media_source_url(selected_row):
    # EXTRAI PÁGINA (actor_id)
    actor_id = selected_row['creative.actor_id']
    # CRIA LISTA VAZIA DE IDs (video_source_url)
    media_ids = []
    # EXTRAI ID DO VÍDEO PELO TIPO (video_id)
    if 'creative.video_id' in selected_row and selected_row['creative.video_id'] != 0:
        media_ids.append(selected_row['creative.video_id'])
    elif 'adcreatives_videos_ids' in selected_row and len(selected_row['adcreatives_videos_ids']) > 0:
        media_ids.extend(selected_row.get('adcreatives_videos_ids', []))
    elif 'creative.thumbnail_url' in selected_row and len(selected_row['creative.thumbnail_url']) > 0:
        media_ids.append(selected_row['creative.thumbnail_url'])
    media_source_urls = []
    # CRIA PLAYERS COM BASE NOS IDs (media_ids)
    for media_id in media_ids:
        ## BUSCA IMAGEM
        if 'https://' in media_id:
            media_source_urls.append(media_id)
        ## BUSCA VÍDEO
        else:
            video_source_url = get_cached_video_source_url(media_id, actor_id)
            if isinstance(video_source_url, dict) and 'status' in video_source_url:
                st.error("Couldn't load the video.\n\n Error: " + video_source_url['status'] + '\n\n' + video_source_url['message'])
            else:
                media_source_urls.append(get_cached_video_source_url(media_id, actor_id))
    return media_source_urls

# DIALOG PREVIEW VIDEO
@st.dialog("AD preview")
def show_video_dialog(selected_row):
    st.subheader(selected_row['ad_name'])
    with st.spinner('Loading video, please wait...'):
        medias = get_media_source_url(selected_row)
        if len(medias) > 0:
            # CRIA PLAYERS COM BASE NOS IDs (media_ids)
            for media_source_url in medias:
                st.markdown(
                        f"""<iframe
                            width='100%'
                            height='auto'
                            style='border:none;border-radius:6px;overflow:hidden;aspect-ratio:9/16'
                            src='{media_source_url}'
                            allow='clipboard-write; encrypted-media; picture-in-picture; web-share'
                            allowfullscreen='true'
                            frameborder='0'
                            scrolling='no'>
                        </iframe>"""
                    ,unsafe_allow_html=True)
                
# CRIA AGGRID
def create_aggrid(df_ads_data, interest_columns, cost_column, results_column, group_by_ad, key=None):

    SPARKLINE_CONFIG = {
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
                    }

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
    builder.configure_column('MARGEM_PERCENT_MEDIO', header_name='Margem', valueFormatter='`${(x * 100).toFixed(2)}%`')
    builder.configure_column('retention_at_3', header_name='Hook (3s)', valueFormatter='Math.round(x) + "%"')
    builder.configure_column('video_watched_p50', header_name='Corpo (50%)', valueFormatter='Math.round(x) + "%"')
    builder.configure_column('CPL_MAX_MEDIO', header_name='CPR Máx.', valueFormatter='`$ ${x.toFixed(2)}`')
    builder.configure_column(cost_column, header_name='CPR', valueFormatter='`$ ${x.toFixed(2)}`')
    builder.configure_column(results_column, header_name='Results')
    builder.configure_column('page_conversion', header_name='Page %', valueFormatter='`${x.toFixed(1)}%`')
    builder.configure_column('spend', header_name='Spend', valueFormatter='`$ ${x.toFixed(2)}`')
    builder.configure_column('total_plays', header_name='Plays')
    builder.configure_column('impressions', header_name='Impressions')
    builder.configure_column('connect_rate', header_name='Connect Rate', valueFormatter='`${x.toFixed(4)}`')
    builder.configure_column('ctr', header_name='CTR', valueFormatter='`${x.toFixed(2)}%`')
    builder.configure_column('video_play_curve_actions', 
                    header_name='Retention',
                    cellRenderer='agSparklineCellRenderer',
                    cellRendererParams=SPARKLINE_CONFIG,
                    minWidth=120
                )
    
    # Hide unused columns
    visible_columns = set(interest_columns)
    for col in df_ads_data.columns:
        if col not in visible_columns:
            builder.configure_column(col, hide=True)

    return AgGrid(
        data=df_ads_data,
        custom_css=AGGRID_THEME,
        gridOptions=builder.build(),
        update_mode=GridUpdateMode.MODEL_CHANGED,
        fit_columns_on_grid_load=True,
        allow_unsafe_jscode=True,
        key=key or f"grid_{id(df_ads_data)}"
    )

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
import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
import altair as alt
from graph_api import GraphAPI
from dataformatter import colorder_ranking2, colcfg_ranking2
import matplotlib.pyplot as plt
from st_aggrid import AgGrid

if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):
    ads_data = st.session_state['ads_data'].copy()

    api_key = st.session_state["access_token"]
    graph_api = GraphAPI(api_key)

    @st.cache_data
    def get_cached_video_source_url(ad_id):
        response = graph_api.get_video_source_url(ad_id)
        return response

    # CRIA DATASET
    interest_columns = [
        'ad_id',
        'ad_name',
        'campaign_name',
        'adset_name',
        'retention_at_3',
        'spend',
        'total_plays',
        'total_thruplays',
        'ctr',
        'video_play_curve_actions'
    ]
    df_ads_data = ads_data[interest_columns]
    # TOP HOOKS
    df_hooks = df_ads_data[interest_columns].sort_values(by='retention_at_3', ascending=False).copy().reset_index(drop=True)
    # TOP 5 CTRs
    df_ctr = df_ads_data.sort_values(by='ctr', ascending=False).reset_index()

    ### INICIA INTERFACE ###
    st.title('Rankings')

    ### CSS STYLE ###
    st.markdown(
        """<style>
            [data-testid=stIFrame]{
                width: 100%;
                height: 100%;
                aspect-ratio: 9/16;
            }
        </style>"""
        , unsafe_allow_html=True)

    # DEFAULT SORTING
    if 'ranking_sorting' in st.session_state:
        default_sorting = st.session_state['ranking_sorting']
        df_ads_data = resort_by(df_ads_data, default_sorting)
    else:
        default_sorting = 'retention_at_3'
        st.session_state['ranking_sorting'] = default_sorting

    tab_minimal1, tab_minimal2, tab_detailed = st.tabs(['Minimal 1','Minimal 2','Detailed'])

    with tab_minimal1:
        st.header('Top 5 Hooks')

        AgGrid(data=df_ads_data, fit_columns_on_grid_load=True)

        st.dataframe(df_hooks.style.format({
            'retention_at_3': '{:d}%',
            'spend': '$ {:.2f}',
            'ctr': '{:.2f}%'
        }
        ).text_gradient(subset = ['ctr'], 
            cmap = 'RdYlGn', 
            vmin = df_hooks['ctr'].min(), 
            vmax = df_hooks['ctr'].max()),
        column_order=colorder_ranking2,
        column_config=colcfg_ranking2,
        use_container_width=True)

        #st.dataframe(df_hooks.head(20).reset_index( drop=True ), column_config=colcfg_ranking, hide_index=True)

    with tab_minimal2:
        st.header('Top 5 Hooks')
        for index, row in df_hooks.head(20).iterrows():
            with st.container(border=True):
                col_m1,col_m2,col_m3,col_m4,col_m5,col_m6,col_m7 = st.columns([6,2,2,2,2,2,3], gap='medium')
                with col_m1:
                    st.subheader( f'{index+1}º {row['ad_name']}')
                with col_m2:
                    st.metric(label="HOOK RETENTION", value=f'{row['retention_at_3']}%')
                with col_m3:
                    st.metric(label="CPL", value='R$ 10,80')
                with col_m4:
                    st.metric(label="CTR", value=f"{row['ctr']:.2f}%")
                with col_m5:
                    st.metric(label="TOTAL PLAYS", value=row['total_plays'])
                with col_m6:
                    st.metric(label="RESULTS", value=row['retention_at_3'])
                with col_m7:
                    st.metric(label="TOTAL SPEND", value=f'R$ {row['spend']:.2f}')

    with tab_detailed:
        for index, row in df_hooks.head(1).iterrows():
            with st.container( border=True ):
                st.header(row['ad_name'])
                st.write(f'Campaign: {row['campaign_name']}')
                st.write(f'Adset: {row['adset_name']}')

                col1, col2, col3 = st.columns([2,8,1], gap='medium')

                with col1:
                    response = get_cached_video_source_url(row['ad_id'])
                    if 'status' in response and response['status'] == 'success' and 'data' in response:
                        video_source_url = response['data']
                        components.html(
                            f"""<iframe
                                width='100%'
                                height='auto'
                                style='border:none;border-radius:8px;overflow:hidden;aspect-ratio:9/16'
                                src='{video_source_url}'
                                allow='clipboard-write; encrypted-media; picture-in-picture; web-share'
                                allowfullscreen='true'
                                frameborder='0'
                                scrolling='no'>
                            </iframe>""",
                            height = 16*10*3,
                            width = 9*10*3
                        )
                    else:
                        st.error('falha')

                with col2:
                    col2a, col2b, col2c, col2d, col2e, col2f = st.columns([1,1,1,1,1,2], gap="small")
                    with col2a:
                        with st.container(height=None, border=True):
                            st.metric(label="HOOK RETENTION", value='57%')
                    with col2b:
                        with st.container(height=None, border=True):
                            st.metric(label="CPL", value='R$ 10,80')
                    with col2c:
                        with st.container(height=None, border=True):
                            st.metric(label="CTR", value='1,04%')
                    with col2d:
                        with st.container(height=None, border=True):
                            st.metric(label="TOTAL PLAYS", value='1,819')
                    with col2e:
                        with st.container(height=None, border=True):
                            st.metric(label="RESULTS", value='895')
                    with col2f:
                        with st.container(height=None, border=True):
                            st.metric(label="TOTAL SPEND", value='R$ 9,105,48')
                    play_curve_metrics = pd.DataFrame(row['video_play_curve_actions']).reset_index()
                    play_curve_metrics.columns = ['index', 'value']
                    #st.write(play_curve_metrics)
                    play_curve_chart = alt.Chart(play_curve_metrics).mark_area(
                        interpolate='basis',
                        line=True,
                        point=True,
                        color=alt.Gradient(
                            gradient='linear',
                            stops=[alt.GradientStop(color='#172654', offset=0),
                                alt.GradientStop(color='#61a7f9', offset=1)],
                            x1=1,
                            x2=1,
                            y1=1,
                            y2=0
                        )
                    ).encode(
                        x=alt.X('index', title='Retention per second (%)'),
                        y=alt.Y('value', title=None),    
                    )
                    st.altair_chart(play_curve_chart, use_container_width=True)                

        col1, col2 = st.columns(2, gap="medium")
    
else:
    st.title('Anúncios ainda não foram carregados.')


################# FROM GRAPH_API : OLD GET_VIDEO_SOURCE_URL #################
## GET VIDEO SOURCE URL
def get_video_source_url(self, ad_id):
    url = self.base_url + ad_id + self.user_token
    payload = {
        'fields': 'creative{video_id,thumbnail_url,effective_object_story_id,instagram_permalink_url,object_story_spec{video_data}}',
    }
    try:
        # Busca informações do CREATIVE
        print('Request URL:', url)
        print('Request Payload:', json.dumps(payload, indent=2))
        response = requests.get(url, params=payload)
        print('response:', response)
        response.raise_for_status()
        
        creative = response.json().get('creative', {})
        video_id = creative.get('video_id')
        thumbnail_url = creative.get('thumbnail_url')
        story_id = creative.get('effective_object_story_id')
        instagram_permalink = creative.get('instagram_permalink_url')
        object_story_spec = creative.get('object_story_spec', {})
        video_data = object_story_spec.get('video_data', {})
        
        # Verifica token de página (ads_read)
        if not self.page_token:
            new_page_token = self.get_page_access_token('1 milhão com 30')

        # Busca VIDEO SOURCE URL
        if self.page_token:
            # Tenta com 'video_id'
            print('PAGE ID:', self.page_token)
            if video_id:
                video_url = self.base_url + video_id + self.page_token
                video_payload = {
                    'fields': 'source',
                }
                video_response = requests.get(video_url, params=video_payload)
                video_response.raise_for_status()
                video_source = video_response.json().get('source')

                if video_source:
                    return {'status': 'success', 'data': video_source}
                
            # Tenta com 'attachments'
            if story_id:
                attachment_url = self.base_url + story_id + self.page_token
                attachment_payload = {
                    'fields': 'attachments,properties',
                }
                attachment_response = requests.get(attachment_url, params=attachment_payload)
                attachment_response.raise_for_status()
                
                attachments = attachment_response.json().get('attachments', {}).get('data', [])

                if attachments:
                    video_data = attachments[0].get('media', {}).get('video', {})
                    video_source = video_data.get('src')
                    
                    if video_source:
                        return {'status': 'success', 'data': video_source}
            
            # Fallback options
            #if instagram_permalink:
            #    embed_html = f'<blockquote class="instagram-media" data-instgrm-permalink="{instagram_permalink}" data-instgrm-version="14"></blockquote><script async src="//www.instagram.com/embed.js"></script>'
            #    return {"status": "success", "data": embed_html, "embed_type": "instagram"}
            #elif thumbnail_url:
            #    img_html = f'<img src="{thumbnail_url}" alt="Ad Thumbnail" style="max-width:320px;max-height:240px;">'
            #    return {"status": "success", "data": img_html, "embed_type": "thumbnail"}
            #else:
            return {'status': 'error', 'message': 'Não foi possível obter o vídeo ou uma representação visual do anúncio.'}
        
    except requests.exceptions.HTTPError as http_err:
        decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
        decoded_text = urllib.parse.unquote(http_err.response.text)
        print(f'HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}')
        if http_err.response.json().get('error', {}).get('code') == 190:
            return {'status': 'auth_error', 'message': decoded_text}
        return {'status': 'http_error', 'message': decoded_text}
    
    except Exception as err:
        print(f'Other error occurred: {err}')
        return {'status': 'error', 'message': str(err)}
    

operator_options = [
    'EQUAL', 'NOT_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN',
    'LESS_THAN_OR_EQUAL', 'IN_RANGE', 'NOT_IN_RANGE', 'CONTAIN', 'NOT_CONTAIN',
    'IN', 'NOT_IN', 'STARTS_WITH', 'ENDS_WITH', 'ANY', 'ALL', 'AFTER', 'BEFORE',
    'ON_OR_AFTER', 'ON_OR_BEFORE', 'NONE', 'TOP'
]


with col_video:
    video_source_url = get_cached_video_source_url(selected_row_data['creative.video_id'])
    if video_source_url is not None:
        components.html(
            f"""<iframe
                width='100%'
                height='auto'
                style='border:none;border-radius:6px;overflow:hidden;aspect-ratio:9/16'
                src='{video_source_url}'
                allow='clipboard-write; encrypted-media; picture-in-picture; web-share'
                allowfullscreen='true'
                frameborder='0'
                scrolling='no'>
            </iframe>""",
            height = 16*10*3,
            width = 9*10*3
        )
    else:
        st.error('Falha ao carregar o vídeo')
with col_metrics:
    st.metric(':sparkle: Hook retention', value=f'{int(round(selected_row_data['retention_at_3']))}%', delta=f'{int(round(((selected_row_data['retention_at_3']/avg_retention_at_3)-1)*100))}%')
    st.metric(':eight_pointed_black_star: CTR', value=f'{selected_row_data['ctr']:.2f}%', delta=f'{int(round(((selected_row_data['ctr']/avg_ctr)-1)*100))}%')
    if conversion_event is not None:
        st.metric(f':black_circle_for_record: {conversion_event.split(".")[-1]}', value=f'$ {selected_row_data[conversion_event]:.2f}', delta=f'${abs(selected_row_data[conversion_event]-avg_cost):.2f}' if selected_row_data[conversion_event]-avg_cost > 0 else f'-${abs(selected_row_data[conversion_event]-avg_cost):.2f}', delta_color='inverse')
    else:
        st.metric(':black_circle_for_record: Plays', value=selected_row_data['total_plays'], delta='0')
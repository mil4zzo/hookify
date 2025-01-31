from ast import literal_eval
import time
import requests
import json
import urllib.parse
import streamlit as st
from libs.dataformatter import split_date_range, timer_decorator

from libs.session_manager import get_session_access_token

class GraphAPI:
    def __init__(self, fb_api):
        self.base_url = "https://graph.facebook.com/v20.0/"
        self.user_token = "?access_token=" + fb_api
        self.page_token = None
        self.api_fields = ""
        self.limit = 5000
        self.time_range = ""
        self.filtering = ""
        self.level = "ad"
        self.action_attribution_windows = "['7d_click','1d_view']"
        self.use_account_attribution_setting = "true"
        self.action_breakdowns = "action_type"
        
    def get_account_info(self):
        url = self.base_url + 'me' + self.user_token
        payload = {
            'fields': 'email,first_name,last_name,name,picture{url}',
        }
        try:
            # Debugging: Print the URL and payload
            print('get_account_info() > Request URL:', url)
            print('get_account_info() > Request Payload:', json.dumps(payload, indent=2))
            response = requests.get(url, params=payload)
            print('get_account_info() > response:', response.json())
            response.raise_for_status()  # Check for HTTP errors
            return {'status': 'success', 'data': response.json()}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f'get_account_info() > HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}')  # Handle HTTP errors
            if http_err.response.json()['error']['code'] == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            print(f'get_account_info() > Other error occurred: {err}')  # Handle other errors
            return {'status': 'error', 'message': str(err)}

    def get_page_access_token(self, actor_id):
        url = self.base_url + 'me/accounts' + self.user_token
        try:
            response = requests.get(url)
            response.raise_for_status()
            pages = response.json().get('data', [])
            for page in pages:
                if page['id'] == actor_id:
                    self.page_token = f"?access_token={page['access_token']}"
                    print('get_page_access_token() > PAGE TOKEN:', self.page_token)
                    return self.page_token
            raise Exception(f"Page with ID {actor_id} not found")
        except requests.exceptions.RequestException as e:
            print(f"get_page_access_token() > Error getting page access token: {e}")
            raise Exception(f"get_page_access_token() > Error getting page access token: {e}")
        
    def get_ads_details(self, act_id, time_range, ads_ids):
        url = self.base_url + act_id + '/ads' + self.user_token
        payload = {
            'fields': 'name,creative{actor_id,body,call_to_action_type,instagram_permalink_url,object_type,status,title,video_id,thumbnail_url,effective_object_story_id{attachments,properties}},adcreatives{asset_feed_spec}',
            'limit': self.limit,
            'level': self.level,
            'action_attribution_windows': self.action_attribution_windows,
            'use_account_attribution_setting': self.use_account_attribution_setting,
            'action_breakdowns': self.action_breakdowns,
            'time_range': time_range if time_range else self.time_range,
            'filtering': "[{'field':'id','operator':'IN','value':['" + "','".join(ads_ids) +"']}]",
        }

        try:
            # Debugging: Print the URL and payload
            req = requests.Request('get_ads_details() > GET', url, params=payload)
            prepared = req.prepare()
            # Debugging: Print the exact URL
            print('get_ads_details() > Request URL:', prepared.url)

            insights_response = requests.get(url, params=payload)
            insights_response.raise_for_status()
            data = insights_response.json()['data']

            return data
        
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f'get_ads_details() > HTTP error occurred: {http_err.response.status_code} {decoded_text} \n\nfor URL: {decoded_url}')  # Handle HTTP errors
            return None
        except Exception as err:
            print(f'get_ads_details() > Other error occurred aqui: {err}')  # Handle other errors
            return None

    def get_adaccounts(self):
        url = self.base_url + 'me/adaccounts' + self.user_token
        payload = {
            'fields': 'name,id,account_status,user_tasks,instagram_accounts{username,profile_pic,followed_by_count},business{name,id,picture}',
        }
        try:
            # Debugging: Print the URL and payload
            print('get_adaccounts() > Request URL:', url)
            print('get_adaccounts() > Request Payload:', json.dumps(payload, indent=2))
            response = requests.get(url, params=payload)
            print('get_adaccounts() > response:', response)
            response.raise_for_status()  # Check for HTTP errors
            return {'status': 'success', 'data': response.json()['data']}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f'get_adaccounts() > HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}')  # Handle HTTP errors
            if http_err.response.json()['error']['code'] == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            print(f'get_adaccounts() > Other error occurred: {err}')  # Handle other errors
            return {'status': 'error', 'message': str(err)}

    @timer_decorator
    def get_ads(self, act_id, time_range, filters):
        # INIT PROGRESS
        current_progress = 0
        progressBar = st.progress(current_progress, 'get_ads() > Initializing...')

        # INIT DATE RANGE VARS
        total_data = []
        chunks_date_range = split_date_range(literal_eval(time_range), max_days=7)
        current_chunk = 1
        total_chunks = len(chunks_date_range)

        # PREPARA DADOS DA REQUISIÇÃO
        url = self.base_url + act_id + '/insights' + self.user_token
        json_filters = [json.dumps(filter_dict) for filter_dict in filters]
            
        # PARA CADA DATE RANGE DE (7 DIAS MÁX)
        for dates in chunks_date_range:

            #🔄️ SET PROGRESS
            current_progress = 0
            progressBar.progress(current_progress, f"get_ads() > Loading week {current_chunk} of {total_chunks}...")

            # PREPARA DADOS DA REQUISIÇÃO
            payload = {
                'fields': 'actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,frequency,impressions,inline_link_clicks,reach,spend,video_play_actions,video_thruplay_watched_actions,video_play_curve_actions,video_p50_watched_actions,website_ctr',
                'limit': self.limit,
                'level': self.level,
                'action_attribution_windows': self.action_attribution_windows,
                'use_account_attribution_setting': self.use_account_attribution_setting,
                'action_breakdowns': self.action_breakdowns,
                'time_range': json.dumps(dates) if dates else self.time_range,
                'filtering': '[' + ','.join(json_filters) + ']' if filters else '',
            }
            
            # --- ETAPA 1: BUSCAR MÉTRICAS PRINCIPAIS DOS ANÚNCIOS
            try:
                ## ENVIAR REQUISIÇÃO
                print('get_ads() > Request URL:', url)
                print('get_ads() > Request Payload:', json.dumps(payload, indent=2))
                response = requests.post(url, params=payload)
                print('get_ads() > request_url:', response.url)
                response.raise_for_status()  # Check for HTTP errors
                ad_report_id = response.json().get('report_run_id')
                print('get_ads() > Current AD_REPORT_ID:', ad_report_id)

                #🔄️ SET PROGRESS
                current_progress = 0.05
                progressBar.progress(current_progress, f"get_ads() > Getting ads... (week {current_chunk} of {total_chunks})")
                
                ## SE DER ERRO NA REQUISIÇÃO
                if not ad_report_id:
                    print('get_ads() > Failed to get ad_report_id')
                    progressBar.error('Failed to get ad_report_id')
                    return None
                
                ## VERIFICANDO STATUS DA REQUISIÇÃO
                status_url = self.base_url + ad_report_id
                while True:
                    status_response = requests.get(status_url + self.user_token)
                    status_response.raise_for_status()
                    status_data = status_response.json()
                    
                    print(f"get_ads() > {ad_report_id} STATUS", status_data['async_status'])
                    print(f"get_ads() > {ad_report_id} PERCENT", status_data['async_percent_completion'])

                    loading_status = status_data['async_status']
                    loading_progress_value = status_data['async_percent_completion']

                    #🔄️ SET PROGRESS
                    current_progress = (0.05 + loading_progress_value/200) ### DELTA = 80 (varia de 5 à 55)
                    progressBar.progress(current_progress, f"get_ads() > Waiting Meta data... (week {current_chunk} of {total_chunks})")

                    ### REQUISIÇÃO COMPLETA => QUEBRANDO CICLO
                    if loading_status == 'Job Completed' and loading_progress_value == 100:
                        break
                    time.sleep(5)  ### DELAY PARA TENTAR NOVAMENTE
                
                ## BUSCA DADOS RESULTADOS DA REQUISIÇÃO
                insights_url = self.base_url + ad_report_id + '/insights' + self.user_token + '&limit=500'
                insights_response = requests.get(insights_url)
                insights_response.raise_for_status()
                data = insights_response.json()['data']

                ## PAGINA RESULTADOS, ACUMULANDO DADOS EM 'data'
                while 'paging' in insights_response.json() and 'next' in insights_response.json()['paging']:
                    #🔄️ SET PROGRESS
                    current_progress = 0.60
                    progressBar.progress(current_progress, f"get_ads() > Paginating... (week {current_chunk} of {total_chunks})")

                    insights_response = requests.get(insights_response.json()['paging']['next'])
                    insights_response.raise_for_status()
                    data.extend(insights_response.json()['data'])

                ## CASO NÃO ENCONTRE NENHUM AD
                if data and len(data) > 0:
                    # --- ETAPA 2: BUSCAR DETALHES DOS ANÚNCIOS

                    ## CRIA DICT DE ANÚNCIOS ÚNICOS {ad_name: ad_id}
                    unique_ads = {}
                    for ad in data:
                        ad_name = ad["ad_name"]
                        ad_id = ad["ad_id"]
                        ### SE AINDA NÃO EXISTE NO UNIQUE ADS
                        if ad_name not in unique_ads:
                            ### ADICIONA AO UNIQUE ADS
                            unique_ads[ad_name] = ad_id

                    ## CRIA LISTA DE IDs ÚNICOS
                    unique_ids = list(unique_ads.values())

                    #🔄️ SET PROGRESS
                    current_progress = 0.75
                    progressBar.progress(current_progress, f"get_ads() > Collecting ads details... (week {current_chunk} of {total_chunks})")

                    ## FAZ REQUEST BUSCANDO DETALHES DOS ANÚNCIOS
                    ads_details = self.get_ads_details(act_id, time_range, unique_ids)

                    ## SE DETALHES FORAM ENCONTRADOS
                    if ads_details is not None:
                        ## CRIA LISTA DE 'ad.creative'
                        creative_list = {detail['name']: detail['creative'] for detail in ads_details}
                        ## CRIA LISTA DE 'adcreatives.data.asset_feed_spec.videos'
                        videos_list = {
                            detail['name']: detail['adcreatives']['data'][0]['asset_feed_spec']['videos']
                            for detail in ads_details
                            if 'asset_feed_spec' in detail['adcreatives']['data'][0] and 'videos' in detail['adcreatives']['data'][0]['asset_feed_spec']
                        }

                        ## ATUALIZA CADA ANÚNCIO EM 'data' COM SEUS DETALHES
                        for ad in data:
                            #🔄️ SET PROGRESS
                            current_progress = 0.90
                            progressBar.progress(current_progress, f"get_ads() > Matching ads details... (week {current_chunk} of {total_chunks})")
                            
                            ### CRIA COLUNA 'creative' COM 'ad.creative'
                            ad['creative'] = creative_list.get(ad['ad_name'], None)

                            ### BUSCA INFORMAÇÕES RELEVANTES DE 'adcreatives' (aka 'adcreatives.asset_feed_spec.videos' content)
                            adcreatives = videos_list.get(ad['ad_name'], None)
                            video_ids = []
                            video_thumbs = []
                            if adcreatives is not None:
                                for video in adcreatives:
                                    video_ids.append(video.get('video_id'))
                                    video_thumbs.append(video.get('thumbnail_url'))

                            ### CRIA COLUNA 'adcreatives_videos_ids' COM 'adcreatives.data.asset_feed_spec.videos.video_id'
                            ad['adcreatives_videos_ids'] = video_ids

                            ### CRIA COLUNA 'adcreatives_videos_thumbs' COM 'adcreatives.data.asset_feed_spec.videos.thumbnail_url'
                            ad['adcreatives_videos_thumbs'] = video_thumbs
                            
                            ### SET PROGRESS
                            progressBar.progress(100, 'get_ads() > Sucessfully loaded!')


                    #🔄️ SET PROGRESS
                    current_progress = 1.00
                    progressBar.progress(current_progress, f"get_ads() > Sucessfully loaded! (week {current_chunk} of {total_chunks})")
                    current_chunk += 1

                    # --- ETAPA 3: AGREGA RESULTADOS (anúncios + detalhes) EM 'total_data'
                    total_data.extend(data)

            except requests.exceptions.HTTPError as http_err:
                decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
                decoded_text = urllib.parse.unquote(http_err.response.text)
                print(f"get_ads() > HTTP error occurred: {http_err.response.status_code} {decoded_text} \n\nfor URL: {decoded_url}")  # Handle HTTP errors
                return decoded_text
            except Exception as err:
                decoded_url = urllib.parse.unquote(err.request.url) # type: ignore
                decoded_text = err.args
                print(f"get_ads() > Other error occurred: {err} or {err.args}")
                return decoded_text

            current_chunk += 1

        # RETORNA RESULTADOS
        if not total_data or total_data == []:
            progressBar.progress(100, 'No ads found with these filters')
            return []
        return total_data

    ## GET VIDEO SOURCE URL
    def get_video_source_url(self, video_id, actor_id):       
        if actor_id is None or video_id is None:
            st.error("Actor ID or Video ID is None")
            raise Exception("Actor ID or Video ID is None")
        else:
            try:
                # Busca VIDEO SOURCE URL
                video_url = self.base_url + str(video_id) + self.get_page_access_token(actor_id)
                video_payload = {
                    'fields': 'source',
                }

                # Debugging: Print the URL and payload
                req = requests.Request('GET', video_url, params=video_payload)
                prepared = req.prepare()
                # Debugging: Print the exact URL
                print('get_video_source_url() > Request URL:', prepared.url)

                video_response = requests.get(video_url, params=video_payload)
                video_response.raise_for_status()
                video_source = video_response.json().get('source')

                if video_source:
                    print('get_video_source_url() > Video source:', video_source)
                    return video_source
                
            except requests.exceptions.HTTPError as http_err:
                decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
                decoded_text = urllib.parse.unquote(http_err.response.text)
                error_code = http_err.response.json().get('error', {}).get('code')
                error_message = literal_eval(decoded_text)['error']['message']
                print(f"get_video_source_url() > HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}")
                return {'status': f"Status: {http_err.response.status_code} - http_error ({error_code})", 'message': error_message}
            
            except Exception as err:
                print(f"get_video_source_url() > Other error occurred: {err}")
                return {'status': 'error', 'message': str(err)}
            
# BUSCA VIDEO SOURCE URL
@st.cache_data(show_spinner=False)
def get_cached_video_source_url(video_id, actor_id):
    # INICIALIZA API KEY E GRAPH API
    api_key = get_session_access_token()
    graph_api = GraphAPI(api_key)
    response = graph_api.get_video_source_url(video_id, actor_id)
    return response
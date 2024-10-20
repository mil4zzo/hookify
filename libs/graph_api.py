import time
from matplotlib.font_manager import json_load
import requests
import json
import urllib.parse

class GraphAPI:
    def __init__(self, fb_api):
        self.base_url = "https://graph.facebook.com/v20.0/"
        self.user_token = "?access_token=" + fb_api
        self.page_token = None
        self.api_fields = "actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,frequency,impressions,inline_link_clicks,reach,spend,video_play_curve_actions,website_ctr"
        self.limit = 2000
        self.time_range = "{'since':'2024-06-22','until':'2024-06-22'}"
        self.filtering = "[{'field':'video_play_actions', 'operator':'GREATER_THAN', 'value':0}]"
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
            print('Request URL:', url)
            print('Request Payload:', json.dumps(payload, indent=2))
            response = requests.get(url, params=payload)
            print('response:', response.json())
            response.raise_for_status()  # Check for HTTP errors
            return {'status': 'success', 'data': response.json()}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f'HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}')  # Handle HTTP errors
            if http_err.response.json()['error']['code'] == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            print(f'Other error occurred: {err}')  # Handle other errors
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
                    print('PAGE TOKEN:', self.page_token)
                    return self.page_token
            raise Exception(f"Page with ID {actor_id} not found")
        except requests.exceptions.RequestException as e:
            print(f"Error getting page access token: {e}")
            return None
        
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
            req = requests.Request('GET', url, params=payload)
            prepared = req.prepare()
            # Debugging: Print the exact URL
            print('Request URL:', prepared.url)

            insights_response = requests.get(url, params=payload)
            insights_response.raise_for_status()
            data = insights_response.json()['data']

            return data
        
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f'HTTP error occurred: {http_err.response.status_code} {decoded_text} \n\nfor URL: {decoded_url}')  # Handle HTTP errors
            return None
        except Exception as err:
            print(f'Other error occurred aqui: {err}')  # Handle other errors
            return None

    def get_adaccounts(self):
        url = self.base_url + 'me/adaccounts' + self.user_token
        payload = {
            'fields': 'name,id,account_status,user_tasks,instagram_accounts{username,profile_pic,followed_by_count},business{name,id,picture}',
        }
        try:
            # Debugging: Print the URL and payload
            print('Request URL:', url)
            print('Request Payload:', json.dumps(payload, indent=2))
            response = requests.get(url, params=payload)
            print('response:', response)
            response.raise_for_status()  # Check for HTTP errors
            return {'status': 'success', 'data': response.json()['data']}
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f'HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}')  # Handle HTTP errors
            if http_err.response.json()['error']['code'] == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        except Exception as err:
            print(f'Other error occurred: {err}')  # Handle other errors
            return {'status': 'error', 'message': str(err)}

    def get_ads(self, act_id, time_range, filters):
        url = self.base_url + act_id + '/insights' + self.user_token
        filters.append("{'field': 'video_play_actions', 'operator': 'GREATER_THAN', 'value': '0'}")
        json_filters = [json.dumps(filter_dict) for filter_dict in filters]
        payload = {
            'fields': 'actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,frequency,impressions,inline_link_clicks,reach,spend,video_play_actions,video_thruplay_watched_actions,video_play_curve_actions,website_ctr',
            'limit': self.limit,
            'level': self.level,
            'action_attribution_windows': self.action_attribution_windows,
            'use_account_attribution_setting': self.use_account_attribution_setting,
            'action_breakdowns': self.action_breakdowns,
            'time_range': time_range if time_range else self.time_range,
            'filtering': '[' + ','.join(json_filters) + ']' if filters else '',
        }

        try:
            # Debugging: Print the URL and payload
            print('Request URL:', url)
            print('Request Payload:', json.dumps(payload, indent=2))
            response = requests.post(url, params=payload)
            print('request_url:', response.url)
            response.raise_for_status()  # Check for HTTP errors
            ad_report_id = response.json().get('report_run_id')
            print('Current AD_REPORT_ID:', ad_report_id)
            
            if not ad_report_id:
                print('Failed to get ad_report_id')
                return None
            
            # Polling for job completion
            status_url = self.base_url + ad_report_id
            while True:
                status_response = requests.get(status_url + self.user_token)
                status_response.raise_for_status()
                status_data = status_response.json()
                
                print(f"{ad_report_id} STATUS", status_data['async_status'])
                print(f"{ad_report_id} PERCENT", status_data['async_percent_completion'])

                loading_status = status_data['async_status']
                loading_progress_value = status_data['async_percent_completion']

                if loading_status == 'Job Completed' and loading_progress_value == 100:
                    break
                
                time.sleep(5)  # Wait before polling again
            
            # Fetch insights
            insights_url = self.base_url + ad_report_id + '/insights' + self.user_token
            insights_response = requests.get(insights_url)
            insights_response.raise_for_status()
            data = insights_response.json()['data']

            while 'paging' in insights_response.json() and 'next' in insights_response.json()['paging']:
                print(f"{ad_report_id} PAGINANDO...")
                insights_response = requests.get(insights_response.json()['paging']['next'])
                insights_response.raise_for_status()
                data.extend(insights_response.json()['data'])


            # Create a set of unique ad_name
            unique_ads = {}

            # Iterate over the list of ads
            for ad in data:
                ad_name = ad["ad_name"]
                ad_id = ad["ad_id"]
                
                # If ad_name is not already in the dictionary, add it with its id
                if ad_name not in unique_ads:
                    unique_ads[ad_name] = ad_id

            # Convert the unique ads to a list of ids
            unique_ids = list(unique_ads.values())

            # Get details for unique ads
            ads_details = self.get_ads_details(act_id, time_range, unique_ids)

            if ads_details is not None:
                # Create a dictionary of ad details
                creative_list = {detail['name']: detail['creative'] for detail in ads_details}
                videos_list = {
                    detail['name']: detail['adcreatives']['data'][0]['asset_feed_spec']['videos']
                    for detail in ads_details
                    if 'asset_feed_spec' in detail['adcreatives']['data'][0] and detail['adcreatives']['data'][0]['asset_feed_spec'] is not None
                }

                # Update data with creative details
                for ad in data:
                    ad['creative'] = creative_list.get(ad['ad_name'], None)
                    adcreatives = videos_list.get(ad['ad_name'], None)
                    video_ids = []
                    video_thumbs = []
                    if adcreatives is not None:
                        for video in adcreatives:
                            video_ids.append(video.get('video_id'))
                            video_thumbs.append(video.get('thumbnail_url'))
                    ad['adcreatives_videos_ids'] = video_ids
                    ad['adcreatives_videos_thumbs'] = video_thumbs

            return data
        
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f"HTTP error occurred: {http_err.response.status_code} {decoded_text} \n\nfor URL: {decoded_url}")  # Handle HTTP errors
            return decoded_text
        except Exception as err:
            print(f"Other error occurred: {err}")  # Handle other errors
            return None

    ## GET VIDEO SOURCE URL
    def get_video_source_url(self, video_id, actor_id):       

        # token = None
        # if source_type == 'creative':
        #     token = self.user_token
        # elif source_type == 'adcreative':
        #     token = self.user_token


        # Busca VIDEO SOURCE URL
        video_url = self.base_url + video_id + self.get_page_access_token(actor_id)
        video_payload = {
            'fields': 'source',
        }

        try:
            # Debugging: Print the URL and payload
            req = requests.Request('GET', video_url, params=video_payload)
            prepared = req.prepare()
            # Debugging: Print the exact URL
            print('Request URL:', prepared.url)

            video_response = requests.get(video_url, params=video_payload)
            video_response.raise_for_status()
            video_source = video_response.json().get('source')

            if video_source:
                print('Video source:', video_source)
                return video_source
            
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url) # type: ignore
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f"HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}")
            if http_err.response.json().get('error', {}).get('code') == 190:
                return {'status': 'auth_error', 'message': decoded_text}
            return {'status': 'http_error', 'message': decoded_text}
        
        except Exception as err:
            print(f"Other error occurred: {err}")
            return {'status': 'error', 'message': str(err)}
import requests
import json
import urllib.parse
#from config.settings import META_API_KEY

class GraphAPI:
    def __init__(self, fb_api):
        self.base_url = "https://graph.facebook.com/v20.0/"
        self.token = "?access_token=" + fb_api
        self.api_fields = "actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,date_start,date_stop,frequency,impressions,inline_link_clicks,reach,spend,video_play_curve_actions,website_ctr"
        self.limit = 50
        self.time_range = "{'since':'2024-06-26','until':'2024-06-26'}"
        self.filtering = "[{'field':'video_play_actions', 'operator':'GREATER_THAN', 'value':0}]"
        self.level = "ad"
        self.action_attribution_windows = "['7d_click','1d_view']"
        self.use_account_attribution_setting = "true"
        self.action_breakdowns = "action_type"
        
    def get_adaccounts(self):
        url = self.base_url + "/me/adaccounts" + self.token
        payload = {
            "fields": "name,id,account_status,owner,user_tasks,instagram_accounts{username,profile_pic,followed_by_count},business{name,id,picture}",
        }
        try:
            # Debugging: Print the URL and payload
            print("Request URL:", url)
            print("Request Payload:", json.dumps(payload, indent=2))
            response = requests.get(url, params=payload)
            print("response:", response)
            response.raise_for_status()  # Check for HTTP errors
            return response.json()["data"]
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url)
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f"HTTP error occurred: {http_err.response.status_code} {decoded_text} for URL: {decoded_url}")  # Handle HTTP errors
            return None
        except Exception as err:
            print(f"Other error occurred: {err}")  # Handle other errors
            return None

    def get_ads(self, act_id, time_range, filters):
        url = self.base_url + act_id + "/insights" + self.token
        # Pelo menos 1 play
        filters.append("{'field': 'video_play_actions', 'operator': 'GREATER_THAN', 'value': '0'}")
        payload = {
            "fields": self.api_fields,
            "limit": self.limit,
            "level": self.level,
            "action_attribution_windows": self.action_attribution_windows,
            "use_account_attribution_setting": self.use_account_attribution_setting,
            "action_breakdowns": self.action_breakdowns,

            "time_range": time_range,
            "filtering": "[" + ','.join(filters) + "]" if filters else '',
        }
        try:
            # Debugging: Print the URL and payload
            #print("Request URL:", url)
            #print("Request Payload:", json.dumps(payload, indent=2))
            response = requests.post(url, params=payload)
            response.raise_for_status()  # Check for HTTP errors
            print("FINAL URL:", response.json())
            return response.json()["data"]
        except requests.exceptions.HTTPError as http_err:
            decoded_url = urllib.parse.unquote(http_err.request.url)
            decoded_text = urllib.parse.unquote(http_err.response.text)
            print(f"HTTP error occurred: {http_err.response.status_code} {decoded_text} \n\nfor URL: {decoded_url}")  # Handle HTTP errors
            return None
        except Exception as err:
            print(f"Other error occurred: {err}")  # Handle other errors
            return None
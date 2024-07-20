import aiohttp
import asyncio
import json

class GraphAPI:
    def __init__(self, fb_api):
        self.base_url = "https://graph.facebook.com/v20.0/"
        self.token = "?access_token=" + fb_api
        self.api_fields = "actions,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,clicks,conversions,cost_per_conversion,cpm,ctr,date_start,date_stop,frequency,impressions,inline_link_clicks,reach,spend,video_play_curve_actions,website_ctr"
        self.limit = 50
        self.level = "ad"
        self.action_attribution_windows = ['7d_click', '1d_view']
        self.use_account_attribution_setting = "true"
        self.action_breakdowns = "action_type"

    async def fetch(self, session, url, params):
        async with session.get(url, params=params) as response:
            response.raise_for_status()  # Check for HTTP errors
            return await response.json()

    async def get_ads(self, ad_account_id, time_range, filters):
        url = f"{self.base_url}act_{ad_account_id}/insights{self.token}"
        ads = []
        after = None

        async with aiohttp.ClientSession() as session:
            while True:
                payload = {
                    "fields": self.api_fields,
                    "limit": self.limit,
                    "time_range": time_range,
                    "filtering": json.dumps(filters),  # Convert to JSON string
                    "level": self.level,
                    "action_attribution_windows": json.dumps(self.action_attribution_windows),  # Convert to JSON string
                    "use_account_attribution_setting": self.use_account_attribution_setting,
                    "action_breakdowns": self.action_breakdowns,
                    "locale": "en_US"  # Specify locale for English
                }
                if after:
                    payload['after'] = after  # Pagination cursor
                
                try:
                    data = await self.fetch(session, url, payload)
                    ads.extend(data['data'])
                    
                    if 'paging' in data and 'next' in data['paging']:
                        after = data['paging']['cursors']['after']
                    else:
                        break  # No more pages to fetch
                except aiohttp.ClientResponseError as http_err:
                    print(f"HTTP error occurred: {http_err}")  # Handle HTTP errors
                    return None
                except Exception as err:
                    print(f"Other error occurred: {err}")  # Handle other errors
                    return None

        return ads

# Example usage
async def main():
    api_key = "EAAOZAnAruPk8BOZBpg1WsMvcfsTkpsRUOVDPHYWcLhlYuKmo8YkgvTI3lQMFRHTeGi3ZAYkfJB5KSKdoPVg7ZA8C45AQvlN345R5c5895FDFb4t1Lmqw1aWIJhb9wTPy0gEFW3T5mKi4IaayIZAEnWVzbjPdXvfVgGw1Qgckgga3EZAdaaCewWx90QaQv5dmXIVd8Fy5L3xhkA7vQP1QZDZD"
    graph_api = GraphAPI(api_key)
    ads_data = await graph_api.get_ads(ad_account_id="5610732065664663", time_range="{'since':'2024-06-26','until':'2024-06-26'}", filters=[{'field': 'ad.name', 'operator': 'CONTAIN', 'value': 'L1'}])

    if ads_data:
        # Process the ads data as needed
        print(ads_data)
    else:
        print("Failed to fetch data from Meta API")

# Run the async main function
asyncio.run(main())
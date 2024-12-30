import streamlit as st
from components import sidebar

if 'adaccounts' in st.session_state:
    st.set_page_config(layout="wide")
else:
    st.set_page_config(layout="centered")

# Initialize ACCESS TOKEN (api_key)
if "access_token" not in st.session_state:
    st.session_state["access_token"] = None
api_key = st.session_state["access_token"]

# LOAD CSS
with open('styles/stStyles.css', 'r') as f:
    st.markdown(f'<style>{f.read()}</style>', unsafe_allow_html=True)

# LOGGED AND CONNECTED FB
if 'adaccounts' in st.session_state:
    if 'ads_data' in st.session_state:
        new_pages = {
            "": [
                st.Page("tools/0_ads_loader.py", title="ADs Loader", icon="📔", ),
                #st.Page("tools/0_gold.py", title="G.O.L.D.", icon="🪙"),
                st.Page("tools/1_dashboard.py", title="Dashboard", icon="📊"),
                st.Page("tools/2_rankings.py", title="Rankings", icon="⭐"),
                st.Page("tools/3_matrix.py", title="Matrix", icon="💊"),
                st.Page("tools/4_image_analyzer.py", title="Image Analyzer", icon="🔍"),
                st.Page("tools/5_loaded_ads.py", title="Loaded ADs", icon="🗂️"),
            ]
        }
    else:
        new_pages = {
            "": [
                st.Page("tools/0_ads_loader.py", title="ADs Loader", icon="📔", ),
                st.Page("tools/5_loaded_ads.py", title="Loaded ADs", icon="🗂️"),
            ]
        }
    pages = new_pages
    sidebar.render()
else:
    # LOGGED BUT NO FACEBOOK
    if 'supabase_session' in st.session_state or 'code' in st.query_params:
        pages = {
            "FACEBOOK": [
                st.Page("tools/fb_connect.py", title="Connect to Facebook", icon="🔀"),
            ]
        }
        if 'supabase_session' in st.session_state and 'code' not in st.query_params:
            sidebar.render()
    else:
        # NOT LOGGED
        pages = {
            "SETUP": [
                st.Page("tools/login.py", title="Log in to Hookify", icon="➡️"),
                st.Page("tools/signup.py", title="Sign up to Hookify", icon="📝")
            ]
        }

nav = st.navigation(pages)
nav.run()
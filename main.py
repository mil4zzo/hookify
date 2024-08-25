import streamlit as st
from components import sidebar

if 'accounts_data' in st.session_state:
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

# PAGES (logged out)
pages = {
    "SETUP": [
        st.Page("tools/login.py", title="Your Access Token")
    ]
}

# PAGES (logged in)
if 'accounts_data' in st.session_state:
    new_pages = {
        "": [
            st.Page("tools/1_dashboard.py", title="Dashboard", icon="📊"),
            st.Page("tools/2_rankings.py", title="Rankings", icon="⭐"),
            st.Page("tools/3_image_analyzer.py", title="Image Analyzer", icon="🔍"),
            st.Page("tools/4_loaded_ads.py", title="Loaded ADs", icon="🗂️"),
        ]
    }
    pages = new_pages
    sidebar.render(api_key)

nav = st.navigation(pages)
nav.run()
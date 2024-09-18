import streamlit as st
import streamlit.components.v1 as components
from supabase import create_client, Client

SUPABASE_URL = st.secrets["connections"]["supabase"]["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["connections"]["supabase"]["SUPABASE_KEY"]


def get_supabase_client():
    if 'supabase_client' not in st.session_state:
        st.session_state.supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return st.session_state.supabase_client

class Supa:
    def __init__(self):
        self.supabase = get_supabase_client()
    
    def login(self, email, password):
        try:
            response = self.supabase.auth.sign_in_with_password(
                {"email": email, "password": password}
            )
            if response.session and response.user:
                st.session_state['supabase_session'] = response.session
                return response
            else:
                st.error('Login failed.')
        except Exception as e:
            st.error(f"""Error creating account: 
                        
                        {e}""")

    def retrieveUser(self):
        try:
            response = self.supabase.auth.get_user()
            print('retrieveUser response:', response)
            return response
        except Exception as e:
            st.error(f"""Error retrieving user: 
                        
                        {e}""")
            
    def retrieveSession(self):
        try:
            response = self.supabase.auth.get_session()
            print('retrieveSession response:', response)
            return response
        except Exception as e:
            st.error(f"""Error retrieving session: 
                        
                        {e}""")
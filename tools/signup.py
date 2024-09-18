import streamlit as st
import os
from supabase import create_client, Client

SUPABASE_URL = st.secrets["connections"]["supabase"]["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["connections"]["supabase"]["SUPABASE_KEY"]
SUPABASE_TABLE = 'users'

### INICIA INTERFACE ###
st.title('🔏 Sign up')
st.write('To leverage the power of Hookify.')
st.divider()

if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    with st.form('signup', clear_on_submit=False):
        st.subheader('Create your account')
        input_name = st.text_input("👤 Name", key="name")
        error_name = st.empty()
        input_email = st.text_input("✉️ Email", key="email")
        error_email = st.empty()
        input_pass = st.text_input("🔒 Password", type="password", key="password")
        error_pass = st.empty()
        input_pass_confirm = st.text_input("🔒 Confirm password", type="password", key="confirm_password")
        error_pass_confirm = st.empty()

        submit_button = st.form_submit_button("Create my account", type="primary", use_container_width=True)

        if submit_button:
            if not input_name:
                error_name.error("Please, fill your name")
            elif not input_email:
                error_email.error("Please, fill your email")
            elif not input_pass:
                error_pass.error("Please, fill your password")
            elif not input_pass_confirm:
                error_pass_confirm.error("Please, confirm your password")
            elif input_pass != input_pass_confirm:
                error_pass_confirm.error("Passwords don't match")
            else:
                try:
                    response = supabase.auth.sign_up(
                        {
                            "email": input_email,
                            "password": input_pass,
                            "options": {"data": {"name": input_name}},
                        }
                    )
                    st.success(f"""Succesfully created. Now, you can login with you e-mail:
                               
                               {response}.""")
                except Exception as e:
                    st.error(f"""Error creating account: 
                             
                             {e}""")
else:
    st.error('Fail to connect to our database.')
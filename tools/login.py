import time
import streamlit as st
from libs.supa import Supa
from libs.dataformatter import capitalize

### INICIA INTERFACE ###
st.title('Welcome to Hookify! ✌️👽')
st.write('Login to leverage the power of a great hook.')
st.divider()

with st.form('login', clear_on_submit=False):
    st.subheader('Login to your account')
    input_email = st.text_input("✉️ Email", key="email", value="vm@hookify.com")
    error_email = st.empty()
    input_pass = st.text_input("🔒 Password", type="password", key="password", value="123456")
    error_pass = st.empty()

    submit_button = st.form_submit_button("Log in", type="primary", use_container_width=True)

    if submit_button:
        if not input_email:
            error_email.error("Please, fill your email")
        elif not input_pass:
            error_pass.error("Please, fill your password")
        else:
            try:
                supa = Supa()
                response = supa.login(input_email, input_pass)
                if response and response.session and response.user:
                    st.success(f"""Welcome, {capitalize(response.user.user_metadata["name"].split(" ")[0])}! Let's make your hook roll stuff...""")
                    time.sleep(3)
                    st.rerun()
                else:
                    st.error('Login failed.')
            except Exception as e:
                st.error(f"""Error creating account: 
                            
                            {e}""")
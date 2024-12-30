import streamlit as st

def bt_delete(key, action):
    with st.container():
        #st.markdown("<a>❌</a>", unsafe_allow_html=True)
        bt_delete = st.button("❌", key=f"delete_{key}", on_click=action, args=(key,))
        return bt_delete
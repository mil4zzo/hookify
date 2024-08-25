import streamlit as st
import requests
from urllib.parse import urlencode
from libs.graph_api import GraphAPI

# Initialize session state for access_token if not already initialized
if "access_token" not in st.session_state:
    st.session_state["access_token"] = None

# Set api_key from session state
api_key = st.session_state["access_token"]

# Configurações do Facebook
client_id = '1013320407465551'
client_secret = 'aff296e102fc1692b97c6c859f314963'
redirect_uri = 'https://hookify.streamlit.app/?callback'
auth_base_url = 'https://www.facebook.com/v20.0/dialog/oauth'
token_url = 'https://graph.facebook.com/v20.0/oauth/access_token'
permissions = 'email,public_profile,business_management,ads_management,ads_read,read_insights,pages_show_list,pages_read_engagement'

# Função para gerar a URL de autenticação
def get_auth_url():
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'scope': permissions,
        'response_type': 'code'
    }
    url = f"{auth_base_url}?{urlencode(params)}"
    return url

# Função para obter o access token
def get_access_token(auth_code):
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'client_secret': client_secret,
        'code': auth_code
    }
    response = requests.get(token_url, params=params)
    print(token_url)
    print(params)
    print(response.json())
    return response.json()

# GET AD ACCOUNTS
@st.cache_data
def cached_get_adaccounts(api_key):
    """Cache the ad accounts retrieval."""
    graph_api = GraphAPI(api_key)
    response = graph_api.get_adaccounts()
    if response['status'] == 'success':
        ad_accounts_info = [{'name': account['name'],'business_name': account.get('business', {}).get('name', 'Personal'),'label': account.get('business', {}).get('name', 'Personal') + ' > ' + account['name'],'act_id': account['id']} for account in response['data']] # type: ignore
        return {'status': 'success', 'data': ad_accounts_info}
    else:
        return {'status': response['status'], 'message': response['message']}

# THROW ERROR CASO API FALHE
def throw_error(message):
    """Display an error message."""
    st.error(f"HTTP error occurred: {message}")

# MAIN CODE
if api_key:
    if 'accounts_data' not in st.session_state:
        response = cached_get_adaccounts(api_key)
        if response['status'] == 'success':
            st.session_state['accounts_data'] = response['data']
            st.rerun()
        elif response['status'] == 'auth_error':
            #get_new_access_token(response['message'])
            st.stop()
        else:
            throw_error(response['message'])
            st.stop()
else:
    # Interface do Streamlit
    st.image('res/img/logo-hookify-alpha.png', )
    st.divider()
    st.title('Log in to your Account')
    st.write('Welcome back! Select method to log in:')

    # Verifica se estamos na página de callback
    if 'callback' in st.query_params:
        query_params = st.query_params
        if 'code' in query_params:
            auth_code = query_params['code']
            token_info = get_access_token(auth_code)
            access_token = token_info.get('access_token')

            if access_token:
                st.success('Login bem-sucedido!')
                st.write('Access Token:', access_token)
                st.session_state['access_token'] = access_token
                st.rerun()
            else:
                st.error('Erro ao obter o Access Token.')
        else:
            st.error('Autenticação falhou.')
    else:
        # Exibe o botão de login
        auth_url = get_auth_url()
        #st.markdown(f'Please <a href="{auth_url}" target="_self">click here to login on Facebook.</a>', unsafe_allow_html=True)
        st.markdown(f"""<a
                    href="{auth_url}"
                    target="_blank"
                    style="
                        display: flex;
                        align-items: center;
                        gap: 0.5rem;
                        margin-top: 1rem;
                        padding: 0.75rem 1rem;
                        background-color: white;
                        color: #0863f7;
                        border-radius: 6px;
                        text-decoration: none;
                        font-weight: bold;
                        font-size: 1.25rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm3 8h-1.35c-.538 0-.65.221-.65.778v1.222h2l-.209 2h-1.791v7h-3v-7h-2v-2h2v-2.308c0-1.769.931-2.692 3.029-2.692h1.971v3z"/>
                        </svg>
                        Facebook
                    </a>""",
                     unsafe_allow_html=True)
import streamlit as st
import streamlit.components.v1 as components
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
redirect_uri = 'http://localhost:8501/?callback'
auth_base_url = 'https://www.facebook.com/v20.0/dialog/oauth'
token_url = 'https://graph.facebook.com/v20.0/oauth/access_token'
permissions = 'email,public_profile,ads_read,read_insights,pages_show_list,pages_read_engagement'

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

@st.cache_data
def cached_get_account_info(api_key):
    """Cache the ad accounts retrieval."""
    graph_api = GraphAPI(api_key)
    response = graph_api.get_account_info()
    if response['status'] == 'success':
        account_info = response['data']
        return {'status': 'success', 'data': account_info}
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
            st.stop()
        else:
            throw_error(response['message'])
            st.stop()
else:
    # 2. POPUP DE AUTENTICAÇÃO
    # Verifica se popup foi concluido com sucesso e dispara mensagem de callback
    if 'callback' in st.query_params:
        query_params = st.query_params
        if 'code' in query_params:
            auth_code = query_params['code']
            st.success('Successfully connected! You can close this window.')
            components.html("""
                <script>
                    let response = { 'status': 200, 'code': '"""+auth_code+"""'};
                    console.log(response)
                    window.parent.opener.postMessage(response, '*');
                    window.parent.close();
                </script>
                """)
        else:
            components.html("""
                <script>
                    let response = {'status': 401, 'code': null};
                    console.log(response)
                    window.parent.opener.postMessage(response, '*');
                    window.parent.close();
                </script>
                """)
            
    # 3. STREAMLIT PÓS POPUP
    # Verifica se recebemos code do callback
    elif 'code' in st.query_params:
        auth_code = st.query_params['code']
        token_info = get_access_token(auth_code)
        access_token = token_info.get('access_token')

        if access_token:
            st.success('Login bem-sucedido!')
            st.write('Access Token:', access_token)
            st.session_state['access_token'] = access_token

            account_info = cached_get_account_info(access_token)
            if account_info['status'] == 'success':
                st.session_state['account_info'] = account_info['data']
                st.rerun()
            else:
                throw_error(account_info['message'])
                st.stop()
        else:
            st.error('Erro ao obter o Access Token.')

    # 1. TELA DE LOGIN NORMAL
    else:
        ### INICIA INTERFACE ###
        st.title('Lets get connected')
        st.write('To get started, connect your facebook account.')
        st.divider()

        auth_url = get_auth_url()
        
        # CRIAR BOTÃO + POPUP DE AUTENTICAÇÃO + LISTENER DO CALLBACK
        components.html(
            """
            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    document.getElementById('alerta').addEventListener('click', function() {
                        var width = 650;
                        var height = 750;
                        var top = parseInt((screen.availHeight / 2) - (height / 2));
                        var left = parseInt((screen.availWidth / 2) - (width / 2));
                        var features = "width=" + width + ", height=" + height + ", top=" + top + ", left=" + left;
                        window.open('"""+auth_url+"""', 'facebook', features);
                    })
                });

                window.addEventListener("message",(event) => {
                    if (event.data.status == 200) {
                        const url = new URL(window.parent.location);
                        console.log('OPAA', event.data.code)
                        alert('alou')
                        url.searchParams.set('code', event.data.code)
                        window.parent.history.pushState({}, '', url);
                        window.parent.location.reload();
                    } else if (event.data.status == 401) {
                        console.log('deu ruim, error:', event.data.status)
                        window.parent.location.href += '?error=' + event.data.status
                    } else {
                        console.log('wtf:', event)
                    }
                },
                false,
                );
            </script>

            <div id="alerta">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm3 8h-1.35c-.538 0-.65.221-.65.778v1.222h2l-.209 2h-1.791v7h-3v-7h-2v-2h2v-2.308c0-1.769.931-2.692 3.029-2.692h1.971v3z"/>
                </svg>
                Continue with Facebook
            </div>

            <style>
                body{
                    margin: 0;
                    padding: 0;
                }

                #alerta {
                    display: flex;
                    margin-top: 1rem;
                    padding: 0.75rem 1rem;
                    align-items: center;
                    gap: 0.5rem;
                    background-color: white;
                    color: #0863f7;
                    border-radius: 6px;
                    text-decoration: none;
                    font-weight: bold;
                    font-size: 1rem;
                    font-family: sans-serif;
                    cursor: pointer;
                    transition: background-color 0.25s ease-out;
                }

                #alerta:hover{
                    background-color: #dbeafe;
                }
            </style>
            """
        )
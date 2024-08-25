import os
import streamlit as st
from libs.gcloudvision import detect_safe_search

# Set the path to your JSON key file
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(root_dir, "hookify_gcvapi.json")

#st.set_page_config(layout="wide")

### INICIA INTERFACE ###
st.title('🔍 Image Analyzer')
st.write('Check your static ADs before publishing.')
st.divider()


@st.cache_data(show_spinner=False)
def get_cached_safe_search(image_content):
    results = detect_safe_search(image_content)
    return results

def likelihood_to_value(likelihood):
    likelihood_map = {
        "UNKNOWN": 0,
        "VERY_UNLIKELY": 1,
        "UNLIKELY": 2,
        "POSSIBLE": 3,
        "LIKELY": 4,
        "VERY_LIKELY": 5
    }
    return likelihood_map.get(likelihood, 0)

def create_likelihood_bar(value):
    # NUMERO DE BARRAS
    segments = 5

    # COR DA BARRA BASEADA NO VALOR
    if value == 0:
        fill_color = '#292929'
    elif value == 1:
        fill_color = '#1B6447'
    elif value == 2:
        fill_color = '#1D9265'
    elif value == 3:
        fill_color = '#21D691'
    elif value == 4:
        fill_color = '#f5b041'
    elif value == 5:
        fill_color = '#e74c3c'

    # CRIA BARRAS
    final_html = ''
    for i in range(segments):
        if i < value:
            final_html += f'<div class="result-block" style="background: {fill_color}"></div>'
        else:
            final_html += '<div class="result-block"></div>'

    # ESTILIZA BARRA PADRÃO
    st.html("""
        <style>
            .result-block{
                flex: 1;
                background: #292929;
                border-radius: 2px;
            }
        </style>""")
    
    # CRIA BARRA FINAL
    st.html(f"""
        <div style='width: 100%; height: 1.6rem; display:flex; flex-direction: row; gap: 0.25rem'>
            {final_html}
        </div>
    """)

# UPLOAD DE ARQUIVOS
file_expander = st.expander('Upload your ADs', expanded=True)
with file_expander:
    uploaded_files = st.file_uploader("Choose images to upload", accept_multiple_files=True, type=['png', 'jpg', 'jpeg'])

# SE EXISTIREM ARQUIVOS CARREGADOS
if uploaded_files:

    # PARA CADA IMAGEM
    for uploaded_file in uploaded_files:

        with st.container(border=True):

            col1, col2 = st.columns([1,2], gap='medium')
            
            # IMAGEM
            with col1:
                st.image(uploaded_file, use_column_width=True)
            
            # RESULTADOS
            with col2:
                st.subheader(uploaded_file.name)
                image_content = uploaded_file.getvalue()

                # INICIA ANÁLISE COM CLOUD VISION
                with st.spinner('Analyzing...'):
                    results = detect_safe_search(image_content)

                # APRESENTA RESULTADO FINAL
                if 'VERY_LIKELY' in results.values() or 'LIKELY' in results.values():
                    st.error('❌ Likely to be unsafe')
                elif 'POSSIBLE' in results.values():
                    st.warning('⚠️ Possibly unsafe')
                else:
                    st.success('✅ Seems to be safe')

                st.divider()

                # APRESENTA RESULTADOS DETALHADOS
                for category, likelihood in results.items():
                    value = likelihood_to_value(likelihood)
                    col2a, col2b, col2c = st.columns([2,4,4], gap='small')
                    with col2a:
                        st.markdown(f"**{category.capitalize()}**")
                    with col2b:
                        create_likelihood_bar(value)
                    with col2c:
                        if value == 0:
                            st.markdown(f"⬛ {likelihood}", unsafe_allow_html=True)
                        elif value == 1:
                            st.markdown(f"✅ {likelihood}", unsafe_allow_html=True)
                        elif value == 2:
                            st.markdown(f"✅ {likelihood}", unsafe_allow_html=True)
                        elif value == 3:
                            st.markdown(f"👀 {likelihood}", unsafe_allow_html=True)
                        elif value == 4:
                            st.markdown(f"⚠️ {likelihood}", unsafe_allow_html=True)
                        elif value == 5:
                            st.markdown(f"❌ {likelihood}", unsafe_allow_html=True)     

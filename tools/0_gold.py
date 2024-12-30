from collections import Counter
import pandas as pd
import streamlit as st
from components.advanced_options import AdvancedOptions
from libs.gsheet_loader import K_CENTRAL_CAPTURA, K_CENTRAL_VENDAS, K_GRUPOS_WPP, K_PCOPY_DADOS, K_PTRAFEGO_DADOS, get_df

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('🪙 G.O.L.D.')
    st.write('Comprehensive ad analysis view.')
# with cols[1]:
    # with st.container(border=True):
    #     group_by_ad = st.toggle("Group ADs by name", value=True)

st.divider()

# Carregar DataFrames para lançamento selecionado
loading_container = st.empty()
with loading_container:
    status = st.status("Carregando dados...", expanded=True)
    with status:
        st.write("Carregando Pesquisa de Tráfego > Dados...")
        DF_PTRAFEGO_DADOS = get_df("EI", 21, K_PTRAFEGO_DADOS)

        status.update(label="Carregados com sucesso!", state="complete", expanded=False)
loading_container.empty()

# SE JÁ TEM DADOS DE ANÚNCIOS
if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):

    # PREPARA DATASET
    df_ads_data = st.session_state['ads_original_data'].copy()

    df_ads_data["unique_id"] = df_ads_data["adset_name"] + "&" + df_ads_data["ad_name"]
    DF_PTRAFEGO_DADOS["unique_id"] = DF_PTRAFEGO_DADOS["UTM_ADSET"] + "&" + DF_PTRAFEGO_DADOS["UTM_TERM"]
    df_ptrafego_dados_pago = DF_PTRAFEGO_DADOS[DF_PTRAFEGO_DADOS["UTM_MEDIUM"] == "pago"]

    with st.expander("Dados de Anúncios:"):
        st.dataframe(df_ads_data)

    with st.expander("Dados de Pesquisa de Tráfego > Dados:"):
        st.dataframe(df_ptrafego_dados_pago)

    def create_count_dict(values, column):
        counts = Counter(values)
        # Initialize with 0 for all possible categories
        if column == 'RENDA MENSAL':
            categories = [
                "Até R$1.500",
                "Entre R$1.500 e R$2.500",
                "Entre R$2.500 e R$5.000",
                "Entre R$5.000 e R$10.000",
                "Entre R$10.000 e R$20.000",
                "Acima de R$20.000"
            ]
        else:  # PATRIMONIO
            categories = [
                "Menos de R$5 mil",
                "Entre R$5 mil e R$20 mil",
                "Entre R$20 mil e R$100 mil",
                "Entre R$100 mil e R$250 mil",
                "Entre R$250 mil e R$500 mil",
                "Entre R$500 mil e R$1 milhão",
                "Acima de R$1 milhão"
            ]
        return {cat: counts.get(cat, 0) for cat in categories}

    # Create the aggregation
    df_qualificacao_agg = df_ptrafego_dados_pago.groupby("unique_id").agg({
        "RENDA MENSAL": list,  # First collect as list
        "PATRIMONIO": list     # First collect as list
    }).reset_index()

    # Now convert the lists to count dictionaries
    df_qualificacao_agg['RENDA MENSAL'] = df_qualificacao_agg['RENDA MENSAL'].apply(lambda x: create_count_dict(x, 'RENDA MENSAL'))
    df_qualificacao_agg['PATRIMONIO'] = df_qualificacao_agg['PATRIMONIO'].apply(lambda x: create_count_dict(x, 'PATRIMONIO'))

    df_teste = df_ads_data.merge(df_qualificacao_agg, how='left', on='unique_id')

    with st.expander("Dados finais"):
        st.dataframe(df_teste)
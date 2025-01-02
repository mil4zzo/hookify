from ast import literal_eval
from collections import Counter
import pandas as pd
import streamlit as st
from components.advanced_options import AdvancedOptions
from libs.gsheet_loader import K_CENTRAL_CAPTURA, K_CENTRAL_VENDAS, K_GRUPOS_WPP, K_PCOPY_DADOS, K_PTRAFEGO_DADOS, clear_df, get_df

# TICKET LÍQUIDO
TICKET_LIQUIDO = {
    "EI21": 1029.0
}

# MARGENS DE LANÇAMENTO
TAXAS_PATRIMONIO = {
    "Acima de R$1 milhão": 0.0694,
    "Entre R$500 mil e R$1 milhão": 0.0653,
    "Entre R$250 mil e R$500 mil": 0.0466,
    "Entre R$100 mil e R$250 mil": 0.0345,
    "Entre R$20 mil e R$100 mil": 0.0224,
    "Entre R$5 mil e R$20 mil": 0.0214,
    "Menos de R$5 mil": 0.01,
}
				 	
# MARGENS DE LANÇAMENTO
TAXAS_RENDA_MENSAL = {
    "Acima de R$20.000": 0.0265,
    "Entre R$10.000 e R$20.000": 0.0279,
    "Entre R$5.000 e R$10.000": 0.02,
    "Entre R$2.500 e R$5.000": 0.0147,
    "Entre R$1.500 e R$2.500": 0.0083,
    "Até R$1.500": 0.0059,
}

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('✨ GOLD')
    st.write('Comprehensive ad analysis view.')
with cols[1]:
    if st.button('Clear'):
        get_df.clear()
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

    df_ads_data["unique_id"] = df_ads_data["ad_name"] + "&" + df_ads_data["adset_name"]
    DF_PTRAFEGO_DADOS["unique_id"] = DF_PTRAFEGO_DADOS["UTM_TERM"] + "&" + DF_PTRAFEGO_DADOS["UTM_ADSET"]
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

    def calculate_cplmax(val, question):
        if pd.isna(val):
            return None
        try:
            cplmax = 0
            # Para cada opção da pergunta
            for option in question.keys():
                # Calcula o CPLMAX para a opção
                temp = val[option] * question[option]
                # Agrega o valor
                cplmax += temp
            # Ao final, multiplca pelo ticket liquido
            cplmax = cplmax * TICKET_LIQUIDO["EI21"]
            return cplmax
        except:
            return {}

    # CPL MAX: PATRIMONIO
    df_teste['CPL_MAX_PATRIMONIO'] = df_teste['PATRIMONIO'].apply(calculate_cplmax, question=TAXAS_PATRIMONIO)
    df_teste['MARGEM_ABS_PATRIMONIO'] = df_teste['CPL_MAX_PATRIMONIO'] - df_teste['cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']
    df_teste['MARGEM_PERCENT_PATRIMONIO'] = df_teste['MARGEM_ABS_PATRIMONIO'] / df_teste['CPL_MAX_PATRIMONIO'] if df_teste['CPL_MAX_PATRIMONIO'] is not None else None

    # CPL MAX: RENDA MENSAL
    df_teste['CPL_MAX_RENDA_MENSAL'] = df_teste['RENDA MENSAL'].apply(calculate_cplmax, question=TAXAS_RENDA_MENSAL)
    df_teste['MARGEM_ABS_RENDA_MENSAL'] = df_teste['CPL_MAX_RENDA_MENSAL'] - df_teste['cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']
    df_teste['MARGEM_PERCENT_RENDA_MENSAL'] = df_teste['MARGEM_ABS_RENDA_MENSAL'] / df_teste['CPL_MAX_RENDA_MENSAL'] if df_teste['CPL_MAX_RENDA_MENSAL'] is not None else None

    # CPL MAX: MÉDIO
    df_teste['CPL_MAX_MEDIO'] = (df_teste['CPL_MAX_PATRIMONIO'] + df_teste['CPL_MAX_RENDA_MENSAL']) / 2
    df_teste['MARGEM_ABS_MEDIO'] = df_teste['CPL_MAX_MEDIO'] - df_teste['cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']
    df_teste['MARGEM_PERCENT_MEDIO'] = df_teste['MARGEM_ABS_MEDIO'] / df_teste['CPL_MAX_MEDIO'] if df_teste['CPL_MAX_MEDIO'] is not None else None

    columns_otimizacao = [
        'creative.status', # STATUS
        'unique_id', # UNIQUE ID
        'ad_name', # ANÚNCIO
        'adset_name', # CONJUNTO
        'conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento', # LEADS
        # , # TOTAL DE PESQUISA
        'cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento', # CPL ATUAL
        'CPL_MAX_MEDIO', # PRECO MAX MEDIO
        'MARGEM_ABS_MEDIO', # MEDIA DIFERENCA
        'MARGEM_PERCENT_MEDIO', # MEDIA MARGEM
        'impressions', # IMPRESSOES
        'spend', # VALOR USADO
        'cpm', # CPM
        'ctr', # CTR
        'connect_rate', # CONNECT RATE
        # df_ads_data['page_conversion'] = np.divide(df_ads_data[results_column], df_ads_data["actions.landing_page_view"], out=np.zeros_like(df_ads_data[results_column]), where=df_ads_data["actions.landing_page_view"]!=0) * 100, # CONVERSAO PAGINA
        # , # options[patrimonio]
        # , # options[renda_mensal]
        # , # TAXA DE RESPOSTA
    ]

    with st.expander("Dados finais"):
        st.dataframe(df_teste[columns_otimizacao])
from ast import literal_eval
from collections import Counter
import json
from shlex import join
import numpy as np
import pandas as pd
import streamlit as st
from components.advanced_options import AdvancedOptions
from libs.dataformatter import aggregate_dataframe
from libs.gsheet_loader import K_CENTRAL_CAPTURA, K_CENTRAL_VENDAS, K_GRUPOS_WPP, K_PCOPY_DADOS, K_PTRAFEGO_DADOS, clear_df, get_df
from libs.session_manager import get_session_ads_data, has_session_ads_data

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

# PERGUNTAS DA PESQUISA
QUESTIONS_DICT = {
        "RENDA MENSAL": {
            "type": list,
            "rates": TAXAS_RENDA_MENSAL
            },
        "PATRIMONIO": {
            "type": list,
            "rates": TAXAS_PATRIMONIO
            },     # First collect as list
    }

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('✨ GOLD')
    st.write('Comprehensive ad analysis view.')
with cols[1]:
    with st.container(border=True):
        group_by_ad = st.toggle("Group ADs by name", value=True)

st.divider()

# SE JÁ TEM DADOS DE ANÚNCIOS
df_ads_data = get_session_ads_data()
if df_ads_data is not None:

    # PREPARA DATASET
    advanced_options = AdvancedOptions()
    advanced_options.build()

    options = advanced_options.apply_filters(df_ads_data)
    if options is None:
        st.error('Erro ao aplicar filtro.')
    else:
        cost_column = options['cost_column']
        results_column = options['results_column']
        df_ads_data = options['df_ads_data'].copy()

        # CRIA AGRUPAMENTO POR NOME DO ANÚNCIO (ad_name)
        df_grouped = aggregate_dataframe(df_ads_data, group_by='ad_name')
        if group_by_ad:
            df_ads_data = df_grouped

    def load_df_ptrafego_dados(produto, versao):
        """ Carrega Pesquisa de Tráfego """
        loading_container = st.empty()
        with loading_container:
            status = st.status("Carregando dados...", expanded=True)
            with status:
                st.write("Carregando Pesquisa de Tráfego > Dados...")
                df_ptrafego_dados = get_df(produto, versao, K_PTRAFEGO_DADOS)
                status.update(label="Carregados com sucesso!", state="complete", expanded=False)
                loading_container.empty()
                return df_ptrafego_dados

    def add_unique_id(df_ads_data, df_ptrafego_dados):
        """ Cria unique_ids para anúncios e pesquisa de tráfego """
        if "ad_name" in df_ads_data.columns and "adset_name" in df_ads_data.columns:
            if group_by_ad:
                df_ads_data["unique_id"] = df_ads_data["ad_name"]
            else:
                df_ads_data["unique_id"] = df_ads_data["ad_name"] + "&" + df_ads_data["adset_name"]
            if "UTM_TERM" in df_ptrafego_dados.columns and "UTM_ADSET" in df_ptrafego_dados.columns:
                if group_by_ad:
                    df_ptrafego_dados["unique_id"] = df_ptrafego_dados["UTM_TERM"]
                else:
                    df_ptrafego_dados["unique_id"] = df_ptrafego_dados["UTM_TERM"] + "&" + df_ptrafego_dados["UTM_ADSET"]
            else:
                st.error("Missing UTM_TERM or UTM_ADSET columns in df_ptrafego_dados.")
        else:
            st.error("Missing ad_name or adset_name columns in df_ads_data.")
    
    def create_count_dict(values, question):
        """ Cria dicionário de categorias com base nas opções de resposta da pergunta """
        counts = Counter(values)
        categories = question.keys()
        return {cat: counts.get(cat, 0) for cat in categories}

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
        
    def sum_total_pesquisas(x):
        if x is None:
            return None
        elif isinstance(x, dict):
            return sum(x.values())
        else:
            return x

    def calculate_ad_medio(df):
        """ Retorna médias das métricas de otimização dos anúncios """
        ad_medio = {
            'cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento': df["spend"].sum() / df["conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento"].sum(),
            'MARGEM_PERCENT_MEDIO': df["MARGEM_ABS_MEDIO"].sum() / df["CPL_MAX_MEDIO"].sum(),
            'ctr': df["clicks"].sum() / df["impressions"].sum(),
            'page_conversion': df["conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento"].sum() / df["inline_link_clicks"].sum(),
            'HOOK': df["retention_at_3"].mean(),
            'retention_at_3': np.average(df['retention_at_3'], weights=df['total_plays']),
            'CORPO': df["video_watched_p50"].mean(),
            'video_watched_p50': np.average(df['video_watched_p50'], weights=df['total_plays']),
            'cpm': df["spend"].sum() / df["impressions"].sum() * 1000,
            'CPM (peso=spend)': np.average(df['cpm'], weights=df['spend']),
            'connect_rate': df["actions.landing_page_view"].sum() / df["inline_link_clicks"].sum()
        }
        return ad_medio

    # CARREGA PESQUISA DE TRÁFEGO
    df_ptrafego_dados = load_df_ptrafego_dados("EI", 21)

    # FILTRA APENAS PESQUISAS DE ANÚNCIOS
    df_ptrafego_dados_pago = df_ptrafego_dados[df_ptrafego_dados["UTM_MEDIUM"] == "pago"]

    # CRIA COLUNA 'unique_id' NOS DATAFRAMES
    add_unique_id(df_ads_data, df_ptrafego_dados_pago)

    # AGREGA COLUNAS DE QUALIFICAÇÃO NOS DADOS DOS ANÚNCIOS
    df_qualificacao_agg = df_ptrafego_dados_pago.groupby("unique_id").agg({
        question: QUESTIONS_DICT[question]["type"] for question in QUESTIONS_DICT.keys()
    }).reset_index()

    # CRIA COLUNAS COM AS DISTRIBUIÇÕES DAS RESPOSTAS
    for question in QUESTIONS_DICT.keys():
        df_qualificacao_agg[question] = df_qualificacao_agg[question].apply(lambda x: create_count_dict(x, QUESTIONS_DICT[question]["rates"]))

    # ADD QUALIFICAÇÃO NOS DADOS DOS ANÚNCIOS
    df_completo = df_ads_data.merge(df_qualificacao_agg, how='left', on='unique_id')

    # CPL MAX: PATRIMONIO
    df_completo['CPL_MAX_PATRIMONIO'] = df_completo['PATRIMONIO'].apply(calculate_cplmax, question=TAXAS_PATRIMONIO)
    df_completo['MARGEM_ABS_PATRIMONIO'] = df_completo['CPL_MAX_PATRIMONIO'] - df_completo['cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']
    df_completo['MARGEM_PERCENT_PATRIMONIO'] = df_completo['MARGEM_ABS_PATRIMONIO'] / df_completo['CPL_MAX_PATRIMONIO'] if df_completo['CPL_MAX_PATRIMONIO'] is not None else None

    # CPL MAX: RENDA MENSAL
    df_completo['CPL_MAX_RENDA_MENSAL'] = df_completo['RENDA MENSAL'].apply(calculate_cplmax, question=TAXAS_RENDA_MENSAL)
    df_completo['MARGEM_ABS_RENDA_MENSAL'] = df_completo['CPL_MAX_RENDA_MENSAL'] - df_completo['cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']
    df_completo['MARGEM_PERCENT_RENDA_MENSAL'] = df_completo['MARGEM_ABS_RENDA_MENSAL'] / df_completo['CPL_MAX_RENDA_MENSAL'] if df_completo['CPL_MAX_RENDA_MENSAL'] is not None else None

    # CPL MAX: MÉDIO
    df_completo['CPL_MAX_MEDIO'] = (df_completo['CPL_MAX_PATRIMONIO'] + df_completo['CPL_MAX_RENDA_MENSAL']) / 2
    df_completo['MARGEM_ABS_MEDIO'] = df_completo['CPL_MAX_MEDIO'] - df_completo['cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']
    df_completo['MARGEM_PERCENT_MEDIO'] = df_completo['MARGEM_ABS_MEDIO'] / df_completo['CPL_MAX_MEDIO'] if df_completo['CPL_MAX_MEDIO'] is not None else None

    # CONVERSÃO DA PÁGINA
    df_completo['page_conversion'] = df_completo.apply(lambda row: row['conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento'] / row['actions.landing_page_view'] if row['actions.landing_page_view'] != 0 else pd.NA, axis=1)
    df_completo['total_pesquisas'] = df_completo['PATRIMONIO'].apply(sum_total_pesquisas)
    df_completo['taxa_de_resposta'] = df_completo['total_pesquisas'] / df_completo['conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']

    # DEFINE COLUNAS APRESENTADAS
    columns_otimizacao = [
        'cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento', # CPL ATUAL
        'MARGEM_PERCENT_MEDIO', # MEDIA MARGEM
        'ctr', # CTR
        'page_conversion', # CONVERSAO PAGINA
        'retention_at_3', # HOOK (3S)
        'video_watched_p50', # CORPO (50%)
        'cpm', # CPM
        'connect_rate', # CONNECT RATE
    ]

    columns_extras = [
        'PATRIMONIO',
        'creative.status', # STATUS
        'unique_id', # UNIQUE ID
        'ad_name', # ANÚNCIO
        'adset_name', # CONJUNTO
        'conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento', # LEADS
        'total_pesquisas', # TOTAL DE PESQUISA
        'CPL_MAX_MEDIO', # PRECO MAX MEDIO
        'MARGEM_ABS_MEDIO', # MEDIA DIFERENCA
        'impressions', # IMPRESSOES
        'spend', # VALOR USADO
        # , # options[patrimonio]
        # , # options[renda_mensal]
        'taxa_de_resposta', # TAXA DE RESPOSTA
    ]

    # CALCULA AD MÉDIO (MÉTRICAS DE OTIMIZAÇÃO)
    ad_medio = calculate_ad_medio(df_completo)

    # Create all masks at once using vectorized operations
    masks = pd.DataFrame({
        'margin_positive': df_completo['MARGEM_PERCENT_MEDIO'] > 0,
        **{f'above_avg_{col}': df_completo[col] > ad_medio[col] 
        for col in columns_otimizacao}
    })

    # Calculate aggregated conditions in one go
    masks['all_above_avg'] = masks.drop('margin_positive', axis=1).all(axis=1)
    masks['any_above_avg'] = masks.drop('margin_positive', axis=1).any(axis=1)

    df_analisaveis = df_completo[df_completo['impressions'] >= 3000 ]
    df_testando = df_completo[df_completo['impressions'] < 3000 ]

    # Create all dataframes using boolean indexing
    df_ganhadores = df_analisaveis[masks['margin_positive'] & masks['all_above_avg']]
    df_otimizaveis = df_analisaveis[masks['margin_positive'] & masks['any_above_avg'] & ~masks['all_above_avg']]
    df_licoes = df_analisaveis[~masks['margin_positive'] & masks['any_above_avg']]
    df_descartados = df_analisaveis[~masks['margin_positive'] & ~masks['any_above_avg']]

    # Quick verification
    total = len(df_ganhadores) + len(df_otimizaveis) + len(df_licoes) + len(df_descartados) + len(df_testando)
    st.write( "total", len(df_completo) )
    st.write( "matched", total )

    # with st.expander("Dados finais"):
    #     st.dataframe(df_completo[columns_otimizacao + columns_extras])

    with st.expander("Anúncio médio"):
        st.dataframe(ad_medio)

    with st.expander(f"Ganhadores ({len(df_ganhadores)})"):
        st.dataframe(df_ganhadores)

    with st.expander(f"Otimizaveis ({len(df_otimizaveis)})"):
        st.dataframe(df_otimizaveis)

    with st.expander(f"Lições" f"({len(df_licoes)})"):
        st.dataframe(df_licoes)

    with st.expander(f"Descartados ({len(df_descartados)})"):
        st.dataframe(df_descartados)

    with st.expander(f"Testando ({len(df_testando)})"):
        st.dataframe(df_testando)



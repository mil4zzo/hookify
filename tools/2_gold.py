from collections import Counter
import numpy as np
import pandas as pd
import streamlit as st
from components.advanced_options import AdvancedOptions
from libs.dataformatter import aggregate_dataframe
from libs.gsheet_loader import K_CENTRAL_CAPTURA, K_CENTRAL_VENDAS, K_GRUPOS_WPP, K_PCOPY_DADOS, K_PTRAFEGO_DADOS, clear_df, get_df
from libs.session_manager import  get_session_ads_data
from libs.utils import build_retention_chart, create_aggrid, resort_by, show_video_dialog

# TICKET LÍQUIDO
TICKET_LIQUIDO = {
    "EI_1997": 1379.0
}
# MARGENS DE LANÇAMENTO
TAXAS_PATRIMONIO = {
    "Acima de R$1 milhão": 0.0109,
    "Entre R$500 mil e R$1 milhão": 0.0292,
    "Entre R$250 mil e R$500 mil": 0.0192   ,
    "Entre R$100 mil e R$250 mil": 0.0212,
    "Entre R$20 mil e R$100 mil": 0.0142,
    "Entre R$5 mil e R$20 mil": 0.0132,
    "Menos de R$5 mil": 0.0079,
}			 	
# MARGENS DE LANÇAMENTO
TAXAS_RENDA_MENSAL = {
    "Acima de R$20.000": 0.0186,
    "Entre R$10.000 e R$20.000": 0.0174,
    "Entre R$5.000 e R$10.000": 0.0138,
    "Entre R$2.500 e R$5.000": 0.0095,
    "Entre R$1.500 e R$2.500": 0.0062,
    "Até R$1.500": 0.0039,
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

    # APLICA FILTROS SELECIONADOS (from st.session_state['filter_values'])
    options = advanced_options.apply_filters(df_ads_data)

    # SE ERRO AO APLICAR FILTROS
    if options is None:
        st.error('Erro ao aplicar filtro.')
    # SE SUCESSO AO APLICAR FILTROS
    else:
        # DEFINE VARIÁVEIS RETORNADAS DO AdvancedOptions
        cost_column = options['cost_column']
        results_column = options['results_column']
        df_ads_data = options['df_ads_data'].copy()

        # CRIA AGRUPAMENTO POR NOME DO ANÚNCIO (ad_name)
        df_grouped = aggregate_dataframe(df_ads_data, group_by='ad_name')

        # SE 'Group ADs by name' ESTÁ ATIVO, "DF_PRINCIPAL" = "DF_AGRUPADO"
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
                total_pesquisas = sum_total_pesquisas(val)
                # Para cada opção da pergunta
                for option in question.keys():
                    # Calcula o CPLMAX para a opção
                    temp = val[option] / total_pesquisas * question[option]
                    # Agrega o valor
                    cplmax += temp
                # Ao final, multiplca pelo ticket liquido
                cplmax = cplmax * TICKET_LIQUIDO["EI_1997"]
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
        df_ptrafego_dados = load_df_ptrafego_dados("EI", 22)

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

        # CONVERSÃO DA PÁGINA
        df_completo['page_conversion'] = df_completo.apply(lambda row: row['conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento'] / row['actions.landing_page_view'] if row['actions.landing_page_view'] != 0 else pd.NA, axis=1)
        df_completo['total_pesquisas'] = df_completo['PATRIMONIO'].apply(sum_total_pesquisas)
        df_completo['taxa_de_resposta'] = df_completo['total_pesquisas'] / df_completo['conversions.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento']

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

        # DEFINE COLUNAS APRESENTADAS
        columns_otimizacao = [
            #'cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento', # CPL ATUAL
            #'MARGEM_PERCENT_MEDIO', # MEDIA MARGEM
            'ctr', # CTR
            'page_conversion', # CONVERSAO PAGINA
            'retention_at_3', # HOOK (3S)
            'video_watched_p50', # CORPO (50%)
            #'cpm', # CPM
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

        # COLUNAS RELEVANTES
        interest_columns = [
            '#',
            'ad_name',
            'MARGEM_PERCENT_MEDIO',
            'retention_at_3',
            'video_watched_p50',
            'spend',
            'CPL_MAX_MEDIO',
            cost_column,
            results_column,
            'ctr',
            'page_conversion',
            'impressions',
            'video_play_curve_actions'
        ]

        # TABS
        tabs_columns = {
            f'Ganhadores ({len(df_ganhadores)})': df_ganhadores,
            f'Otimizáveis ({len(df_otimizaveis)})': df_otimizaveis,
            f'Lições ({len(df_licoes)})': df_licoes,
            f'Descartados ({len(df_descartados)})': df_descartados,
            f'Em teste ({len(df_testando)})': df_testando
        }

        # SORTING COLUMNS
        sorting_columns = {
            'Top Hooks': 'retention_at_3',
            'Top CTRs': 'ctr',
            'Top Spend': 'spend',
            'Top CPR': cost_column
        }

        st.write(ad_medio)

        ### INICIA INTERFACE ###
        col1, col2 = st.columns([7, 4], gap='medium')

        ## TABS AND AGGRID
        with col1:
            # TABS MENU (SELECT TOP RANKING)
            tabs_option = st.radio(
                "Category:",
                list(tabs_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
            )

            # TABS MENU (SELECT TOP RANKING)
            sorting_option = st.radio(
                "Sort by:",
                list(sorting_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
            )

            if tabs_option is not None:
                df_ads_data = tabs_columns[tabs_option]

            # SORT INIT
            if sorting_option is not None:
                selected_column = sorting_columns[sorting_option]
            df_ads_data = resort_by(df_ads_data, selected_column)

            # CONFIGURA AGGRID
            grid_response = create_aggrid(df_ads_data, interest_columns, cost_column, results_column, group_by_ad)

            # DEFINE LINHA SELECIONADA
            selected_row_data = None

            ## INICIAL = PRIMEIRA LINHA
            if not df_ads_data.empty:
                selected_row_data = df_ads_data.head(1).to_dict(orient='records')[0]

            ## SE USUÁRIO SELECIONAR LINHA
            if grid_response and 'selected_rows' in grid_response and grid_response.selected_rows is not None:
                selected_row_data = grid_response.selected_rows.iloc[0]
                selected_row_data['#'] = grid_response.selected_rows.iloc[0].index

        ## DETAILED INFO
        with col2:
            with st.container(border=True):
                if selected_row_data is not None:
                    ## MAIN INFO
                    cols = st.columns([6,3])
                    with cols[0]:
                        st.markdown(
                                f"""
                                <div style='display: flex; flex-direction: row; align-items: center; justify-content: start; margin-bottom: 1.5rem'>
                                    <img
                                        width='64px'
                                        height='64px'
                                        style='border-radius:100%'
                                        src='{selected_row_data['creative.thumbnail_url']}'>
                                    </img>
                                    <span style='margin-left: 1rem; margin-right: 2rem; font-size: 1.5rem; line-height: 1.4rem; color: white; font-weight: 700; font-family: "Source Sans Pro", sans-serif;'>{selected_row_data['ad_name']}</span>
                                </div>
                                """, unsafe_allow_html=True)
                    with cols[1]:
                        if ('creative.video_id' in selected_row_data and selected_row_data['creative.video_id'] is not None and selected_row_data['creative.video_id'] != 0) or ('adcreatives_videos_ids' in selected_row_data and selected_row_data['adcreatives_videos_ids'] is not None and len(selected_row_data['adcreatives_videos_ids']) > 0):
                            if st.button('Watch videoㅤ▶', type='primary', use_container_width=True):
                                show_video_dialog(selected_row_data)
                        else:
                            if st.button('Open imageㅤ▶', type='primary', use_container_width=True):
                                show_video_dialog(selected_row_data)

                    ## MAIN METRICS
                    col2a, col2b, col2c = st.columns(3)
                    with col2a:
                        st.metric(':sparkle: Hook retention', value=f"{int(round(selected_row_data['retention_at_3']))}%", delta=f"{int(round(((selected_row_data['retention_at_3']/ad_medio['retention_at_3'])-1)*100))}%")
                    with col2b:
                        st.metric(':eight_pointed_black_star: CTR', value=f"{selected_row_data['ctr']:.2f}%", delta=f"{int(round(((selected_row_data['ctr']/ad_medio['ctr'])-1)*100))}%")
                    with col2c:
                        if cost_column is not None:
                            st.metric(f':black_circle_for_record: {cost_column.split(".")[-1]}', value=f"$ {selected_row_data[cost_column]:.2f}", delta=f"${abs(selected_row_data[cost_column]-ad_medio[cost_column]):.2f}" if selected_row_data[cost_column]-ad_medio[cost_column] > 0 else f"-${abs(selected_row_data[cost_column]-ad_medio[cost_column]):.2f}", delta_color='inverse')
                        else:
                            st.metric(':black_circle_for_record: Plays', value=selected_row_data['total_plays'], delta='0')

                    # GRÁFICO RETENÇÃO
                    if selected_row_data['video_play_curve_actions'] is not None and isinstance(selected_row_data['video_play_curve_actions'], list):
                        build_retention_chart(selected_row_data['video_play_curve_actions'])

                    ## MAIS DETALHES
                    with st.expander('More info'):
                        
                        with st.container(border=False):
                            st.write('➡️ Spendings')
                            money = st.columns(2)
                            with money[0]:
                                st.metric(label="Total spend", value=f"$ {selected_row_data['spend']:.2f}")
                            with money[1]:
                                st.metric(label="CPM", value=f"$ {selected_row_data['cpm']:.2f}")
                        
                        with st.container(border=False):
                            st.write('➡️ Audience')
                            audience = st.columns(3)
                            with audience[0]:
                                st.metric(label="Impressions", value=selected_row_data['impressions'])
                            with audience[1]:
                                st.metric(label="Reach", value=selected_row_data['reach'])
                            with audience[2]:
                                st.metric(label="Frequency", value=f"{selected_row_data['frequency']:.2f}")

                        with st.container(border=False):
                            st.write('➡️ Views')
                            views = st.columns(2)
                            with views[0]:
                                st.metric(label="Plays", value=selected_row_data['total_plays'])
                            with views[1]:
                                st.metric(label="Thruplays", value=selected_row_data["total_thruplays"])

                        with st.container(border=False):
                            st.write('➡️ Clicks')
                            clicks = st.columns(3)
                            with clicks[0]:
                                st.metric(label="Total clicks", value=selected_row_data['clicks'], delta='TOTAL CLICKS')
                            with clicks[1]:
                                st.metric(label="Profile CTR", value=f"{selected_row_data['profile_ctr']:.2f}%", delta=f"{selected_row_data['clicks']-selected_row_data['inline_link_clicks']:.0f} clicks", delta_color='off')
                            with clicks[2]:
                                st.metric(label="Website CTR", value=f"{selected_row_data['website_ctr']:.2f}%", delta=f"{selected_row_data['inline_link_clicks']:.0f} clicks", delta_color='off')

                        # CAMPAIGN NAME
                        campaign_name_c1, campaign_name_c2 = st.columns([2, 3])
                        with campaign_name_c1:
                            st.write('CAMPAIGN')
                        with campaign_name_c2:
                            st.write(f"{selected_row_data['campaign_name']}")

                        # ADSET NAME
                        adset_namec1, adset_namec2 = st.columns([2, 3])
                        with adset_namec1:
                            st.write('ADSET')
                        with adset_namec2:
                            st.write(f"{selected_row_data['adset_name']}")
        
        ####### new layout #############################################################################################################
        
        # GANHADORES
        with st.expander(f'Ganhadores ({len(df_ganhadores)})'):
            ganhadores_cols = st.columns(2)
            with ganhadores_cols[0]:
                st.subheader('Ganhadores')
                st.markdown('##### ADs validados: :green[margem boa] e :green[métricas boas]')
                st.markdown('1. Margem positiva\n 2. Todas as métricas acima da média')
                st.info('*Copiar ao máximo, fazendo leves mutações e regravar (trocar roupa, cenário, etc).*')

            # TABS MENU (SELECT TOP RANKING)
            ganhadores_sorting_option = st.radio(
                "Sort by:",
                list(sorting_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
                key='ganhadores_sorting_option'
            )

            # # SORT INIT
            if ganhadores_sorting_option is not None:
                ganhadores_selected_column = sorting_columns[ganhadores_sorting_option]
            df_ganhadores = resort_by(df_ganhadores, ganhadores_selected_column)

            # CONFIGURA AGGRID
            ganhadores_grid_response = create_aggrid(df_ganhadores, interest_columns, cost_column, results_column, group_by_ad)

        # OTIMIZÁVEIS
        with st.expander(f'Otimizáveis ({len(df_otimizaveis)})'):
            otimizaveis_cols = st.columns(2)
            with otimizaveis_cols[0]:
                st.subheader('Otimizáveis')
                st.markdown('##### ADs com :green[margem boa] e alguma :red[métrica ruim]')
                st.markdown('1. Margem positiva\n 2. Pelo menos uma métrica abaixo da média')
                st.info('*Analisar as piores métricas e melhorá-las. Pegar ideias nos ADs com a métrica boa.*')

            # TABS MENU (SELECT TOP RANKING)
            otimizaveis_sorting_option = st.radio(
                "Sort by:",
                list(sorting_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
                key='otimizaveis_sorting_option'
            )

            # # SORT INIT
            if otimizaveis_sorting_option is not None:
                otimizaveis_selected_column = sorting_columns[otimizaveis_sorting_option]
            df_otimizaveis = resort_by(df_otimizaveis, otimizaveis_selected_column)

            # CONFIGURA AGGRID
            otimizaveis_grid_response = create_aggrid(df_otimizaveis, interest_columns, cost_column, results_column, group_by_ad)

        # LIÇÕES
        with st.expander(f'Lições ({len(df_licoes)})'):
            licoes_cols = st.columns(2)
            with licoes_cols[0]:
                st.subheader('Lições')  
                st.markdown('##### ADs com :red[margem ruim] e alguma :green[métrica boa]')
                st.markdown('1. Margem negativa\n 2. Pelo menos uma métrica acima da média')
                st.info('*Identificar o que fez a métrica estar boa e aprender / salvar o bloco (ex: hook).*')

            # TABS MENU (SELECT TOP RANKING)
            licoes_sorting_option = st.radio(
                "Sort by:",
                list(sorting_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
                key='licoes_sorting_option'
            )

            # # SORT INIT
            if licoes_sorting_option is not None:
                licoes_selected_column = sorting_columns[licoes_sorting_option]
            df_licoes = resort_by(df_licoes, licoes_selected_column)

            # CONFIGURA AGGRID
            licoes_grid_response = create_aggrid(df_licoes, interest_columns, cost_column, results_column, group_by_ad)

        # DESCARTADOS
        with st.expander(f'Descartados ({len(df_descartados)})'):
            descartados_cols = st.columns(2)
            with descartados_cols[0]:
                st.subheader('Descartados')  
                st.markdown('##### ADs com :red[margem ruim] e :red[métricas ruins]')
                st.markdown('1. Margem negativa\n 2. Todas as métrica abaixo da média')
                st.info('*Identificar o estilo de anúncio e/ou comunicação que não funciona e aprender.*')

            # TABS MENU (SELECT TOP RANKING)
            descartados_sorting_option = st.radio(
                "Sort by:",
                list(sorting_columns.keys()),
                horizontal=True,
                label_visibility='collapsed',
                key='descartados_sorting_option'
            )

            # # SORT INIT
            if descartados_sorting_option is not None:
                descartados_selected_column = sorting_columns[descartados_sorting_option]
            df_descartados = resort_by(df_descartados, descartados_selected_column)

            # CONFIGURA AGGRID
            descartados_grid_response = create_aggrid(df_descartados, interest_columns, cost_column, results_column, group_by_ad)

else:
    st.warning('⬅️ First, load ADs in the sidebar.')

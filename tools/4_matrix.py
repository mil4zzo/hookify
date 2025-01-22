from unittest import result
from altair import layer
import streamlit as st
import plotly.graph_objects as go
import pandas as pd
from components.advanced_options import AdvancedOptions

from libs.dataformatter import aggregate_dataframe
from libs.session_manager import get_session_access_token, get_session_ads_data
from styles.styler import BLACK_100, BLACK_300, BLACK_400, BLACK_500, BLACK_700, BLUE_300, BLUE_500, GREEN_500, GREY_300, GREY_700

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('💊 Matrix')
    st.write('Visual ad performance view.')
with cols[1]:
    with st.container(border=True):
        group_by_ad = st.toggle("Group ADs by name", value=True)

st.divider()



# Metric configurations
METRICS_CONFIG = {
    'ctr': {
        'type': 'percentage',
        'display_name': 'CTR',
        'description': 'Click-through Rate'
    },
    'retention_at_3': {
        'type': 'percentage',
        'display_name': 'Hook Retention',
        'description': 'Retention at 3 seconds'
    },
    'conversion_rate': {
        'type': 'percentage',
        'display_name': 'Conversion Rate',
        'description': 'Conversion Rate'
    },
    'cpm': {
        'type': 'currency',
        'display_name': 'CPM',
        'description': 'Cost per 1000 impressions'
    },
    'cpc': {
        'type': 'currency',
        'display_name': 'CPC',
        'description': 'Cost per Click'
    },
    'cost_per_conversion.offsite_conversion.fb_pixel_custom.TYP_Captacao_Evento': {
        'type': 'currency',
        'display_name': 'CPR',
        'description': 'Cost per Result'
    },
    'spend': {
        'type': 'currency',
        'display_name': 'Spend',
        'description': 'Total Spend'
    },
    'results': {
        'type': 'integer',
        'display_name': 'Results',
        'description': 'Total Results'
    },
    'clicks': {
        'type': 'integer',
        'display_name': 'Clicks',
        'description': 'Total Clicks'
    },
    'impressions': {
        'type': 'integer',
        'display_name': 'Impressions',
        'description': 'Total Impressions'
    }
}

def get_metric_config(metric_name):
    """
    Get the configuration for a given metric
    
    Parameters:
    metric_name (str): Name of the metric
    
    Returns:
    dict: Metric configuration or default configuration if metric not found
    """
    return METRICS_CONFIG.get(metric_name.lower(), {
        'type': 'float',
        'display_name': metric_name.upper(),
        'description': metric_name.title()
    })

def format_metric_value(value, metric_name):
    """
    Format a metric value based on its type
    
    Parameters:
    value (float): Value to format
    metric_name (str): Name of the metric
    
    Returns:
    str: Formatted value
    """
    metric_config = get_metric_config(metric_name)
    metric_type = metric_config['type']
    
    if metric_type == 'percentage':
        return f"{value:.2f}%"
    elif metric_type == 'currency':
        return f"R$ {value:,.2f}"
    elif metric_type == 'integer':
        return f"{int(value):,}"
    else:  # float or unknown type
        return f"{value:,.2f}"

def get_axis_config(metric_name, values):
    """
    Returns axis configuration based on metric type
    
    Parameters:
    metric_name (str): Name of the metric
    values (pandas.Series): Values for this metric
    
    Returns:
    dict: Axis configuration for plotly
    """
    metric_config = get_metric_config(metric_name)
    metric_type = metric_config['type']
    
    # Default configuration
    config = {
        'tickmode': 'linear',
        'tick0': 0,
        'color': 'white',
        'title_font': dict(color='white'),
        'zeroline': True,
        'zerolinecolor': 'yellow',
        'zerolinewidth': 2
    }
    
    max_val = values.max() * 1.1  # Add 10% padding
    
    if metric_type == 'percentage':
        config.update({
            'range': [0, round(max_val, 1)],
            'dtick': 0.5,
            'tickformat': '.1f',
            'ticksuffix': '%'
        })
    elif metric_type == 'currency':
        config.update({
            'range': [0, round(max_val, 2)],
            'dtick': round(max_val / 10, 2),
            'tickprefix': 'R$ ',
            'tickformat': ',.2f'
        })
    elif metric_type == 'integer':
        config.update({
            'range': [0, round(max_val)],
            'dtick': round(max_val / 10),
            'tickformat': 'd'
        })
    else:  # float or unknown type
        config.update({
            'range': [0, round(max_val, 2)],
            'dtick': round(max_val / 10, 2),
            'tickformat': ',.2f'
        })
    
    return config

def build_matrix(df, cost_column, results_column, y_metric):
    """
    Build the matrix visualization with dynamic Y-axis
    
    Parameters:
    df (pandas.DataFrame): Input data
    cost_column (str): Column name for cost metric
    results_column (str): Column name for results metric
    y_metric (str): Column name for Y-axis metric
    """
    # Calculate image sizes and colors based on RESULTS
    max_results = df[results_column].max()
    min_results = df[results_column].min()
    
    def normalize_size(results, min_size=1, max_size=5):
        if max_results == min_results:
            return (min_size + max_size) / 2
        normalized = (results - min_results) / (max_results - min_results)
        return min_size + normalized * (max_size - min_size)

    # Calculate image sizes and colors based on CPR
    max_cpr = df[cost_column].max()
    min_cpr = df[cost_column].min()

    def get_color(cpr):
        if max_cpr == min_cpr:
            return "yellow"
        normalized = (cpr - min_cpr) / (max_cpr - min_cpr)
        r = int(255 * normalized)
        g = int(255 * (1 - normalized))
        return f"rgb({r}, {g}, 0)"

    # Create the scatter plot
    fig = go.Figure(layout=dict(height=600))

    # Format hover text using centralized formatting
    hover_text = []
    for _, row in df.iterrows():
        hover_text.append(
            f"Ad Name: {row['ad_name']}<br>"
            f"{get_metric_config(y_metric)['display_name']}: {format_metric_value(row[y_metric], y_metric)}<br>"
            f"Hook Retention: {format_metric_value(row['retention_at_3'], 'retention_at_3')}<br>"
            f"Results: {format_metric_value(row[results_column], 'results')}<br>"
            f"CPR: {format_metric_value(row[cost_column], 'cost_per_result')}"
        )

    fig.add_trace(go.Scatter(
        x=df['retention_at_3'],
        y=df[y_metric],
        mode='markers',
        marker=dict(
            size=normalize_size(df[results_column], 10, 50),
            symbol='circle',
            opacity=.5
        ),
        text=hover_text,
        hoverinfo='text'
    ))

    # Get Y-axis configuration based on metric
    y_axis_config = get_axis_config(y_metric, df[y_metric])
    metric_display_name = get_metric_config(y_metric)['display_name']
    
    # Update layout with dynamic Y-axis configuration
    fig.update_layout(
        dragmode="pan",
        xaxis_title='HOOK RETENTION',
        yaxis_title=metric_display_name,
        xaxis=dict(
            range=[0, 100],
            tickmode='linear',
            tick0=0,
            dtick=2.5,
            tickformat='d',
            ticksuffix='%',
            color='white',
            title_font=dict(color='white'),
            zeroline=True,
            zerolinecolor='yellow',
            zerolinewidth=2
        ),
        yaxis=y_axis_config,
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor=BLACK_500,
        xaxis_showgrid=True,
        yaxis_showgrid=True,
        xaxis_gridcolor=BLACK_400,
        yaxis_gridcolor=BLACK_400
    )

    fig.update_xaxes(range=[0, 100])
    st.plotly_chart(fig, use_container_width=True, config={'scrollZoom': True})




# def build_matrix(df, cost_column, results_column):

#     # Calculate image sizes and colors based on RESULTS
#     max_results = df[results_column].max()
#     min_results = df[results_column].min()
    
#     def normalize_size(results, min_size=1, max_size=5):
#         if max_results == min_results:
#             return (min_size + max_size) / 2
#         normalized = (results - min_results) / (max_results - min_results)
#         return min_size + normalized * (max_size - min_size)

#     # Calculate image sizes and colors based on CPR
#     max_cpr = df[cost_column].max()
#     min_cpr = df[cost_column].min()

#     def get_color(cpr):
#         if max_cpr == min_cpr:
#             return "yellow"
#         normalized = (cpr - min_cpr) / (max_cpr - min_cpr)
#         r = int(255 * normalized)
#         g = int(255 * (1 - normalized))
#         return f"rgb({r}, {g}, 0)"

#     # Create the scatter plot
#     fig = go.Figure(layout=dict(height=600))

#     fig.add_trace(go.Scatter(
#         x=df['retention_at_3'],
#         y=df['ctr'],
#         mode='markers',
#         marker=dict(
#             size=normalize_size(df[results_column], 10, 50),
#             symbol='circle',
#             opacity=.5
#         ),
#         text=[f"Ad Name: {ad}<br>CTR: {ctr:.2f}%<br>Hook Retention: {hr:.0f}%<br>Leads: {leads:.0f}<br>CPR: R$ {cpr:.2f}" 
#             for ad, ctr, hr, leads, cpr in zip(df['ad_name'], df['ctr'], df['retention_at_3'], df[results_column], df[cost_column])],
#         hoverinfo='text'
#     ))

#     # Add images
#     for index, row in df.iterrows():
#         image_size = normalize_size(row[results_column], 1, 4)
#         image_color = get_color(row[cost_column])

#         # Add colored rectangle
#         fig.add_shape(
#             type="rect",
#             x0=row['retention_at_3'] - image_size/2,
#             y0=row['ctr'] - image_size/21,
#             x1=row['retention_at_3'] + image_size/2,
#             y1=row['ctr'] + image_size/21,
#             fillcolor=image_color,
#             line=dict(width=0),
#             layer="below"
#         )

#         fig.add_layout_image(
#             dict(
#                 source=row['creative.thumbnail_url'],
#                 xref="x",
#                 yref="y",
#                 x=row['retention_at_3'],
#                 y=row['ctr'],
#                 sizex=image_size,
#                 sizey=image_size,  # Adjust this value to change image size
#                 xanchor="center",
#                 yanchor="middle",
#                 layer="below",
#                 opacity=.8
#             )
#         )

#     # Good CTR
#     fig.add_shape(
#         type="line",
#         x0=0,
#         y0=1.0,
#         x1=100,
#         y1=1.0,
#         line=dict(
#             color=BLUE_500,
#             width=2,
#             dash="dash",
#         )
#     )

#     # Mean CTR
#     fig.add_shape(
#         type="line",
#         x0=0,
#         y0=df['ctr'].mean(),
#         x1=100,
#         y1=df['ctr'].mean(),
#         line=dict(
#             color=GREEN_500,
#             width=2,
#             dash="dash",
#         )
#     )

#     # Mean Hook
#     fig.add_shape(
#         type="line",
#         x0=df['retention_at_3'].mean(),
#         y0=0,
#         x1=df['retention_at_3'].mean(),
#         y1=df['ctr'].max() * 1.1,
#         line=dict(
#             color=GREEN_500,
#             width=2,
#             dash="dash",
#         )
#     )

#     # Customize the layout
#     max_ctr = df['ctr'].max() * 1.1
#     max_ctr_rounded = round(max_ctr, 1)

#     fig.update_layout(
#         dragmode="pan",
#         xaxis_title='HOOK RETENTION',
#         yaxis_title='CTR',
#         xaxis=dict(
#             range=[0, 100],
#             tickmode='linear',
#             tick0=0,
#             dtick=2.5,  # Set tick every 5%
#             tickformat='d',  # Display as integer
#             ticksuffix='%',
#             color='white',  # Set x-axis color
#             title_font=dict(color='white'),  # Set x-axis title color
#             zeroline=True,
#             zerolinecolor='yellow',
#             zerolinewidth=2
#         ),
#         yaxis=dict(
#             range=[0, max_ctr_rounded],
#             tickmode='linear',
#             tick0=0,
#             dtick=0.5,  # Set tick every 0.5%
#             tickformat='.1f',  # Display one decimal place
#             ticksuffix='%',
#             color='white',  # Set y-axis color
#             title_font=dict(color='white'),  # Set y-axis title color
#             zeroline=True,
#             zerolinecolor='yellow',
#             zerolinewidth=2
#         ),
#         plot_bgcolor='rgba(0,0,0,0)',
#         paper_bgcolor=BLACK_500,
#         xaxis_showgrid=True,
#         yaxis_showgrid=True,
#         xaxis_gridcolor=BLACK_400,
#         yaxis_gridcolor=BLACK_400
#     )

#     # Custom JavaScript for hover effect
#     hover_js = """
#     function(gd) {
#         gd.on('plotly_hover', function(data) {
#             var point = data.points[0];
#             var curveNumber = point.curveNumber;
#             var pointNumber = point.pointNumber;
#             var images = document.querySelectorAll('g.layer-above image');
#             if (images[pointNumber]) {
#                 images[pointNumber].style.opacity = 1;
#             }
#         });
#         gd.on('plotly_unhover', function(data) {
#             var images = document.querySelectorAll('g.layer-above image');
#             images.forEach(function(img) {
#                 img.style.opacity = 0.4;
#             });
#         });
#     }
#     """

#     # Update the Streamlit plotly_chart call
#     fig.update_xaxes(range=[0, 100])
#     fig.update_yaxes(range=[0, None])
#     st.plotly_chart(fig, use_container_width=True, config={'scrollZoom': True})




# SE JÁ TEM DADOS DE ANÚNCIOS
df_ads_data = get_session_ads_data()
if df_ads_data is not None:
    
    # INICIALIZA API KEY E GRAPH API
    api_key = get_session_access_token()

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

        # Add metric selection dropdown with grouped metrics
        available_metrics = [
            metric for metric in METRICS_CONFIG.keys()
            if metric in df_ads_data.columns
        ]
        
        y_metric = st.selectbox(
            'Y-axis Metric',
            options=available_metrics,
            format_func=lambda x: f"{METRICS_CONFIG[x]['display_name']} - {METRICS_CONFIG[x]['description']}",
            index=available_metrics.index('ctr') if 'ctr' in available_metrics else 0
        )
        
        build_matrix(df_ads_data, cost_column, results_column, y_metric)
else:
    st.warning('⬅️ First, load ADs in the sidebar.')
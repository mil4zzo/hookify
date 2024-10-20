from unittest import result
from altair import layer
import streamlit as st
import plotly.graph_objects as go
import pandas as pd
from components.advanced_options import AdvancedOptions

from libs.dataformatter import aggregate_dataframe
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


def build_matrix(df, cost_column, results_column):

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

    fig.add_trace(go.Scatter(
        x=df['retention_at_3'],
        y=df['ctr'],
        mode='markers',
        marker=dict(
            size=normalize_size(df[results_column], 10, 50),
            symbol='circle',
            opacity=.5
        ),
        text=[f"Ad Name: {ad}<br>CTR: {ctr:.2f}%<br>Hook Retention: {hr:.0f}%<br>Leads: {leads:.0f}<br>CPR: R$ {cpr:.2f}" 
            for ad, ctr, hr, leads, cpr in zip(df['ad_name'], df['ctr'], df['retention_at_3'], df[results_column], df[cost_column])],
        hoverinfo='text'
    ))

    # Add images
    for index, row in df.iterrows():
        image_size = normalize_size(row[results_column], 1, 4)
        image_color = get_color(row[cost_column])

        # Add colored rectangle
        fig.add_shape(
            type="rect",
            x0=row['retention_at_3'] - image_size/2,
            y0=row['ctr'] - image_size/21,
            x1=row['retention_at_3'] + image_size/2,
            y1=row['ctr'] + image_size/21,
            fillcolor=image_color,
            line=dict(width=0),
            layer="below"
        )

        fig.add_layout_image(
            dict(
                source=row['creative.thumbnail_url'],
                xref="x",
                yref="y",
                x=row['retention_at_3'],
                y=row['ctr'],
                sizex=image_size,
                sizey=image_size,  # Adjust this value to change image size
                xanchor="center",
                yanchor="middle",
                layer="below",
                opacity=.8
            )
        )

    # Good CTR
    fig.add_shape(
        type="line",
        x0=0,
        y0=1.0,
        x1=100,
        y1=1.0,
        line=dict(
            color=BLUE_500,
            width=2,
            dash="dash",
        )
    )

    # Mean CTR
    fig.add_shape(
        type="line",
        x0=0,
        y0=df['ctr'].mean(),
        x1=100,
        y1=df['ctr'].mean(),
        line=dict(
            color=GREEN_500,
            width=2,
            dash="dash",
        )
    )

    # Mean Hook
    fig.add_shape(
        type="line",
        x0=df['retention_at_3'].mean(),
        y0=0,
        x1=df['retention_at_3'].mean(),
        y1=df['ctr'].max() * 1.1,
        line=dict(
            color=GREEN_500,
            width=2,
            dash="dash",
        )
    )

    # Customize the layout
    max_ctr = df['ctr'].max() * 1.1
    max_ctr_rounded = round(max_ctr, 1)

    fig.update_layout(
        dragmode="pan",
        xaxis_title='HOOK RETENTION',
        yaxis_title='CTR',
        xaxis=dict(
            range=[0, 100],
            tickmode='linear',
            tick0=0,
            dtick=2.5,  # Set tick every 5%
            tickformat='d',  # Display as integer
            ticksuffix='%',
            color='white',  # Set x-axis color
            title_font=dict(color='white'),  # Set x-axis title color
            zeroline=True,
            zerolinecolor='yellow',
            zerolinewidth=2
        ),
        yaxis=dict(
            range=[0, max_ctr_rounded],
            tickmode='linear',
            tick0=0,
            dtick=0.5,  # Set tick every 0.5%
            tickformat='.1f',  # Display one decimal place
            ticksuffix='%',
            color='white',  # Set y-axis color
            title_font=dict(color='white'),  # Set y-axis title color
            zeroline=True,
            zerolinecolor='yellow',
            zerolinewidth=2
        ),
        plot_bgcolor='rgba(0,0,0,0)',
        paper_bgcolor=BLACK_500,
        xaxis_showgrid=True,
        yaxis_showgrid=True,
        xaxis_gridcolor=BLACK_400,
        yaxis_gridcolor=BLACK_400
    )

    # Custom JavaScript for hover effect
    hover_js = """
    function(gd) {
        gd.on('plotly_hover', function(data) {
            var point = data.points[0];
            var curveNumber = point.curveNumber;
            var pointNumber = point.pointNumber;
            var images = document.querySelectorAll('g.layer-above image');
            if (images[pointNumber]) {
                images[pointNumber].style.opacity = 1;
            }
        });
        gd.on('plotly_unhover', function(data) {
            var images = document.querySelectorAll('g.layer-above image');
            images.forEach(function(img) {
                img.style.opacity = 0.4;
            });
        });
    }
    """

    # Update the Streamlit plotly_chart call
    fig.update_xaxes(range=[0, 100])
    fig.update_yaxes(range=[0, None])
    st.plotly_chart(fig, use_container_width=True, config={'scrollZoom': True})


if 'ads_data' in st.session_state and isinstance(st.session_state['ads_data'], pd.DataFrame):
    
    # INICIALIZA API KEY E GRAPH API
    api_key = st.session_state["access_token"]

    # PREPARA DATASET
    # PREPARA DATASET
    advanced_options = AdvancedOptions()
    advanced_options.build()
    options = advanced_options.apply_filters()
    cost_column = options['cost_column']
    results_column = options['results_column']
    df_ads_data = options['df_ads_data'].copy()

    # CRIA AGRUPAMENTO POR NOME DO ANÚNCIO (ad_name)
    df_grouped = aggregate_dataframe(df_ads_data, group_by='ad_name')
    if group_by_ad:
        df_ads_data = df_grouped

    build_matrix(df_ads_data, cost_column, results_column)
else:
    st.warning('⬅️ First, load ADs in the sidebar.')
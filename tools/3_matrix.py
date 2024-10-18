from altair import layer
import streamlit as st
import plotly.graph_objects as go
import pandas as pd

from libs.dataformatter import aggregate_dataframe
from styles.styler import BLACK_100, BLACK_300, BLACK_400, BLACK_500, BLACK_700, GREY_300, GREY_700

# CRIA BARRA DE TITULO
cols = st.columns([2,1])
with cols[0]:
    st.title('💊 Matrix')
    st.write('Visual ad performance view.')
with cols[1]:
    with st.container(border=True):
        group_by_ad = st.toggle("Group ADs by name", value=True)

st.divider()


def build_matrix(df):
    # Create the scatter plot
    fig = go.Figure(layout=dict(height=600))

    fig.add_trace(go.Scatter(
        x=df['retention_at_3'],
        y=df['ctr'],
        mode='markers',
        marker=dict(
            size=10,
            symbol='circle',
            opacity=.2
        ),
        text=[f"Ad Name: {ad}<br>CTR: {ctr:.2f}%<br>Hook Retention: {hr:.0f}%" 
            for ad, ctr, hr in zip(df['ad_name'], df['ctr'], df['retention_at_3'])],
        hoverinfo='text'
    ))

    # Add images
    for index, row in df.iterrows():
        fig.add_layout_image(
            dict(
                source=row['creative.thumbnail_url'],
                xref="x",
                yref="y",
                x=row['retention_at_3'],
                y=row['ctr'],
                sizex=2,
                sizey=2,  # Adjust this value to change image size
                xanchor="center",
                yanchor="middle",
                layer="below",
                opacity=1
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
    df_ads_data = st.session_state['ads_data'].copy()

    # CRIA AGRUPAMENTO POR NOME DO ANÚNCIO (ad_name)
    df_grouped = aggregate_dataframe(df_ads_data, group_by='ad_name')
    if group_by_ad:
        df_ads_data = df_grouped

    build_matrix(df_ads_data)
else:
    st.warning('⬅️ First, load ADs in the sidebar.')
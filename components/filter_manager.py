# import streamlit as st
# from typing import Dict, Any

# from libs.session_manager import get_session_ads_data

# class FilterManager:
#     _instance = None

#     @classmethod
#     def get_instance(cls):
#         if cls._instance is None:
#             cls._instance = cls()
#         return cls._instance

#     def __init__(self):
#         if not hasattr(st.session_state, 'filter_manager_initialized'):
#             self.initialize_state()
#             st.session_state.filter_manager_initialized = True

#     def initialize_state(self):
#         """Initialize all filter-related state variables"""
#         if 'ads_original_data' not in st.session_state:
#             raise KeyError("ads_original_data not found in session state")

#         defaults = {
#             'app_cost_column': self._get_default_cost_column(),
#             'app_min_plays': 25,
#             'app_min_spend': 50,
#             'app_filters_campaign': [],
#             'app_filters_adset': [],
#             'app_filters_adname': [],
#             'app_apply_filters': False
#         }
        
#         for key, default_value in defaults.items():
#             if key not in st.session_state:
#                 st.session_state[key] = default_value

#     def _get_default_cost_column(self) -> str:
#         cost_columns = [col for col in st.session_state['ads_original_data'].columns 
#                         if 'cost_per_' in col]
#         if not cost_columns:
#             raise ValueError("No cost_per columns found in the dataset")
#         return cost_columns[0]

#     def build_ui(self):
#         """Build the UI components for advanced options."""
#         with st.expander('Advanced options', expanded=False):
#             with st.form("app_options", clear_on_submit=False):
#                 with st.container(border=True):
#                     controls = st.columns([1,2], gap='large')
#                     with controls[0]:
#                         st.subheader('Settings')
#                         self._build_conversion_selector()
#                         self._build_thresholds()
#                     with controls[1]:
#                         st.subheader('Filters')
#                         self._build_filters()

#                 submitted = st.form_submit_button(
#                     'Apply filters', 
#                     type='primary', 
#                     use_container_width=True
#                 )
                
#                 if submitted:
#                     st.session_state.app_apply_filters = True
#                     st.rerun()

#     def _build_conversion_selector(self):
#         cost_columns = [col for col in st.session_state['ads_original_data'].columns 
#                        if 'cost_per_' in col]
#         index = cost_columns.index(st.session_state.app_cost_column) if st.session_state.app_cost_column in cost_columns else 0
        
#         cols = st.columns([1,2])
#         with cols[0]:
#             st.write('Conversion event')
#         with cols[1]:
#             st.selectbox(
#                 'Conversion event:', 
#                 cost_columns,
#                 index=index,
#                 format_func=lambda x: x.split(".")[-1],
#                 label_visibility='collapsed',
#                 key='app_cost_column'
#             )

#     def _build_thresholds(self):
#         # Minimum Plays
#         cols = st.columns([1,2], gap='small')
#         with cols[0]:
#             st.write('Minimum Plays')
#         with cols[1]:
#             st.number_input("Minimum Plays",
#                           min_value=0,
#                           max_value=200,
#                           step=5,
#                           label_visibility='collapsed',
#                           key='app_min_plays')
        
#         # Minimum Spend
#         cols = st.columns([1,2], gap='small')
#         with cols[0]:
#             st.write('Minimum Spend')
#         with cols[1]:
#             st.number_input("Minimum Spend",
#                           min_value=0,
#                           max_value=2000,
#                           step=10,
#                           label_visibility='collapsed',
#                           key='app_min_spend')

#     def _build_filters(self):
#         df = st.session_state['ads_original_data']
        
#         filter_configs = [
#             ('Campaign', 'campaign_name', 'app_filters_campaign'),
#             ('Adset', 'adset_name', 'app_filters_adset'),
#             ('Ad name', 'ad_name', 'app_filters_adname')
#         ]
        
#         for label, column, key in filter_configs:
#             cols = st.columns([1,6], gap='small')
#             with cols[0]:
#                 st.write(label)
#             with cols[1]:
#                 options = list(df[column].unique())
#                 st.multiselect(f'Select {label.lower()}:',
#                               options,
#                               label_visibility='collapsed',
#                               key=key)

#     def apply_filters(self) -> Dict[str, Any]:
#         """Apply all filters and return filtered data and metadata."""
#         try:
#             df_filtered = get_session_ads_data()
            
#             if st.session_state.app_apply_filters:
#                 # Apply filters...
#                 filter_configs = [
#                     ('campaign_name', 'app_filters_campaign'),
#                     ('adset_name', 'app_filters_adset'),
#                     ('ad_name', 'app_filters_adname')
#                 ]
                
#                 for column, filter_key in filter_configs:
#                     if st.session_state[filter_key]:
#                         df_filtered = df_filtered[df_filtered[column].isin(st.session_state[filter_key])]
                
#                 if st.session_state.app_min_plays:
#                     df_filtered = df_filtered[df_filtered['total_plays'] >= st.session_state.app_min_plays]
                
#                 if st.session_state.app_min_spend:
#                     df_filtered = df_filtered[df_filtered['spend'] >= st.session_state.app_min_spend]
                
#                 st.session_state.app_apply_filters = False
            
#             cost_column = st.session_state.app_cost_column
#             event_name = cost_column.split('.')[-1]
#             conversions_columns = [col for col in df_filtered.columns if 'conversions' in col]
#             results_column = next((col for col in conversions_columns if event_name in col), None)
            
#             return {
#                 'cost_column': cost_column,
#                 'results_column': results_column,
#                 'df_ads_data': df_filtered
#             }
            
#         except Exception as e:
#             st.error(f"Error applying filters: {str(e)}")
#             return {
#                 'cost_column': st.session_state.app_cost_column,
#                 'results_column': None,
#                 'df_ads_data': st.session_state['ads_original_data']
#             }
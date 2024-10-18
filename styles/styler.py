# colors.py
GREEN_300 = '#85e0ba'
GREEN_500 = '#3ecf8e'
GREEN_600 = '#1B6447'
GREEN_700 = '#006239'
GREEN_800 = '#00311d'
GREEN_900 = '#04260f'
GREEN_500_BG = '#3ecf8e80'
GREEN_500_BORDER = '#3ecf8e4d'
BLUE_50 = '#eff6ff'
BLUE_100 = '#dbeafe'
BLUE_200 = '#bfdcfe'
BLUE_300 = '#94c6fc'
BLUE_400 = '#61a7f9'
BLUE_500 = '#0F7DA0'
BLUE_700 = '#13586F'
BLUE_800 = '#1f43ae'
BLUE_900 = '#1f3b89'
BLUE_950 = '#172654'
GREY_300 = '#A8A8A8'
GREY_500 = '#757575'
GREY_700 = '#525252'
BLACK_100 = '#454545'
BLACK_300 = '#424242'
BLACK_400 = '#363636'
BLACK_500 = '#242424'
BLACK_700 = '#171717'
BLACK_900 = '#121212'
BOX_SHADOW = '#0D0D0D50'

# # colors.py
# GREEN_300 = '#21D691'
# GREEN_500 = '#1D9265'
# GREEN_700 = '#1B6447'
# BLUE_300 = '#0AB7EF'
# BLUE_500 = '#0F7DA0'
# BLUE_700 = '#13586F'
# GREY_300 = '#A8A8A8'
# GREY_500 = '#757575'
# GREY_700 = '#525252'
# BLACK_100 = '#424242'
# BLACK_300 = '#292929'
# BLACK_500 = '#181818'
# BLACK_700 = '#121212'
# BLACK_900 = '#0D0D0D'
# BOX_SHADOW = '#0D0D0D50'

# You can also group colors
COLORS = {
    'GREEN_300': GREEN_300,
    'GREEN_500': GREEN_500,
    'GREEN_600': GREEN_600,
    'GREEN_700': GREEN_700,
    'GREEN_800': GREEN_800,
    'GREEN_900': GREEN_900,
    'GREEN_500_BG': GREEN_500_BG,
    'GREEN_500_BORDER': GREEN_500_BORDER,
    'BLUE_50': BLUE_50,
    'BLUE_100': BLUE_100,
    'BLUE_200': BLUE_200,
    'BLUE_300': BLUE_300,
    'BLUE_400': BLUE_400,
    'BLUE_500': BLUE_500,
    'BLUE_700': BLUE_700,
    'BLUE_800': BLUE_800,
    'BLUE_900': BLUE_900,
    'BLUE_950': BLUE_950,
    'GREY_300': GREY_300,
    'GREY_500': GREY_500,
    'GREY_700': GREY_700,
    'BLACK_100': BLACK_100,
    'BLACK_300': BLACK_300,
    'BLACK_400': BLACK_400,
    'BLACK_500': BLACK_500,
    'BLACK_700': BLACK_700,
    'BLACK_900': BLACK_900,
    'BOX_SHADOW': BOX_SHADOW
}


AGGRID_THEME = {
    # HEADERS
    '.ag-header': {
        'background-color': BLACK_300,
    },
    '.ag-header-cell': {
        'background-color': BLACK_300,
        'color': 'white',
        'font-size': '1em',
        '--ag-header-cell-hover-background-color': BLACK_100,
    },
    '.ag-header-cell-label': {
        'justify-content': 'center'
    },
    # COLUMNS
    ## LEFT PINNED
    '.ag-pinned-left-cols-container':{

    },
    ## CENTER
    '.ag-center-cols-viewport': {

    },
    ## RIGHT PINNED
    '.ag-pinned-right-cols-container': {

    },
    # ROWS
    '.ag-row': {
        'background-color': BLACK_500,
        'color': '#FFFFFF',
        '--ag-row-hover-color': BLACK_300,
        '--ag-selected-row-background-color': GREEN_700
    },
    '.ag-row-selected': {
        #'color': BLACK_500
    },
    '.ag-cell': {
        'align-content': 'center',
        'display': 'flex',
        'align-items': 'center',
        'justify-content': 'center'
    },
    # AD_NAME
    '.ag-center-cols-viewport .ag-cell:nth-child(1)': {
        'justify-content': 'start'
    }
}